import { getServiceClient, logActivity, decryptSecret } from "./core";

export class AIHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "AIHttpError"; }
}
/** 402 (payment/quota) and 429 (rate limit) mean "try another model", not "fail the step". */
export function isFallbackError(err: unknown): boolean {
  return err instanceof AIHttpError && (err.status === 402 || err.status === 429);
}

// USD per token (input, output). Unknown models fall back to their provider's default.
const PRICING: Record<string, { default: [number, number]; models: Record<string, [number, number]> }> = {
  anthropic: { default: [3e-6, 15e-6], models: { haiku: [0.8e-6, 4e-6], sonnet: [3e-6, 15e-6], opus: [15e-6, 75e-6] } },
  gemini: { default: [0.3e-6, 2.5e-6], models: { "flash-lite": [0.1e-6, 0.4e-6], flash: [0.3e-6, 2.5e-6], pro: [1.25e-6, 10e-6] } },
  openai: { default: [2.5e-6, 10e-6], models: { "gpt-4o-mini": [0.15e-6, 0.6e-6], "gpt-4o": [2.5e-6, 10e-6], "gpt-4.1-mini": [0.4e-6, 1.6e-6], "gpt-4.1": [2e-6, 8e-6] } },
};
export function computeCost(providerType: string, modelId: string, promptTokens: number, completionTokens: number): number {
  const table = PRICING[providerType] ?? PRICING["openai"]!;
  const id = modelId.toLowerCase();
  const match = Object.keys(table.models).sort((a, b) => b.length - a.length).find((k) => id.includes(k));
  const [inp, out] = (match && table.models[match]) || table.default;
  return promptTokens * inp + completionTokens * out;
}

export interface SelectedModelResult { model: any; provider: any; apiKey: string; selectionReason: string }

export async function pickBestModel(requiredCapability: "text" | "image" | "tools" | "long_context" = "text", excludeIds: string[] = []): Promise<SelectedModelResult> {
  const supabase = await getServiceClient();
  const nowIso = new Date().toISOString();
  // Release expired cooldowns so the flag matches reality.
  await supabase.from("models").update({ in_cooldown: false, cooldown_until: null }).eq("in_cooldown", true).lt("cooldown_until", nowIso);
  const { data: providers, error: pErr } = await supabase.from("providers").select("*, provider_secrets(api_key,encrypted_secret,encryption_iv)").eq("is_enabled", true);
  if (pErr || !providers || providers.length === 0) throw new Error("ไม่มีผู้ให้บริการ AI (Provider) ที่เปิดใช้งานอยู่ในระบบ");
  const enabledProviderIds = providers.map((p: any) => p.id);
  const { data: models, error: mErr } = await supabase
    .from("models").select("*").in("provider_id", enabledProviderIds).eq("is_enabled", true)
    .or(`in_cooldown.eq.false,cooldown_until.lt.${nowIso}`).order("priority", { ascending: true });
  if (mErr || !models || models.length === 0) throw new Error("ไม่มีโมเดล AI ที่พร้อมใช้งาน (โมเดลทั้งหมดปิดอยู่หรือติด Cooldown)");
  const matchingModels = models.filter((m: any) => (m.capabilities || {})[requiredCapability] === true && !excludeIds.includes(m.id));
  if (matchingModels.length === 0) throw new Error(excludeIds.length ? `ไม่มีโมเดลสำรองเหลือแล้ว (ลองไป ${excludeIds.length} ตัว)` : `ไม่พบโมเดลที่รองรับความสามารถ '${requiredCapability}' (ระบบไม่นับค่า unknown เป็น supported)`);

  const { data: routerState } = await supabase.from("router_state").select("*").eq("id", "GLOBAL_ROUTER").maybeSingle();
  const fallbackIds: string[] = Array.isArray(routerState?.fallback_order) ? routerState.fallback_order : [];
  const orderedModels = [...matchingModels].sort((a: any, b: any) => {
    const ai = fallbackIds.indexOf(a.id), bi = fallbackIds.indexOf(b.id);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
    return a.priority - b.priority;
  });
  const selectedModel = orderedModels[0];
  const provider = providers.find((p: any) => p.id === selectedModel.provider_id);
  const secretRecord = Array.isArray(provider?.provider_secrets) ? provider.provider_secrets[0] : provider?.provider_secrets;
  const apiKey = await decryptSecret(secretRecord?.encrypted_secret || null, secretRecord?.encryption_iv || null, secretRecord?.api_key || null);

  let reason = `เลือกตาม Priority (${selectedModel.priority}) และรองรับความสามารถ '${requiredCapability}'`;
  if (fallbackIds.length > 0 && fallbackIds[0] !== selectedModel.id) {
    reason = `Fallback: สลับมาใช้ ${selectedModel.display_name} (${selectedModel.model_id}) อัตโนมัติ`;
    await supabase.from("router_state").update({ last_fallback_event: nowIso, last_fallback_reason: reason }).eq("id", "GLOBAL_ROUTER");
    await logActivity(supabase, { eventType: "ROUTER_FALLBACK", description: reason, modelId: selectedModel.model_id });
  }
  return { model: selectedModel, provider, apiKey, selectionReason: reason };
}

