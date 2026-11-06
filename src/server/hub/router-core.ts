import { getServiceClient, logActivity, decryptSecret } from "./core";
import { healthRank } from "./model-observability";
import { ModelRpmThrottler, RollingModelLatency, rankModelsByLatency, classifyPromptComplexity, isBudgetExceeded, utcDayWindow, parseApiKeys, maskSensitiveData, squeezePrompt, configuredLimit, isLovableGateway } from "./routing-policy";
export { ModelRpmThrottler, RollingModelLatency, rankModelsByLatency, classifyPromptComplexity, isBudgetExceeded, parseApiKeys, maskSensitiveData, squeezePrompt } from "./routing-policy";
const latencies = new RollingModelLatency();
const rpm = new ModelRpmThrottler();
export class RoutingGuardError extends Error {
  constructor(public status: number, message: string, public reason: "budget" | "throttled" | "paused") { super(message); }
}
export async function checkDispatchBudget(client: any, cap: number | null, now = new Date()) {
  const { data: settings, error } = await client.from("settings").select("master_pause").eq("id", "SYSTEM_CONFIG").maybeSingle();
  if (error || !settings) throw new RoutingGuardError(503, "Cannot verify dispatch pause state", "paused");
  if (settings.master_pause) throw new RoutingGuardError(409, "AI dispatch is paused", "paused");
  if (cap == null) return;
  const { start, end } = utcDayWindow(now);
  let spend = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data, error: spendError } = await client.from("usage_records").select("cost").gte("created_at", start).lt("created_at", end).order("id").range(offset, offset + 999);
    if (spendError || !Array.isArray(data)) throw new RoutingGuardError(503, "Cannot verify daily AI spend", "budget");
    for (const row of data) {
      const cost = Number(row.cost);
      if (row.cost == null || !Number.isFinite(cost) || cost < 0) throw new RoutingGuardError(503, "Cannot verify daily AI spend", "budget");
      spend += cost;
    }
    if (data.length < 1000) break;
  }
  if (isBudgetExceeded(spend, cap)) throw new RoutingGuardError(402, "Daily AI budget reached", "budget");
}

export class AIHttpError extends Error {
  constructor(public status: number, message: string, public retryAfterMs = 0, public terminal = false) { super(message); this.name = "AIHttpError"; }
}
/** 402 (payment/quota) and 429 (rate limit) mean "try another model", not "fail the step". */
export function isFallbackError(err: unknown): boolean {
  return err instanceof AIHttpError && (err.status === 402 || err.status === 429);
}

export function isExpandedFallbackError(err: unknown): boolean {
  return (err instanceof AIHttpError && !err.terminal && [402, 429, 408, 502, 503, 504].includes(err.status)) || (err instanceof Error && err.name === "TimeoutError");
}
export function fallbackDelayMs(err: AIHttpError, attempt: number): number {
  return Math.max(err.retryAfterMs, Math.min(8000, 1000 * 2 ** attempt));
}

// USD per token (input, output). Unknown models fall back to their provider's default.
const PRICING: Record<string, { default: [number, number]; models: Record<string, [number, number]> }> = {
  anthropic: { default: [3e-6, 15e-6], models: { haiku: [0.8e-6, 4e-6], sonnet: [3e-6, 15e-6], opus: [15e-6, 75e-6] } },
  gemini: { default: [0.3e-6, 2.5e-6], models: { "flash-lite": [0.1e-6, 0.4e-6], flash: [0.3e-6, 2.5e-6], pro: [1.25e-6, 10e-6] } },
  openai: { default: [2.5e-6, 10e-6], models: { "gpt-4o-mini": [0.15e-6, 0.6e-6], "gpt-4o": [2.5e-6, 10e-6], "gpt-4.1-mini": [0.4e-6, 1.6e-6], "gpt-4.1": [2e-6, 8e-6] } },
};
export function computeCost(providerType: string, modelId: string, promptTokens: number, completionTokens: number): number {
  const table = PRICING[providerType] ?? PRICING["openai"];
  if (!table) throw new Error("Missing pricing configuration");
  const id = modelId.toLowerCase();
  const match = Object.keys(table.models).sort((a, b) => b.length - a.length).find((k) => id.includes(k));
  const [inp, out] = (match && table.models[match]) || table.default;
  return promptTokens * inp + completionTokens * out;
}

export interface SelectedModelResult { model: any; provider: any; apiKey: string; selectionReason: string }

