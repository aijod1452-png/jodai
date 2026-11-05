// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
const core = vi.hoisted(() => ({ getServiceClient: vi.fn(), decryptSecret: vi.fn(async () => "pool-key"), logActivity: vi.fn(async () => {}) }));
vi.mock("../server/hub/core", () => core);
import { AIHttpError, RoutingGuardError, callAIModel, checkDispatchBudget, pickBestModel, isExpandedFallbackError, fallbackDelayMs } from "../server/hub/router-core";
import { callWithFallback, type FallbackDeps } from "../server/hub/jobs";
import { RollingModelLatency, ModelRpmThrottler, rankModelsByLatency, classifyPromptComplexity, isBudgetExceeded, utcDayWindow, parseApiKeys, maskSensitiveData, squeezePrompt, configuredLimit } from "../server/hub/routing-policy";
import { runChatPipeline, type PipelineStore } from "../server/hub/chat-pipeline";
import { handleChatCompletions } from "../server/hub/openai-gateway";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const provider = { id: "p", type: "openai", base_url: "https://provider.test/v1" };
const model = { id: "m", model_id: "gpt-4o-mini", display_name: "Mini", priority: 1 };
const success = () => Response.json({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
function database(costs: unknown[] = [], options: { spendError?: boolean; paused?: boolean; settingsError?: boolean } = {}) {
  const seen: Array<[string, unknown[]]> = [];
  const update = vi.fn(() => chain("settings", { data: null, error: null }));
  function chain(table: string, result: any): any {
    const q: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "eq", "gte", "lt", "order", "range", "maybeSingle"]) q[method] = (...args: unknown[]) => { seen.push([`${table}.${method}`, args]); return q; };
    q.update = update;
    return q;
  }
  return { seen, update, from: vi.fn((table: string) => chain(table, table === "settings" ? { data: { master_pause: options.paused ?? false }, error: options.settingsError ? {} : null } : { data: costs.map(cost => ({ cost })), error: options.spendError ? {} : null })) };
}
function dispatch(fetcher: typeof fetch, extra: any = {}) {
  return callAIModel(provider, model, "first-key,second-key", "hello", undefined, { fetcher, client: database(), budgetCap: null, rpmLimit: null, throttle: new ModelRpmThrottler(), ...extra });
}
function fallback(call: FallbackDeps["call"], baseUrl = provider.base_url): FallbackDeps {
  return {
    pick: vi.fn(async (_cap, tried) => { const id = ["a", "b", "c", "d"].find(id => !tried?.includes(id)); if (!id) throw new Error("No model remains"); return { provider: { ...provider, base_url: baseUrl }, model: { ...model, id }, apiKey: "key", selectionReason: "test" }; }),
    call, cooldown: vi.fn(async () => {}), wait: vi.fn(async () => {}),
  };
}

describe("R24 latency ranking", () => {
  it("weights priority by latency seconds and preserves ties without mutating models", () => {
    const rows = [{ id: "slow", priority: 1 }, { id: "fast", priority: 2 }, { id: "tie", priority: 2 }];
    expect(rankModelsByLatency(rows, id => id === "slow" ? 3000 : 0).map(x => x.id)).toEqual(["fast", "tie", "slow"]);
    expect(rows[0]?.id).toBe("slow");
  });
  it("keeps the latest 20 observations and ignores invalid values", () => {
    const latency = new RollingModelLatency(); latency.record("x", 10000);
    for (let i = 0; i < 20; i++) latency.record("x", 100);
    latency.record("x", NaN); latency.record("x", -1);
    expect(latency.mean("x")).toBe(100); expect(latency.mean("unknown")).toBe(0);
  });
  it("records real response latency on both success and failure", async () => {
    let clock = 0; const latency = new RollingModelLatency();
    const fetcher = vi.fn(async () => { clock += 70; return success(); });
    await dispatch(fetcher as typeof fetch, { latency, now: () => clock });
    expect(latency.mean("m")).toBe(70);
    await expect(dispatch(vi.fn(async () => { clock += 130; return new Response("failure", { status: 503 }); }) as typeof fetch, { latency, now: () => clock })).rejects.toMatchObject({ status: 503 });
    expect(latency.mean("m")).toBe(100);
  });
});

