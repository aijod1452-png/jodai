// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { executeToolCall, validateToolPayload } from "../server/hub/tool-connection";
import { LINE_ACCOUNT, LINE_RUN_PRESETS, LINE_TOOL_TEMPLATE } from "../hub/line-presets";

describe("R11 LINE presets and template", () => {
  it("presets use account ObOG and target Bomb or XAUUSD with a message", () => {
    expect(LINE_RUN_PRESETS.map((p) => p.payload.to)).toEqual(["Bomb", "XAUUSD"]);
    for (const p of LINE_RUN_PRESETS) {
      expect(p.payload.account).toBe(LINE_ACCOUNT);
      expect(p.payload.message.trim().length).toBeGreaterThan(0);
    }
  });
  it("template sample_request keys match the preset payloads so runs validate", () => {
    const sampleKeys = Object.keys(LINE_TOOL_TEMPLATE.sampleRequest).sort();
    for (const p of LINE_RUN_PRESETS) expect(Object.keys(p.payload).sort()).toEqual(sampleKeys);
    expect(LINE_TOOL_TEMPLATE.description).toContain(LINE_ACCOUNT);
  });
});

describe("R11 run-tool real execution contract", () => {
  const tool = { base_url: "https://hooks.example.test/line", sample_request: LINE_TOOL_TEMPLATE.sampleRequest };
  it("rejects a payload missing sample_request keys before any request", () => {
    expect(() => validateToolPayload({ account: LINE_ACCOUNT }, tool.sample_request)).toThrow("payload ขาดฟิลด์ที่จำเป็น");
    expect(() => validateToolPayload(LINE_RUN_PRESETS[0]!.payload, tool.sample_request)).toEqual(LINE_RUN_PRESETS[0]!.payload);
  });
  it("sends the preset payload for real and returns real status, latency and body", async () => {
    const body = JSON.stringify({ ok: true, delivered: "Bomb" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const call = await executeToolCall(tool, "line-key", LINE_RUN_PRESETS[0]!.payload, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(LINE_RUN_PRESETS[0]!.payload);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer line-key");
    expect(call).toMatchObject({ success: true, status: 200, body });
    expect(call.latency).toBeGreaterThanOrEqual(0);
  });
  it("reports a real non-2xx failure instead of faking success", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const call = await executeToolCall(tool, "", LINE_RUN_PRESETS[1]!.payload, fetcher);
    expect(call).toMatchObject({ success: false, status: 502, body: "bad gateway" });
  });
});
