// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runChatPipeline, parseSnippet, parseMemoryCommand, isTimeSensitive, sha256, CACHE_TTL_MS, type PipelineStore } from "../server/hub/chat-pipeline";
import { handleChatCompletions } from "../server/hub/openai-gateway";
import type { ChatDeps, ModelCall } from "../server/hub/chat";

const reply = (text: string, cost = 0.01): ModelCall => ({ router: { provider: { id: "p" }, model: { model_id: "m1", display_name: "M1" } }, result: { text, promptTokens: 3, completionTokens: 5, cost, isEstimated: false }, tried: [] });

function memStore(): PipelineStore & { cache: Map<string, any>; memories: string[]; summaries: Map<string, any> } {
  const cache = new Map<string, any>(), memories: string[] = [], summaries = new Map<string, any>();
  const snippets: Record<string, any> = {
    line: { command: "line", template: "ส่งข้อความ LINE ตามนี้: {input}", system_instruction: "เรียกเครื่องมือ LINE" },
    sum: { command: "sum", template: "สรุปประเด็น:\n{input}", system_instruction: "สรุปเป็นข้อ ๆ" },
    fix: { command: "fix", template: "ตรวจแก้บั๊ก:\n{input}", system_instruction: "ผู้ตรวจโค้ด" },
  };
  return {
    cache, memories, summaries,
    currentModelId: async () => "m1",
    getCache: async (h, m) => { const e = cache.get(`${h}|${m}`); return e && e.expiresAt > Date.now() ? e : null; },
    recordHit: async (h, m, c) => { const e = cache.get(`${h}|${m}`); e.hit_count++; e.cost_saved += c; },
    putCache: async (h, m, entry, exp) => { cache.set(`${h}|${m}`, { ...entry, hit_count: 0, cost_saved: 0, expiresAt: exp.getTime() }); },
    getSnippet: async (c) => snippets[c] || null,
    listMemories: async () => memories,
    addMemory: async (c) => { memories.push(c); },
    getSummary: async (id) => summaries.get(id) || null,
    saveSummary: async (id, summary, turns) => { summaries.set(id, { summary, turns_covered: turns }); },
  };
}
const deps = (texts: ModelCall[]) => {
  const callModel = vi.fn(async (_p: string, _s?: string) => texts.shift() ?? reply("default"));
  return { callModel, runTool: vi.fn(async () => ({ success: true, status: 200, latency: 1, body: "ok" } as any)), recordUsage: vi.fn(async () => {}), log: vi.fn(async () => {}) } satisfies ChatDeps;
};
const conv = "11111111-1111-1111-1111-111111111111";