describe("R25 circuit breaker and R28 error set", () => {
  it.each([402, 429, 408, 502, 503, 504])("HTTP %s falls back once and cools the failed model", async status => {
    expect(isExpandedFallbackError(new AIHttpError(status, "error"))).toBe(true);
    const call = vi.fn().mockRejectedValueOnce(new AIHttpError(status, "error")).mockResolvedValueOnce({ text: "ok" });
    const deps = fallback(call);
    const result = await callWithFallback("hello", undefined, deps);
    expect(result.tried).toEqual(["a"]); expect(result.router.model.id).toBe("b");
    expect(deps.cooldown).toHaveBeenCalledWith("a", `HTTP ${status}`);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 404, 500])("HTTP %s is terminal", async status => {
    expect(isExpandedFallbackError(new AIHttpError(status, "error"))).toBe(false);
    const deps = fallback(vi.fn().mockRejectedValue(new AIHttpError(status, "error")));
    await expect(callWithFallback("x", undefined, deps)).rejects.toMatchObject({ status });
    expect(deps.call).toHaveBeenCalledTimes(1); expect(deps.cooldown).not.toHaveBeenCalled();
  });
  it("does not revisit a model even if the selector incorrectly repeats it", async () => {
    const deps = fallback(vi.fn().mockRejectedValue(new AIHttpError(503, "error")));
    deps.pick = vi.fn(async () => ({ provider, model, apiKey: "x", selectionReason: "test" }));
    await expect(callWithFallback("x", undefined, deps)).rejects.toThrow("No untried model");
    expect(deps.call).toHaveBeenCalledTimes(1);
  });
  it("recognizes timeout but never cancellation or generic network errors", async () => {
    expect(isExpandedFallbackError(new DOMException("timeout", "TimeoutError"))).toBe(true);
    expect(isExpandedFallbackError(new DOMException("cancelled", "AbortError"))).toBe(false);
    expect(isExpandedFallbackError(new Error("network"))).toBe(false);
    await expect(dispatch(vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }) as typeof fetch)).rejects.toMatchObject({ status: 408 });
  });
  it("gateway 402 persists master pause and never rotates keys or models", async () => {
    const db = database(), fetcher = vi.fn(async () => Response.json({ message: "quota" }, { status: 402 }));
    const call = vi.fn(async (_p, m, keys, prompt) => callAIModel({ ...provider, base_url: "https://ai.gateway.lovable.dev/v1" }, m, keys, prompt, undefined, { client: db, fetcher: fetcher as typeof fetch, budgetCap: null, rpmLimit: null }));
    const deps = fallback(call, "https://ai.gateway.lovable.dev/v1");
    await expect(callWithFallback("x", undefined, deps)).rejects.toMatchObject({ status: 402 });
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ master_pause: true }));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(deps.cooldown).not.toHaveBeenCalled();
  });
  it("gateway Retry-After is honored with bounded recovery", async () => {
    const deps = fallback(vi.fn().mockRejectedValueOnce(new AIHttpError(429, "rate", 3000)).mockResolvedValueOnce({ text: "ok" }), "https://ai.gateway.lovable.dev/v1");
    await callWithFallback("x", undefined, deps); expect(deps.wait).toHaveBeenCalledWith(3000);
    expect(fallbackDelayMs(new AIHttpError(503, ""), 1)).toBe(2000);
    const exhausted = fallback(vi.fn().mockRejectedValue(new AIHttpError(503, "error")), "https://ai.gateway.lovable.dev/v1");
    await expect(callWithFallback("x", undefined, exhausted)).rejects.toMatchObject({ status: 503 });
    expect(exhausted.call).toHaveBeenCalledTimes(3);
    const longWait = fallback(vi.fn().mockRejectedValue(new AIHttpError(429, "error", 9000)), "https://ai.gateway.lovable.dev/v1");
    await expect(callWithFallback("x", undefined, longWait)).rejects.toMatchObject({ status: 429 });
    expect(longWait.wait).not.toHaveBeenCalled();
  });
});

