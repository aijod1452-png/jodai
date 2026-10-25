// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { executeToolCall, validateToolPayload } from "../server/hub/tool-connection";
import { LINE_ACCOUNT, LINE_RUN_PRESETS, LINE_TOOL_TEMPLATE, buildPresetPayload } from "../hub/line-presets";

describe("R11 LINE Bridge presets and template", () => {
  it("presets target Bomb or XAUUSD on account ObOG", () => {
    expect(LINE_RUN_PRESETS.map((p) => p.destination)).toEqual(["Bomb", "XAUUSD"]);
    for (const p of LINE_RUN_PRESETS) expect(buildPresetPayload(p).lineAccount).toBe(LINE_ACCOUNT);
  });
  it("builds the real LINE Bridge shape with a fresh unique requestId per selection", () => {
    const a = buildPresetPayload(LINE_RUN_PRESETS[0]!);
    const b = buildPresetPayload(LINE_RUN_PRESETS[0]!);
    expect(a).toMatchObject({ lineAccount: "ObOG", destination: "Bomb", message: { type: "text" } });
    expect(typeof a.message.text).toBe("string");
    expect(a.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.requestId).not.toBe(b.requestId);
  });
  it("template sample_request keys match the preset payload keys so runs validate", () => {
    const sampleKeys = Object.keys(LINE_TOOL_TEMPLATE.sampleRequest).sort();
    for (const p of LINE_RUN_PRESETS) expect(Object.keys(buildPresetPayload(p)).sort()).toEqual(sampleKeys);
    expect(LINE_TOOL_TEMPLATE.description).toContain(LINE_ACCOUNT);
  });
});

describe("R11 run-tool real execution contract", () => {
  const tool = { base_url: "https://hooks.example.test/line", sample_request: LINE_TOOL_TEMPLATE.sampleRequest };
  it("rejects a payload missing sample_request keys before any request", () => {
    expect(() => validateToolPayload({ lineAccount: LINE_ACCOUNT }, tool.sample_request)).toThrow("payload ขาดฟิลด์ที่จำเป็น");
    expect(validateToolPayload(buildPresetPayload(LINE_RUN_PRESETS[0]!), tool.sample_request)).toMatchObject({ destination: "Bomb" });
  });
  it("sends the preset payload for real and returns real status, latency and body", async () => {
    const payload = buildPresetPayload(LINE_RUN_PRESETS[0]!);
    const body = JSON.stringify({ ok: true, delivered: "Bomb" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const call = await executeToolCall(tool, "line-key", payload, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(payload);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer line-key");
    expect(call).toMatchObject({ success: true, status: 200, body });
    expect(call.latency).toBeGreaterThanOrEqual(0);
  });
  it("reports a real non-2xx failure instead of faking success", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const call = await executeToolCall(tool, "", buildPresetPayload(LINE_RUN_PRESETS[1]!), fetcher);
    expect(call).toMatchObject({ success: false, status: 502, body: "bad gateway" });
  });
});