describe("R19 exact prompt cache", () => {
  it("second identical prompt is answered from cache without a model call and records hit + cost saved", async () => {
    const store = memStore(), d = deps([reply("คำตอบ", 0.02)]);
    const a = await runChatPipeline({ message: "อธิบาย PWA", history: [], conversationId: conv }, [], store, d);
    const t0 = performance.now();
    const b = await runChatPipeline({ message: "อธิบาย PWA", history: [], conversationId: conv }, [], store, d);
    expect(performance.now() - t0).toBeLessThan(30);
    expect(a.cached).toBe(false);
    expect(b).toMatchObject({ cached: true, reply: "คำตอบ" });
    expect(d.callModel).toHaveBeenCalledTimes(1);
    const entry = [...store.cache.values()][0];
    expect(entry.hit_count).toBe(1);
    expect(entry.cost_saved).toBeCloseTo(0.02);
  });
  it("cache entries expire after 24 hours", async () => {
    const store = memStore();
    await runChatPipeline({ message: "x", history: [], conversationId: null }, [], store, deps([reply("a")]));
    expect([...store.cache.values()][0].expiresAt - Date.now()).toBeLessThanOrEqual(CACHE_TTL_MS);
    expect(CACHE_TTL_MS).toBe(86_400_000);
  });
  it("time-sensitive prompts skip the cache", async () => {
    const store = memStore(), d = deps([reply("1"), reply("2")]);
    await runChatPipeline({ message: "ตอนนี้กี่โมง", history: [], conversationId: null }, [], store, d);
    await runChatPipeline({ message: "ตอนนี้กี่โมง", history: [], conversationId: null }, [], store, d);
    expect(d.callModel).toHaveBeenCalledTimes(2);
    expect(store.cache.size).toBe(0);
    expect(isTimeSensitive("what is the date today")).toBe(true);
  });
  it("tool-call replies are never cached", async () => {
    const store = memStore();
    const tool = { id: "t1", name: "LINE", base_url: "https://x.test", sample_request: { text: "hi" } };
    await runChatPipeline({ message: "ส่ง", history: [], conversationId: null }, [tool], store, deps([reply('{"tool":"t1","payload":{"text":"a"}}'), reply("ส่งแล้ว")]));
    expect(store.cache.size).toBe(0);
  });
  it("sha256 is hex SHA-256", async () => {
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("R20 snippets", () => {
  it.each(["line", "sum", "fix"])("/%s expands template and system instruction", async (cmd) => {
    const store = memStore(), d = deps([reply("ok")]);
    const r = await runChatPipeline({ message: `/${cmd} hello`, history: [], conversationId: null }, [], store, d);
    expect(r.snippet).toBe(cmd);
    const [prompt, system] = d.callModel.mock.calls[0];
    expect(prompt).toContain("hello");
    expect(prompt).not.toContain(`/${cmd}`);
    expect(system).toContain((await store.getSnippet(cmd))!.system_instruction);
  });
  it("unknown slash command is sent as typed", async () => {
    const d = deps([reply("ok")]);
    await runChatPipeline({ message: "/nope x", history: [], conversationId: null }, [], memStore(), d);
    expect(d.callModel.mock.calls[0][0]).toContain("/nope x");
    expect(parseSnippet("hello")).toBeNull();
  });
});

describe("R21 user memory", () => {
  it.each([["จำไว้ว่า ชื่อเล่นฉันคือบอม", "ชื่อเล่นฉันคือบอม"], ["remember: I trade XAUUSD", "I trade XAUUSD"]])("stores %s without a model call", async (msg, fact) => {
    const store = memStore(), d = deps([]);
    const r = await runChatPipeline({ message: msg, history: [], conversationId: null }, [], store, d);
    expect(store.memories).toEqual([fact]);
    expect(r.memorySaved).toBe(fact);
    expect(d.callModel).not.toHaveBeenCalled();
  });
  it("enabled memories are injected into the system prompt", async () => {
    const store = memStore(); store.memories.push("ชื่อเล่นฉันคือบอม");
    const d = deps([reply("ok")]);
    await runChatPipeline({ message: "ฉันชื่ออะไร", history: [], conversationId: null }, [], store, d);
    expect(d.callModel.mock.calls[0][1]).toContain("ชื่อเล่นฉันคือบอม");
    expect(parseMemoryCommand("ทั่วไป")).toBeNull();
  });
});

describe("R22 rolling context compactor", () => {
  const turns = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn-${i}` }));
  it("history over 10 turns is summarized; only the summary + last 4 turns go to the model", async () => {
    const store = memStore(), d = deps([reply("SUMMARY-A"), reply("answer")]);
    const r = await runChatPipeline({ message: "ต่อ", history: turns(12), conversationId: conv }, [], store, d);
    expect(r.compacted).toBe(true);
    expect(store.summaries.get(conv)).toEqual({ summary: "SUMMARY-A", turns_covered: 8 });
    const [prompt, system] = d.callModel.mock.calls[1];
    expect(system).toContain("SUMMARY-A");
    expect(prompt).not.toContain("turn-7");
    expect(prompt).toContain("turn-8");
    expect(prompt).toContain("turn-11");
  });
  it("10 turns or fewer are sent as-is with no summary call", async () => {
    const d = deps([reply("answer")]);
    const r = await runChatPipeline({ message: "ต่อ", history: turns(10), conversationId: conv }, [], memStore(), d);
    expect(r.compacted).toBe(false);
    expect(d.callModel).toHaveBeenCalledTimes(1);
  });
  it("existing summary is extended incrementally with only new older turns", async () => {
    const store = memStore(); store.summaries.set(conv, { summary: "OLD", turns_covered: 8 });
    const d = deps([reply("NEW"), reply("answer")]);
    await runChatPipeline({ message: "ต่อ", history: turns(14), conversationId: conv }, [], store, d);
    const compactPrompt = d.callModel.mock.calls[0][0];
    expect(compactPrompt).toContain("OLD");
    expect(compactPrompt).toContain("turn-8");
    expect(compactPrompt).not.toContain("turn-7");
    expect(store.summaries.get(conv)).toEqual({ summary: "NEW", turns_covered: 10 });
  });
});

describe("R23 OpenAI-compatible gateway", () => {
  const gw = (ok = true, fail = false) => ({
    verifyToken: vi.fn(async (t: string) => ok && t === "jod_valid"),
    callModel: vi.fn(async () => { if (fail) throw new Error("x"); return reply("สวัสดี"); }),
    recordUsage: vi.fn(async () => {}), now: () => 1_700_000_000_000, id: () => "abc",
  });
  const req = (body: any, auth = "Bearer jod_valid") => new Request("https://h/api/public/v1/chat/completions", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  const msgs = [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }];

  it("rejects missing or invalid tokens with 401 and never calls a model", async () => {
    const d = gw();
    expect((await handleChatCompletions(req({ messages: msgs }, ""), d)).status).toBe(401);
    expect((await handleChatCompletions(req({ messages: msgs }, "Bearer bad"), d)).status).toBe(401);
    expect(d.callModel).not.toHaveBeenCalled();
  });
  it("maps OpenAI messages to callWithFallback and returns chat.completion wire format", async () => {
    const d = gw();
    const res = await handleChatCompletions(req({ model: "gpt-4o", messages: msgs }), d);
    expect(res.status).toBe(200);
    expect(d.callModel).toHaveBeenCalledWith("user: hi", "be brief");
    expect(d.recordUsage).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ id: "chatcmpl-abc", object: "chat.completion", created: 1_700_000_000, model: "m1", choices: [{ index: 0, message: { role: "assistant", content: "สวัสดี" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } });
  });
  it("stream:true returns SSE chunks ending with [DONE]", async () => {
    const res = await handleChatCompletions(req({ messages: msgs, stream: true }), gw());
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const body = await res.text();
    expect(body).toContain('"object":"chat.completion.chunk"');
    expect(body.trim().endsWith("data: [DONE]")).toBe(true);
  });
  it("invalid body → 400, upstream failure → 502", async () => {
    expect((await handleChatCompletions(req({ messages: [] }), gw())).status).toBe(400);
    expect((await handleChatCompletions(req({ messages: msgs }), gw(true, true))).status).toBe(502);
  });
});