export async function callAIModel(provider: any, model: any, apiKey: string, prompt: string, systemPrompt?: string) {
  const type = provider.type;
  const baseUrl = provider.base_url.replace(/\/$/, "");
  let resText = "", pTokens = 0, cTokens = 0, cost = 0, isEstimated = false;
  if (type === "anthropic") {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(provider.custom_headers || {}) },
      body: JSON.stringify({ model: model.model_id, max_tokens: 2000, system: systemPrompt || "คุณคือ AI Orchestrator ในระบบ AI Hub", messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new AIHttpError(res.status, `Anthropic error HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data: any = await res.json();
    resText = data.content?.[0]?.text || "";
    pTokens = data.usage?.input_tokens || 0;
    cTokens = data.usage?.output_tokens || 0;
  } else if (type === "gemini") {
    const res = await fetch(`${baseUrl}/v1beta/models/${model.model_id}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(provider.custom_headers || {}) },
      body: JSON.stringify({ contents: [{ parts: [{ text: (systemPrompt ? systemPrompt + "\n\n" : "") + prompt }] }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new AIHttpError(res.status, `Gemini error HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data: any = await res.json();
    resText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    pTokens = data.usageMetadata?.promptTokenCount || Math.ceil(prompt.length / 4);
    cTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(resText.length / 4);
    isEstimated = !data.usageMetadata;
  } else {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(provider.custom_headers || {}) },
      body: JSON.stringify({ model: model.model_id, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new AIHttpError(res.status, `OpenAI error HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data: any = await res.json();
    resText = data.choices?.[0]?.message?.content || "";
    pTokens = data.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
    cTokens = data.usage?.completion_tokens || Math.ceil(resText.length / 4);
    isEstimated = !data.usage;
  }
  cost = computeCost(type, String(model.model_id), pTokens, cTokens);
  return { text: resText, promptTokens: pTokens, completionTokens: cTokens, cost, isEstimated };
}

export async function testProviderConnection(provider: any, apiKey: string): Promise<{ success: boolean; latency: number; error?: string }> {
  const type = provider.type;
  const baseUrl = provider.base_url.replace(/\/$/, "");
  const startTime = Date.now();
  try {
    let res: Response;
    if (type === "anthropic") {
      res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403) throw new Error("API Key ไม่ถูกต้อง");
    } else if (type === "gemini") {
      res = await fetch(`${baseUrl}/v1beta/models?key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } else {
      res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}`, ...(provider.custom_headers || {}) }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return { success: true, latency: Date.now() - startTime };
  } catch (err: any) {
    return { success: false, latency: Date.now() - startTime, error: err.message };
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
