// R33 shadow evaluation, R34 provider health, R35 per-model ledger. Pure helpers first, DB wiring injected.
import { computeCost } from "./router-core";

export type HealthStatus = "unknown" | "healthy" | "degraded" | "down";
export const HEALTH_INTERVAL_MS = 5 * 60_000;
export const DEGRADED_LATENCY_MS = 3000;
const OUTPUT_LIMIT = 4000;

/** R34: classify a free list-models probe. Auth failures are down immediately; network/5xx go down after 2 in a row. */
export function classifyHealth(probe: { success: boolean; latency: number; status?: number }, previousFailures: number): { status: HealthStatus; failures: number } {
  if (probe.success) return { status: probe.latency > DEGRADED_LATENCY_MS ? "degraded" : "healthy", failures: 0 };
  const failures = previousFailures + 1;
  if (probe.status === 401 || probe.status === 403) return { status: "down", failures };
  return { status: failures >= 2 ? "down" : "degraded", failures };
}
export function isHealthCheckDue(checkedAt: string | null | undefined, now = Date.now()): boolean {
  return !checkedAt || now - Date.parse(checkedAt) >= HEALTH_INTERVAL_MS;
}
/** Router: never pick a down provider; degraded ones sort after healthy/unknown. */
export function healthRank(status: string | null | undefined): number {
  return status === "down" ? Infinity : status === "degraded" ? 1 : 0;
}

/** R33: off unless a positive rate is configured. */
export function shouldShadow(rate: unknown, random: () => number = Math.random): boolean {
  const r = Number(rate);
  return Number.isFinite(r) && r > 0 && random() < Math.min(1, r);
}
/** R33: cheapest enabled, text-capable, non-cooldown model on a non-down provider, excluding the primary. */
export function selectShadowModel(models: any[], providers: any[], primaryId: string, nowIso = new Date().toISOString()) {
  const candidates = models.flatMap(m => {
    const p = providers.find(x => x.id === m.provider_id);
    if (!p || !p.is_enabled || p.health_status === "down" || m.id === primaryId || m.is_enabled === false) return [];
    if ((m.capabilities || {}).text !== true) return [];
    if (m.in_cooldown && !(m.cooldown_until && m.cooldown_until < nowIso)) return [];
    return [{ model: m, provider: p, unit: computeCost(p.type, String(m.model_id), 1, 1) }];
  });
  candidates.sort((a, b) => a.unit - b.unit || a.model.priority - b.model.priority);
  return candidates[0] ?? null;
}
export const clip = (s: string | null | undefined) => (s == null ? null : s.slice(0, OUTPUT_LIMIT));

/** R35: per-model and per-provider token/cost breakdown. */
export type LedgerRow = { model_id: string; provider_id: string | null; prompt_tokens: number; completion_tokens: number; cost: number | string; is_estimated?: boolean; source?: string };
export function summarizeLedger(rows: LedgerRow[], providerNames: Record<string, string> = {}) {
  const models = new Map<string, any>(), providers = new Map<string, any>();
  const totals = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, shadowCost: 0 };
  for (const r of rows) {
    const cost = Number(r.cost) || 0, pt = r.prompt_tokens || 0, ct = r.completion_tokens || 0;
    const pid = r.provider_id ?? "unknown";
    const mk = `${pid}::${r.model_id}`;
    const m = models.get(mk) ?? { modelId: r.model_id, providerId: pid, providerName: providerNames[pid] ?? pid, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, estimatedRequests: 0, shadowRequests: 0 };
    const p = providers.get(pid) ?? { providerId: pid, providerName: providerNames[pid] ?? pid, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
    for (const o of [m, p, totals]) { o.requests++; o.promptTokens += pt; o.completionTokens += ct; o.totalTokens += pt + ct; o.cost += cost; }
    if (r.is_estimated) m.estimatedRequests++;
    if (r.source === "shadow") { m.shadowRequests++; totals.shadowCost += cost; }
    models.set(mk, m); providers.set(pid, p);
  }
  const byCost = (a: any, b: any) => b.cost - a.cost || b.totalTokens - a.totalTokens;
  return { totals, byModel: [...models.values()].sort(byCost), byProvider: [...providers.values()].sort(byCost) };
}