describe("R26 tier routing", () => {
  it.each(["hello", "สวัสดี", "a".repeat(500)])("short ordinary prompts stay simple", prompt => expect(classifyPromptComplexity(prompt)).toBe("simple"));
  it.each(["a".repeat(501), "analyze this", "write code", "วางแผนงาน", "ส่ง LINE", "```js\nx\n```"])("complex prompts stay complex", prompt => expect(classifyPromptComplexity(prompt)).toBe("complex"));
  it("selects cheap eligible models for simple prompts, priority for complex, and releases cooldown", async () => {
    vi.stubEnv("AIH_MODEL_RPM_LIMIT", "");
    const rows: Array<typeof model & { provider_id: string; capabilities: { text: boolean }; in_cooldown?: boolean; cooldown_until?: string }> = [
      { ...model, id: "expensive", model_id: "gpt-4o", priority: 1, provider_id: "p", capabilities: { text: true } },
      { ...model, id: "cheap", priority: 3, provider_id: "p", capabilities: { text: true } },
      { ...model, id: "cooled", priority: 0, provider_id: "p", capabilities: { text: true }, in_cooldown: true, cooldown_until: "2999-01-01" },
      { ...model, id: "wrong-cap", priority: 0, provider_id: "p", capabilities: { text: false } },
    ];
    const updates = vi.fn();
    const db = { from: (table: string) => {
      let write = false;
      const result = () => table === "providers" ? { data: [{ ...provider, provider_secrets: { api_key: "x" } }] } : table === "models" ? { data: rows.filter(r => !r.in_cooldown || String(r.cooldown_until) < new Date().toISOString()) } : { data: { fallback_order: [], cooldown_duration_seconds: 300 } };
      const q: any = { then: (r: any) => Promise.resolve(result()).then(r) };
      for (const method of ["select", "eq", "lt", "in", "or", "order", "maybeSingle"]) q[method] = (...args: any[]) => { if (write && method === "lt") { updates(args); for (const row of rows) if (row.in_cooldown && String(row.cooldown_until) < args[1]) row.in_cooldown = false; } return q; };
      q.update = () => { write = true; return q; }; return q;
    } };
    core.getServiceClient.mockResolvedValue(db);
    expect((await pickBestModel("text", [], "hello")).model.id).toBe("cheap");
    expect((await pickBestModel("text", [], "analyze this")).model.id).toBe("expensive");
    expect((await pickBestModel("text", ["cheap"], "hello")).model.id).toBe("expensive");
    const cooled = rows.find(r => r.id === "cooled"); if (!cooled) throw new Error("fixture missing");
    cooled.cooldown_until = "2000-01-01";
    expect((await pickBestModel("text", [], "analyze")).model.id).toBe("cooled");
    expect(updates).toHaveBeenCalled();
  });
});