export async function pickBestModel(requiredCapability: "text" | "image" | "tools" | "long_context" = "text", excludeIds: string[] = [], prompt = ""): Promise<SelectedModelResult> {
  const supabase = await getServiceClient();
  const nowIso = new Date().toISOString();
  // Release expired cooldowns so the flag matches reality.
  await supabase.from("models").update({ in_cooldown: false, cooldown_until: null }).eq("in_cooldown", true).lt("cooldown_until", nowIso);
  const { data: providers, error: pErr } = await supabase.from("providers").select("*, provider_secrets(api_key,encrypted_secret,encryption_iv)").eq("is_enabled", true);
  if (pErr || !providers || providers.length === 0) throw new Error("ไม่มีผู้ให้บริการ AI (Provider) ที่เปิดใช้งานอยู่ในระบบ");
  // R34: providers marked down by the heartbeat are avoided without waiting for a timeout.
  const enabledProviderIds = providers.filter((p: any) => healthRank(p.health_status) !== Infinity).map((p: any) => p.id);
  if (enabledProviderIds.length === 0) throw new Error("ผู้ให้บริการ AI ทั้งหมดอยู่ในสถานะ down จากการตรวจสุขภาพล่าสุด");
  const { data: models, error: mErr } = await supabase
    .from("models").select("*").in("provider_id", enabledProviderIds).eq("is_enabled", true)
    .or(`in_cooldown.eq.false,cooldown_until.lt.${nowIso}`).order("priority", { ascending: true });
  if (mErr || !models || models.length === 0) throw new Error("ไม่มีโมเดล AI ที่พร้อมใช้งาน (โมเดลทั้งหมดปิดอยู่หรือติด Cooldown)");
  const limit = configuredLimit(process.env["AIH_MODEL_RPM_LIMIT"], true);
  const eligibleModels = models.filter((m: any) => m.is_enabled !== false && enabledProviderIds.includes(m.provider_id) && (m.capabilities || {})[requiredCapability] === true && !excludeIds.includes(m.id) && (!m.in_cooldown || (m.cooldown_until && m.cooldown_until < nowIso)));
  const matchingModels = eligibleModels.filter((m: any) => rpm.available(m.id, limit));
  if (matchingModels.length === 0) {
    if (eligibleModels.length) throw new RoutingGuardError(429, "Model RPM limit reached", "throttled");
    throw new Error(excludeIds.length ? `ไม่มีโมเดลสำรองเหลือแล้ว (ลองไป ${excludeIds.length} ตัว)` : `ไม่พบโมเดลที่รองรับความสามารถ '${requiredCapability}' (ระบบไม่นับค่า unknown เป็น supported)`);
  }

  const { data: routerState } = await supabase.from("router_state").select("*").eq("id", "GLOBAL_ROUTER").maybeSingle();
  const fallbackIds: string[] = Array.isArray(routerState?.fallback_order) ? routerState.fallback_order : [];
  const orderedModels = [...matchingModels].sort((a: any, b: any) => {
    const ai = fallbackIds.indexOf(a.id), bi = fallbackIds.indexOf(b.id);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    return a.priority - b.priority;
  }).sort((a: any, b: any) => healthRank(providers.find((p: any) => p.id === a.provider_id)?.health_status) - healthRank(providers.find((p: any) => p.id === b.provider_id)?.health_status));
  const ranked = rankModelsByLatency(orderedModels as Array<{ id: string; priority: number; provider_id: string; model_id: string; display_name: string }>, id => latencies.mean(id));
  if (classifyPromptComplexity(prompt) === "simple") ranked.sort((a, b) => {
    const ap = providers.find((p: any) => p.id === a.provider_id), bp = providers.find((p: any) => p.id === b.provider_id);
    return computeCost(ap?.type ?? "openai", a.model_id, 1, 1) - computeCost(bp?.type ?? "openai", b.model_id, 1, 1);
  });
  const selectedModel = ranked[0];
  if (!selectedModel) throw new RoutingGuardError(429, "No eligible model available (cooldown or RPM)", "throttled");
  const provider = providers.find((p: any) => p.id === selectedModel.provider_id);
  if (!provider) throw new Error("Selected model provider is unavailable");
  const secretRecord = Array.isArray(provider?.provider_secrets) ? provider.provider_secrets[0] : provider?.provider_secrets;
  const apiKey = await decryptSecret(secretRecord?.encrypted_secret || null, secretRecord?.encryption_iv || null, secretRecord?.api_key || null);

  let reason = `เลือกตาม ${classifyPromptComplexity(prompt) === "simple" ? "ต้นทุนและ" : ""} Priority (${selectedModel.priority}) / latency (${Math.round(latencies.mean(selectedModel.id))}ms) และรองรับ '${requiredCapability}'`;
  if (fallbackIds.length > 0 && fallbackIds[0] !== selectedModel.id) {
    reason = `Fallback: สลับมาใช้ ${selectedModel.display_name} (${selectedModel.model_id}) อัตโนมัติ`;
    await supabase.from("router_state").update({ last_fallback_event: nowIso, last_fallback_reason: reason }).eq("id", "GLOBAL_ROUTER");
    await logActivity(supabase, { eventType: "ROUTER_FALLBACK", description: reason, modelId: selectedModel.model_id });
  }
  const { provider_secrets: _secrets, ...safeProvider } = provider;
  return { model: selectedModel, provider: safeProvider, apiKey, selectionReason: reason };
}