// ---------- DB wiring ----------
export async function runProviderHeartbeat(deps: { client: any; probe: (provider: any) => Promise<{ success: boolean; latency: number; status?: number; error?: string }>; now?: number; force?: boolean }) {
  const now = deps.now ?? Date.now();
  const { data: providers, error } = await deps.client.from("providers").select("id,name,type,base_url,custom_headers,is_enabled,health_checked_at,health_failures").eq("is_enabled", true);
  if (error) throw new Error("Cannot load providers for health check");
  const results: any[] = [];
  for (const p of providers ?? []) {
    if (!deps.force && !isHealthCheckDue(p.health_checked_at, now)) continue;
    const probe = await deps.probe(p);
    const next = classifyHealth(probe, p.health_failures ?? 0);
    await deps.client.from("providers").update({ health_status: next.status, health_failures: next.failures, health_latency_ms: Math.round(probe.latency), health_checked_at: new Date(now).toISOString(), health_error: probe.success ? null : (probe.error ?? "probe failed").slice(0, 200) }).eq("id", p.id);
    results.push({ providerId: p.id, name: p.name, status: next.status, latencyMs: Math.round(probe.latency) });
  }
  return results;
}

export async function loadUsageLedger(client: any, sinceIso: string) {
  const rows: LedgerRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from("usage_records").select("model_id,provider_id,prompt_tokens,completion_tokens,cost,is_estimated,source").gte("created_at", sinceIso).order("id").range(offset, offset + 999);
    if (error) throw new Error("Cannot load usage ledger");
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: provs } = await client.from("providers").select("id,name");
  return summarizeLedger(rows, Object.fromEntries((provs ?? []).map((p: any) => [p.id, p.name])));
}

export type ShadowDeps = { client: any; call: (provider: any, model: any, apiKey: string, prompt: string, system?: string) => Promise<any>; decrypt: (enc: string | null, iv: string | null, plain: string | null) => Promise<string>; now?: () => number; random?: () => number };
/** R33: runs after the primary answer; caller must not await it on the user path. Never throws. */
export async function runShadowEvaluation(deps: ShadowDeps, input: { prompt: string; system?: string | undefined; primary: { model: any; result: any; latencyMs: number } }) {
  const now = deps.now ?? Date.now;
  const base = { primary_model_id: String(input.primary.model.model_id), primary_latency_ms: Math.round(input.primary.latencyMs), primary_prompt_tokens: input.primary.result.promptTokens ?? 0, primary_completion_tokens: input.primary.result.completionTokens ?? 0, primary_cost: input.primary.result.cost ?? 0, primary_output: clip(input.primary.result.text) };
  try {
    const { data: settings } = await deps.client.from("settings").select("shadow_sample_rate,master_pause").eq("id", "SYSTEM_CONFIG").maybeSingle();
    if (!settings || settings.master_pause || !shouldShadow(settings.shadow_sample_rate, deps.random)) return { status: "off" as const };
    const { data: providers } = await deps.client.from("providers").select("*, provider_secrets(api_key,encrypted_secret,encryption_iv)").eq("is_enabled", true);
    const { data: models } = await deps.client.from("models").select("*").eq("is_enabled", true);
    const pick = selectShadowModel(models ?? [], providers ?? [], input.primary.model.id);
    if (!pick) { await deps.client.from("shadow_evaluations").insert({ ...base, status: "skipped", error: "No alternative model available" }); return { status: "skipped" as const }; }
    const secret = Array.isArray(pick.provider.provider_secrets) ? pick.provider.provider_secrets[0] : pick.provider.provider_secrets;
    const key = await deps.decrypt(secret?.encrypted_secret ?? null, secret?.encryption_iv ?? null, secret?.api_key ?? null);
    const { provider_secrets: _s, ...provider } = pick.provider;
    const started = now();
    try {
      const r = await deps.call(provider, pick.model, key, input.prompt, input.system);
      const latency = Math.max(0, now() - started);
      await deps.client.from("usage_records").insert({ provider_id: provider.id, model_id: pick.model.model_id, task_id: null, prompt_tokens: r.promptTokens, completion_tokens: r.completionTokens, cost: r.cost, is_estimated: r.isEstimated, source: "shadow" });
      await deps.client.from("shadow_evaluations").insert({ ...base, shadow_model_id: String(pick.model.model_id), shadow_provider_id: provider.id, status: "success", shadow_latency_ms: Math.round(latency), shadow_prompt_tokens: r.promptTokens, shadow_completion_tokens: r.completionTokens, shadow_cost: r.cost, shadow_output: clip(r.text) });
      return { status: "success" as const };
    } catch (e: any) {
      await deps.client.from("shadow_evaluations").insert({ ...base, shadow_model_id: String(pick.model.model_id), shadow_provider_id: provider.id, status: "failed", shadow_latency_ms: Math.round(Math.max(0, now() - started)), error: String(e?.message ?? e).slice(0, 200) });
      return { status: "failed" as const };
    }
  } catch (e) {
    console.error("shadow evaluation error", e instanceof Error ? e.message : "unknown");
    return { status: "failed" as const };
  }
}
