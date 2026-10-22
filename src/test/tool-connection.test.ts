// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildToolHeaders, normalizeHeaderName, normalizeToolUrl, parseSampleRequest, testToolConnection } from "../server/hub/tool-connection";

describe("Tool connection", () => {
  it("trims, collapses nested HTTPS schemes and keeps the path", () => {
    expect(normalizeToolUrl("  https://https://api.example.test/v1/run?x=1#f ")).toBe("https://api.example.test/v1/run?x=1");
  });
  it("rejects http, credentials and private or internal hosts", () => {
    for (const u of ["http://api.example.test", "https://u:p@api.example.test", "https://localhost/x", "https://127.0.0.1", "https://10.0.0.5", "https://192.168.1.1", "https://172.16.0.1", "https://169.254.169.254/latest", "https://svc.internal", "https://[::1]/"]) {
      expect(() => normalizeToolUrl(u)).toThrow();
    }
  });
  it("validates header names", () => {
    expect(normalizeHeaderName("")).toBe("Authorization");
    expect(normalizeHeaderName(" X-Api-Key ")).toBe("X-Api-Key");
    expect(() => normalizeHeaderName("Bad Header")).toThrow();
    expect(() => normalizeHeaderName("Host")).toThrow();
  });
  it("builds Bearer and raw headers", () => {
    expect(buildToolHeaders(" k1 ", "Bearer", null).get("Authorization")).toBe("Bearer k1");
    expect(buildToolHeaders("k2", "raw", "X-Api-Key").get("X-Api-Key")).toBe("k2");
    expect(() => buildToolHeaders("k", "Basic", null)).toThrow();
  });
  it("rejects invalid or oversized sample JSON", () => {
    expect(parseSampleRequest('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseSampleRequest("{bad")).toThrow();
    expect(() => parseSampleRequest({ x: "a".repeat(11000) })).toThrow();
  });
  it("only 2xx is success; 404 and 401 fail", async () => {
    const tool = { base_url: "https://api.example.test" };
    expect((await testToolConnection(tool, "", vi.fn<typeof fetch>().mockResolvedValue(new Response("ok")))).success).toBe(true);
    const r404 = await testToolConnection(tool, "", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })));
    expect(r404.success).toBe(false); expect(r404.status).toBe(404);
    expect((await testToolConnection(tool, "k", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })))).success).toBe(false);
  });
  it("reports timeout and network errors without upstream details", async () => {
    const tool = { base_url: "https://api.example.test" };
    const t = await testToolConnection(tool, "", vi.fn<typeof fetch>().mockRejectedValue(new DOMException("untrusted detail", "TimeoutError")));
    const n = await testToolConnection(tool, "", vi.fn<typeof fetch>().mockRejectedValue(new Error("untrusted detail")));
    expect([t.error, n.error]).toEqual(["TIMEOUT", "NETWORK"]);
    expect(JSON.stringify([t, n])).not.toContain("untrusted detail");
  });
});