export type DispatchDeps = {
  fetcher?: typeof fetch; client?: any; now?: () => number;
  throttle?: ModelRpmThrottler; latency?: RollingModelLatency; budgetCap?: number | null; rpmLimit?: number | null;
};
export async function callAIModel(provider: any, model: any, apiKey: string, prompt: string, systemPrompt?: string, deps: DispatchDeps = {}) {
  const keys = parseApiKeys(apiKey);
  if (!keys.length) throw new AIHttpError(401, "Provider key is not configured");
  const gateway = isLovableGateway(provider.base_url);
  const client = deps.client ?? await getServiceClient();
  const cap = deps.budgetCap === undefined ? configuredLimit(process.env["AIH_DAILY_BUDGET_USD"]) : deps.budgetCap;
  const limit = deps.rpmLimit === undefined ? configuredLimit(process.env["AIH_MODEL_RPM_LIMIT"], true) : deps.rpmLimit;
  const throttle = deps.throttle ?? rpm, latency = deps.latency ?? latencies, now = deps.now ?? Date.now;
  const knownSecrets = [...keys, ...Object.values(provider.custom_headers ?? {}).filter((v): v is string => typeof v === "string")];
  const safePrompt = squeezePrompt(maskSensitiveData(prompt, knownSecrets));
  const safeSystem = systemPrompt == null ? undefined : squeezePrompt(maskSensitiveData(systemPrompt, knownSecrets));
  const pool = gateway ? keys.slice(0, 1) : keys;
  for (const [index, key] of pool.entries()) {
    await checkDispatchBudget(client, cap);
    if (!throttle.tryAcquire(model.id, limit)) throw new RoutingGuardError(429, "Model RPM limit reached", "throttled");
    const started = now();
    try {
      return await dispatchModel(provider, model, key, safePrompt, safeSystem, deps.fetcher ?? fetch);
    } catch (error) {
      const err = error instanceof Error && error.name === "TimeoutError" ? new AIHttpError(408, "Model request timed out") : error;
      if (gateway && err instanceof AIHttpError && (err.status === 402 || err.status === 403)) {
        const { error: pauseError } = await client.from("settings").update({ master_pause: true, updated_at: new Date().toISOString() }).eq("id", "SYSTEM_CONFIG");
        if (pauseError) throw new RoutingGuardError(503, "Cannot persist AI pause state", "paused");
      }
      if (!gateway && err instanceof AIHttpError && !err.terminal && [402, 429].includes(err.status) && index + 1 < pool.length) continue;
      throw err;
    } finally { latency.record(model.id, Math.max(0, now() - started)); }
  }
  throw new AIHttpError(503, "Provider key pool exhausted");
}

