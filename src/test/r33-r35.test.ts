import { describe, it, expect, vi } from "vitest";
import { classifyHealth, isHealthCheckDue, healthRank, shouldShadow, selectShadowModel, summarizeLedger, runProviderHeartbeat, runShadowEvaluation, HEALTH_INTERVAL_MS } from "@/server/hub/model-observability";
import { callWithFallback } from "@/server/hub/jobs";

function fakeClient(tables: Record<string, any>) {
  const inserts: Record<string, any[]> = {}, updates: any[] = [];
  const q = (name: string) => {
    const chain: any = {
      select: () => chain, eq: () => chain, gte: () => chain, order: () => chain,
      range: async () => ({ data: tables[name] ?? [], error: null }),
      maybeSingle: async () => ({ data: tables[name] ?? null, error: null }),
      insert: async (row: any) => { (inserts[name] ??= []).push(row); return { error: null }; },
      update: (row: any) => ({ eq: async (_k: string, id: any) => { updates.push({ table: name, id, row }); return { error: null }; } }),
      then: (res: any) => res({ data: tables[name] ?? [], error: null }),
    };
    return chain;
  };
  return { client: { from: q }, inserts, updates };
}

const providers = [
  { id: "p1", type: "openai", is_enabled: true, health_status: "healthy" },
  { id: "p2", type: "anthropic", is_enabled: true, health_status: "healthy" },
  { id: "p3", type: "gemini", is_enabled: true, health_status: "down" },
];
const models = [
  { id: "m1", provider_id: "p1", model_id: "gpt-4o", priority: 1, capabilities: { text: true } },
  { id: "m2", provider_id: "p1", model_id: "gpt-4o-mini", priority: 2, capabilities: { text: true } },
  { id: "m3", provider_id: "p2", model_id: "claude-haiku", priority: 3, capabilities: { text: true } },
  { id: "m4", provider_id: "p3", model_id: "gemini-flash-lite", priority: 4, capabilities: { text: true } },
];

describe("R34 provider health heartbeat", () => {
  it("classifies probes", () => {
    expect(classifyHealth({ success: true, latency: 200 }, 3)).toEqual({ status: "healthy", failures: 0 });
    expect(classifyHealth({ success: true, latency: 3500 }, 0).status).toBe("degraded");
    expect(classifyHealth({ success: false, latency: 0 }, 0)).toEqual({ status: "degraded", failures: 1 });
    expect(classifyHealth({ success: false, latency: 0 }, 1)).toEqual({ status: "down", failures: 2 });
    expect(classifyHealth({ success: false, latency: 0, status: 401 }, 0).status).toBe("down");
  });
  it("is due every 5 minutes and ranks down providers out", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(isHealthCheckDue(null, now)).toBe(true);
    expect(isHealthCheckDue(new Date(now - HEALTH_INTERVAL_MS + 1000).toISOString(), now)).toBe(false);
    expect(isHealthCheckDue(new Date(now - HEALTH_INTERVAL_MS).toISOString(), now)).toBe(true);
    expect(healthRank("down")).toBe(Infinity);
    expect(healthRank("degraded")).toBeGreaterThan(healthRank("healthy"));
  });
  it("probes only due providers unless forced and stores status", async () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    const { client, updates } = fakeClient({ providers: [
      { id: "a", health_checked_at: null, health_failures: 0 },
      { id: "b", health_checked_at: new Date(now - 60_000).toISOString(), health_failures: 0 },
    ] });
    const probe = vi.fn(async () => ({ success: false, latency: 10, status: 503, error: "HTTP 503" }));
    const r = await runProviderHeartbeat({ client, probe, now });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(r[0]).toMatchObject({ providerId: "a", status: "degraded" });
    expect(updates[0].row).toMatchObject({ health_status: "degraded", health_failures: 1, health_error: "HTTP 503" });
    await runProviderHeartbeat({ client, probe, now, force: true });
    expect(probe).toHaveBeenCalledTimes(3);
  });
});