describe("R27 budget", () => {
  it("enforces below/equal/above caps, zero cap and unset state", () => {
    expect(isBudgetExceeded(9, 10)).toBe(false); expect(isBudgetExceeded(10, 10)).toBe(true);
    expect(isBudgetExceeded(11, 10)).toBe(true); expect(isBudgetExceeded(0, 0)).toBe(true);
    expect(isBudgetExceeded(1000, null)).toBe(false);
    expect(() => isBudgetExceeded(NaN, 10)).toThrow(); expect(() => configuredLimit("bad")).toThrow();
    expect(configuredLimit(undefined)).toBeNull(); expect(configuredLimit("2", true)).toBe(2);
  });
  it("queries only the current UTC day and stops before sending at the cap", async () => {
    expect(utcDayWindow(new Date("2026-11-05T00:00:00Z"))).toEqual({ start: "2026-11-05T00:00:00.000Z", end: "2026-11-06T00:00:00.000Z" });
    const db = database([4, 6]); await expect(checkDispatchBudget(db, 10, new Date("2026-11-05T23:59:59Z"))).rejects.toMatchObject({ status: 402 });
    expect(db.seen).toContainEqual(["usage_records.gte", ["created_at", "2026-11-05T00:00:00.000Z"]]);
    expect(db.seen).toContainEqual(["usage_records.lt", ["created_at", "2026-11-06T00:00:00.000Z"]]);
    const fetcher = vi.fn(async () => success());
    await expect(dispatch(fetcher as typeof fetch, { client: db, budgetCap: 10 })).rejects.toMatchObject({ reason: "budget" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ spendError: true }, { settingsError: true }, { paused: true }])("fails closed for unreadable spend/settings or paused state", async options => {
    const fetcher = vi.fn(async () => success());
    await expect(dispatch(fetcher as typeof fetch, { client: database([], options), budgetCap: 10 })).rejects.toBeInstanceOf(RoutingGuardError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("unset budget skips spend query but does not skip persisted pause", async () => {
    const db = database(); await checkDispatchBudget(db, null);
    expect(db.from).not.toHaveBeenCalledWith("usage_records");
    await expect(checkDispatchBudget(database([], { paused: true }), null)).rejects.toMatchObject({ reason: "paused" });
  });
});

describe("R29 key pool", () => {
  it("trims, discards blanks, deduplicates and preserves order", () => {
    expect(parseApiKeys(" a, ,b,a, b ")).toEqual(["a", "b"]); expect(parseApiKeys(" , ")).toEqual([]);
  });
  it("uses the second key after 429 and prevents header override", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ message: "private error" }, { status: 429 })).mockResolvedValueOnce(success());
    await callAIModel({ ...provider, custom_headers: { Authorization: "bad", "X-Trace": "trace" } }, model, "first-key, second-key", "hello", undefined, { fetcher, client: database(), budgetCap: null, rpmLimit: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(c => c[1].headers.Authorization)).toEqual(["Bearer first-key", "Bearer second-key"]);
    expect(fetcher.mock.calls[1]?.[1].headers["X-Trace"]).toBe("trace");
  });
  it.each([401, 403, 404, 503])("does not rotate keys on HTTP %s", async status => {
    const fetcher = vi.fn(async () => Response.json({ message: "first-key private details" }, { status }));
    await expect(dispatch(fetcher as typeof fetch)).rejects.toMatchObject({ status, message: `Model request failed (HTTP ${status})` });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("exhausts each quota key once before failing", async () => {
    const fetcher = vi.fn(async () => new Response("quota", { status: 402 }));
    await expect(dispatch(fetcher as typeof fetch)).rejects.toMatchObject({ status: 402 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refusal and permanent errors never rotate", async () => {
    const refusal = vi.fn(async () => Response.json({ choices: [{ message: { refusal: "cannot" } }] }));
    await expect(dispatch(refusal as typeof fetch)).rejects.toMatchObject({ terminal: true }); expect(refusal).toHaveBeenCalledTimes(1);
    const permanent = vi.fn(async () => Response.json({ props: { retryable: false } }, { status: 429 }));
    await expect(dispatch(permanent as typeof fetch)).rejects.toMatchObject({ terminal: true }); expect(permanent).toHaveBeenCalledTimes(1);
  });
});

describe("R30 masking and R31 squeezing", () => {
  it.each(["sk-proj-123456789abc", "AIza123456789abc", "sb_secret_123456789abc", "AKIA123456789ABCDE", "eyJhbGciOiJIUzI1NiJ9.abcdef.abcdefgh", "081-234-5678", "+66 81 234 5678", "+1 (415) 555-2671", "token=custom-value"])("masks recognizable sensitive data", text => expect(maskSensitiveData(text)).not.toContain(text));
  it("preserves ordinary numbers and masks configured arbitrary secrets", () => {
    expect(maskSensitiveData("price 123.45 and task 42")).toBe("price 123.45 and task 42");
    expect(maskSensitiveData("private-value", ["private-value"])).toBe("[REDACTED]");
  });
  it("masks outgoing prompts/system including contextual data without touching auth or originals", async () => {
    const payload = { text: "call 0812345678 first-key" }; const original = JSON.stringify(payload);
    const fetcher = vi.fn(async () => success());
    await callAIModel(provider, model, "first-key,second-key", `history: ${original}`, "memory: token=custom-value", { fetcher: fetcher as typeof fetch, client: database(), budgetCap: null, rpmLimit: null });
    const request = fetcher.mock.calls[0] as any; const body = JSON.parse(request[1].body);
    expect(body.messages[0].content).toContain("[REDACTED]");
    expect(body.messages[1].content).not.toMatch(/0812345678|first-key/);
    expect(request[1].headers.Authorization).toBe("Bearer first-key"); expect(JSON.stringify(payload)).toBe(original);
    expect(request[1].signal).toBeUndefined();
  });
  it("reduces redundant prose whitespace idempotently without truncation", () => {
    const text = "Hello   world\n\n\nNext    sentence";
    expect(squeezePrompt(text)).toBe("Hello world\n\nNext sentence");
    expect(squeezePrompt(squeezePrompt(text))).toBe(squeezePrompt(text));
  });
  it("preserves fenced/indented code and structured inputs exactly", () => {
    const code = "```python\n    x =  2\n\n\n    print(x)\n```";
    expect(squeezePrompt(code)).toBe(code);
    const json = '  {\n  "message": "two  spaces"\n}\n'; expect(squeezePrompt(json)).toBe(json);
    expect(squeezePrompt("Example:\n    x =  2\n    y =  3")).toContain("    x =  2\n    y =  3");
  });
});

describe("R32 rolling RPM", () => {
  it("enforces exact boundary, isolation, expiry, and synchronous admission", async () => {
    let clock = 0; const t = new ModelRpmThrottler(() => clock);
    const results = await Promise.all(Array.from({ length: 10 }, async () => t.tryAcquire("a", 2)));
    expect(results.filter(Boolean)).toHaveLength(2); expect(t.tryAcquire("b", 2)).toBe(true);
    clock = 59999; expect(t.tryAcquire("a", 2)).toBe(false);
    clock = 60000; expect(t.tryAcquire("a", 2)).toBe(true);
    for (let i = 0; i < 100; i++) expect(t.tryAcquire("unset", null)).toBe(true);
  });
  it("counts key retries and sends no request after exhaustion", async () => {
    const throttle = new ModelRpmThrottler(() => 0), fetcher = vi.fn(async () => new Response("rate", { status: 429 }));
    await expect(dispatch(fetcher as typeof fetch, { throttle, rpmLimit: 1 })).rejects.toMatchObject({ reason: "throttled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(dispatch(fetcher as typeof fetch, { throttle, rpmLimit: 1 })).rejects.toMatchObject({ reason: "throttled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("skips throttled models without cooldown", async () => {
    const deps = fallback(vi.fn().mockRejectedValueOnce(new RoutingGuardError(429, "throttled", "throttled")).mockResolvedValueOnce({ text: "ok" }));
    expect((await callWithFallback("hello", undefined, deps)).router.model.id).toBe("b");
    expect(deps.cooldown).not.toHaveBeenCalled();
  });
});

describe("shared pipeline/gateway integration", () => {
  it("does not cache a response under the wrong dynamically selected model", async () => {
    const putCache = vi.fn();
    const store: PipelineStore = { currentModelId: vi.fn(async () => "predicted"), getCache: async () => null, recordHit: async () => {}, putCache, getSnippet: async () => null, listMemories: async () => [], addMemory: async () => {}, getSummary: async () => null, saveSummary: async () => {} };
    await runChatPipeline({ message: "hello", history: [], conversationId: null }, [], store, { callModel: async () => ({ router: { provider, model }, result: { text: "ok", promptTokens: 1, completionTokens: 1, cost: 0, isEstimated: false }, tried: [] }), runTool: vi.fn(), recordUsage: async () => {}, log: async () => {} });
    expect(store.currentModelId).toHaveBeenCalledWith("ผู้ใช้: hello"); expect(putCache).not.toHaveBeenCalled();
  });
  it("returns real terminal HTTP status through the remote gateway", async () => {
    const response = await handleChatCompletions(new Request("https://hub.test/api/public/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }) }), { verifyToken: async () => true, callModel: async () => { throw new AIHttpError(403, "Model refused the request", 0, true); }, recordUsage: vi.fn() });
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { message: "Model refused the request" } });
  });
});