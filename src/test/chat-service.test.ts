// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runChat, parseToolDecision, buildSystemPrompt, type ChatDeps, type ModelCall } from "../server/hub/chat";

const tool = { id: "t1", name: "LINE", description: "ส่ง LINE", base_url: "https://x.test/line", sample_request: { destination: "Bomb", text: "hi" } };
const reply = (text: string, tried: string[] = []): ModelCall => ({ router: { provider: { id: "p" }, model: { model_id: "m", display_name: "M" } }, result: { text, promptTokens: 1, completionTokens: 2, cost: 0, isEstimated: false }, tried });
const deps = (texts: ModelCall[], runTool = vi.fn(async () => ({ success: true, status: 200, latency: 12, body: "ok" } as any))): ChatDeps & { runTool: any; recordUsage: any; log: any } => {
  const callModel = vi.fn(async () => texts.shift()!);
  return { callModel, runTool, recordUsage: vi.fn(async () => {}), log: vi.fn(async () => {}) };
};

describe("R13 chat-service direct engine", () => {
  it("plain reply makes one model call, records usage and logs, no tool run", async () => {
    const d = deps([reply("สวัสดี")]);
    const r = await runChat("hi", [], [tool], d);
    expect(r.reply).toBe("สวัสดี");
    expect(r.toolExecution).toBeNull();
    expect(d.runTool).not.toHaveBeenCalled();
    expect(d.recordUsage).toHaveBeenCalledTimes(1);
    expect(d.log).toHaveBeenCalledWith("CHAT_REPLY", expect.any(String), expect.anything(), "m");
  });
  it("tool decision executes the tool in memory then summarizes with a second call", async () => {
    const d = deps([reply('{"tool":"t1","payload":{"destination":"Bomb","text":"ทดสอบ"}}', ["x"]), reply("ส่งแล้ว")]);
    const r = await runChat("ส่ง", [], [tool], d);
    expect(d.runTool).toHaveBeenCalledWith(tool, { destination: "Bomb", text: "ทดสอบ" });
    expect(r.toolExecution).toMatchObject({ toolName: "LINE", success: true, httpStatus: 200, latencyMs: 12 });
    expect(r.reply).toBe("ส่งแล้ว");
    expect(r.fallbackFrom).toEqual(["x"]);
    expect(d.recordUsage).toHaveBeenCalledTimes(2);
    expect(d.log).toHaveBeenCalledWith("CHAT_TOOL_CALL", expect.stringContaining("HTTP 200"), expect.anything(), "m");
  });
  it("payload missing sample keys is not sent and reports a failed execution", async () => {
    const d = deps([reply('{"tool":"t1","payload":{"destination":"Bomb"}}'), reply("ไม่สำเร็จ")]);
    const r = await runChat("ส่ง", [], [tool], d);
    expect(d.runTool).not.toHaveBeenCalled();
    expect(r.toolExecution?.success).toBe(false);
  });
  it("unknown tool id is treated as a plain reply", async () => {
    const d = deps([reply('{"tool":"nope","payload":{}}')]);
    expect((await runChat("x", [], [tool], d)).toolExecution).toBeNull();
  });
  it("parses decisions and lists enabled tools in the system prompt", () => {
    expect(parseToolDecision('ok {"tool":"a","payload":{"b":1}}')).toEqual({ tool: "a", payload: { b: 1 } });
    expect(parseToolDecision("ข้อความ")).toBeNull();
    expect(buildSystemPrompt([tool])).toContain("id: t1");
  });
});