describe("R33 shadow evaluation", () => {
  it("is off at rate 0 and samples otherwise", () => {
    expect(shouldShadow(0, () => 0)).toBe(false);
    expect(shouldShadow(null, () => 0)).toBe(false);
    expect(shouldShadow(0.1, () => 0.05)).toBe(true);
    expect(shouldShadow(0.1, () => 0.5)).toBe(false);
  });
  it("picks cheapest enabled model, excluding primary and down providers", () => {
    expect(selectShadowModel(models, providers, "m1")?.model.id).toBe("m2");
    expect(selectShadowModel(models, providers, "m2")?.model.id).toBe("m3");
    expect(selectShadowModel([models[0], models[3]], providers, "m1")).toBeNull();
  });
  it("does nothing when rate is 0 (no paid call)", async () => {
    const { client, inserts } = fakeClient({ settings: { shadow_sample_rate: 0, master_pause: false } });
    const call = vi.fn();
    expect((await runShadowEvaluation({ client, call, decrypt: async () => "k" }, { prompt: "hi", primary: { model: models[0], result: { text: "a" }, latencyMs: 5 } })).status).toBe("off");
    expect(call).not.toHaveBeenCalled();
    expect(inserts.shadow_evaluations).toBeUndefined();
  });
  it("records latency, tokens, cost and outputs of both models, tagging usage as shadow", async () => {
    let t = 1000;
    const { client, inserts } = fakeClient({ settings: { shadow_sample_rate: 1, master_pause: false }, providers: providers.map(p => ({ ...p, provider_secrets: [{ api_key: "x" }] })), models });
    const call = vi.fn(async () => { t += 250; return { text: "shadow", promptTokens: 5, completionTokens: 7, cost: 0.001, isEstimated: false }; });
    const r = await runShadowEvaluation({ client, call, decrypt: async () => "k", now: () => t, random: () => 0 }, { prompt: "hi", primary: { model: models[0], result: { text: "primary", promptTokens: 5, completionTokens: 9, cost: 0.01 }, latencyMs: 800 } });
    expect(r.status).toBe("success");
    expect((call.mock.calls[0] as any[])[0]).not.toHaveProperty("provider_secrets");
    expect(inserts.shadow_evaluations[0]).toMatchObject({ primary_model_id: "gpt-4o", primary_latency_ms: 800, primary_output: "primary", shadow_model_id: "gpt-4o-mini", shadow_latency_ms: 250, shadow_completion_tokens: 7, shadow_output: "shadow", status: "success" });
    expect(inserts.usage_records[0]).toMatchObject({ source: "shadow", model_id: "gpt-4o-mini" });
  });
  it("records failure without throwing", async () => {
    const { client, inserts } = fakeClient({ settings: { shadow_sample_rate: 1, master_pause: false }, providers, models });
    const r = await runShadowEvaluation({ client, call: async () => { throw new Error("HTTP 503"); }, decrypt: async () => "k", random: () => 0 }, { prompt: "hi", primary: { model: models[0], result: { text: "p" }, latencyMs: 1 } });
    expect(r.status).toBe("failed");
    expect(inserts.shadow_evaluations[0]).toMatchObject({ status: "failed", error: "HTTP 503" });
  });
  it("does not block or break the primary answer", async () => {
    const afterSuccess = vi.fn(() => { throw new Error("must be caught by starter, not here"); });
    const ok = { text: "done", promptTokens: 1, completionTokens: 1, cost: 0 };
    const deps: any = { pick: async () => ({ model: models[0], provider: { base_url: "https://api.openai.com/v1" }, apiKey: "k" }), call: async () => ok, cooldown: async () => {}, wait: async () => {}, afterSuccess: vi.fn() };
    const r = await callWithFallback("hi", undefined, deps);
    expect(r.result).toBe(ok);
    expect(deps.afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ prompt: "hi", primary: expect.objectContaining({ model: models[0], result: ok }) }));
    expect(afterSuccess).not.toHaveBeenCalled();
  });
});

describe("R35 per-model cost & token ledger", () => {
  it("breaks down by model and provider", () => {
    const s = summarizeLedger([
      { model_id: "gpt-4o", provider_id: "p1", prompt_tokens: 100, completion_tokens: 50, cost: "0.002" },
      { model_id: "gpt-4o", provider_id: "p1", prompt_tokens: 10, completion_tokens: 5, cost: 0.0002, is_estimated: true },
      { model_id: "gpt-4o-mini", provider_id: "p1", prompt_tokens: 20, completion_tokens: 20, cost: 0.0001, source: "shadow" },
      { model_id: "claude-haiku", provider_id: "p2", prompt_tokens: 1, completion_tokens: 1, cost: 0.01 },
    ], { p1: "OpenAI", p2: "Anthropic" });
    expect(s.totals).toMatchObject({ requests: 4, promptTokens: 131, completionTokens: 76, totalTokens: 207 });
    expect(s.totals.cost).toBeCloseTo(0.0123);
    expect(s.totals.shadowCost).toBeCloseTo(0.0001);
    const g = s.byModel.find(m => m.modelId === "gpt-4o")!;
    expect(g).toMatchObject({ requests: 2, totalTokens: 165, estimatedRequests: 1, providerName: "OpenAI" });
    expect(g.cost).toBeCloseTo(0.0022);
    expect(s.byModel[0].modelId).toBe("claude-haiku");
    expect(s.byProvider.find(p => p.providerId === "p1")).toMatchObject({ requests: 3, totalTokens: 205 });
  });
  it("handles empty input", () => {
    expect(summarizeLedger([])).toEqual({ totals: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, shadowCost: 0 }, byModel: [], byProvider: [] });
  });
});