async function dispatchModel(provider: any, model: any, apiKey: string, prompt: string, systemPrompt: string | undefined, fetcher: typeof fetch) {
  const type = provider.type;
  const baseUrl = provider.base_url.replace(/\/$/, "");
  let resText = "", pTokens = 0, cTokens = 0, cost = 0, isEstimated = false;
  if (type === "anthropic") {
    const res = await fetcher(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...safeCustomHeaders(provider.custom_headers) },
      body: JSON.stringify({ model: model.model_id, max_tokens: 2000, system: systemPrompt || "คุณคือ AI Orchestrator ในระบบ AI Hub", messages: [{ role: "user", content: prompt }] }),
      
    });
    if (!res.ok) throw await responseError(res);
    const data: any = await res.json();
    if (data.stop_reason === "refusal") throw new AIHttpError(403, "Model refused the request", 0, true);
    resText = (data.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
    pTokens = data.usage?.input_tokens || 0;
    cTokens = data.usage?.output_tokens || 0;
  } else if (type === "gemini") {
    const res = await fetcher(`${baseUrl}/v1beta/models/${model.model_id}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...safeCustomHeaders(provider.custom_headers) },
      body: JSON.stringify({ contents: [{ parts: [{ text: (systemPrompt ? systemPrompt + "\n\n" : "") + prompt }] }] }),
      
    });
    if (!res.ok) throw await responseError(res);
    const data: any = await res.json();
    if (data.promptFeedback?.blockReason || ["SAFETY", "PROHIBITED_CONTENT"].includes(data.candidates?.[0]?.finishReason)) throw new AIHttpError(403, "Model refused the request", 0, true);
    resText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    pTokens = data.usageMetadata?.promptTokenCount || Math.ceil(prompt.length / 4);
    cTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(resText.length / 4);
    isEstimated = !data.usageMetadata;
  } else {
    const res = await fetcher(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...safeCustomHeaders(provider.custom_headers) },
      body: JSON.stringify({ model: model.model_id, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: prompt }] }),
      
    });
    if (!res.ok) throw await responseError(res);
    const data: any = await res.json();
    if (data.choices?.[0]?.message?.refusal || data.choices?.[0]?.finish_reason === "content_filter") throw new AIHttpError(403, "Model refused the request", 0, true);
    resText = data.choices?.[0]?.message?.content || "";
    pTokens = data.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
    cTokens = data.usage?.completion_tokens || Math.ceil(resText.length / 4);
    isEstimated = !data.usage;
  }
  if (!resText) throw new AIHttpError(502, "Model returned no text", 0, true);
  cost = computeCost(type, String(model.model_id), pTokens, cTokens);
  return { text: resText, promptTokens: pTokens, completionTokens: cTokens, cost, isEstimated };
}

function safeCustomHeaders(value: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => !["authorization", "x-api-key", "api-key", "apikey", "content-type"].includes(k.toLowerCase())));
}
async function responseError(res: Response): Promise<AIHttpError> {
  const retry = res.headers.get("Retry-After");
  const retryMs = retry == null ? 0 : /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
  const body: any = await res.json().catch(() => ({}));
  const permanent = body?.props?.retryable === false || body?.error?.props?.retryable === false;
  return new AIHttpError(res.status, `Model request failed (HTTP ${res.status})`, Number.isFinite(retryMs) ? retryMs : 0, permanent);
}

/** Free list-models probe (no tokens consumed) used by manual tests and the R34 heartbeat. */
export async function testProviderConnection(provider: any, apiKey: string, fetcher: typeof fetch = fetch): Promise<{ success: boolean; latency: number; status?: number; error?: string }> {
  const type = provider.type;
  const baseUrl = provider.base_url.replace(/\/$/, "");
  const startTime = Date.now();
  try {
    const key = parseApiKeys(apiKey)[0] ?? "";
    let res: Response;
    if (type === "anthropic") res = await fetcher(`${baseUrl}/v1/models`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", ...safeCustomHeaders(provider.custom_headers) }, signal: AbortSignal.timeout(8000) });
    else if (type === "gemini") res = await fetcher(`${baseUrl}/v1beta/models?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
    else res = await fetcher(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}`, ...safeCustomHeaders(provider.custom_headers) }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { success: false, latency: Date.now() - startTime, status: res.status, error: res.status === 401 || res.status === 403 ? "API Key ไม่ถูกต้อง" : `HTTP ${res.status}` };
    return { success: true, latency: Date.now() - startTime, status: res.status };
  } catch (err: any) {
    return { success: false, latency: Date.now() - startTime, error: err?.name === "TimeoutError" ? "Timeout" : "Network error" };
  }
}

export async function putModelInCooldown(modelId: string, reason: string) {
  const supabase = await getServiceClient();
  const { data: routerState } = await supabase.from("router_state").select("cooldown_duration_seconds").eq("id", "GLOBAL_ROUTER").single();
  const duration = routerState?.cooldown_duration_seconds || 300;
  const cooldownUntil = new Date(Date.now() + duration * 1000).toISOString();
  await supabase.from("models").update({ in_cooldown: true, cooldown_until: cooldownUntil }).eq("id", modelId);
  await supabase.from("notifications").insert({ title: "โมเดล AI เข้าสู่สถานะ Cooldown", message: `โมเดลถูกระงับชั่วคราว ${duration} วินาทีเนื่องจาก: ${reason}`, type: "COOLDOWN_ALERT", reference_id: modelId });
  await logActivity(supabase, { eventType: "MODEL_COOLDOWN", description: `โมเดล ID ${modelId} เข้าสู่สถานะ Cooldown (${duration}s): ${reason}`, details: { cooldownUntil, reason } });
}
