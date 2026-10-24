// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { executeToolCall, validateToolPayload } from "../server/hub/tool-connection";
import { AIHttpError, isFallbackError, computeCost } from "../server/hub/router-core";
import { createTableSnapshot, SNAPSHOT_BUCKET } from "../server/hub/storage-connection";
import manifest from "../../public/manifest.json";

const tool = { base_url: "https://api.example.test/run", auth_header_type: "Bearer", custom_header_name: null, sample_request: { q: "x" } };

describe("R1 tool execution", () => {
  it("POSTs the payload and reports the real HTTP status", async () => {
    const fetcher = vi.fn(async () => new Response("bad", { status: 418 }));
    const r = await executeToolCall(tool, "k", { q: "hi" }, fetcher as any);
    expect(r).toMatchObject({ success: false, status: 418, body: "bad" });
    const [, init] = fetcher.mock.calls[0] as any;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"q":"hi"}');
    expect(init.headers.get("Authorization")).toBe("Bearer k");
  });
  it("rejects payloads missing sample_request keys", () => {
    expect(() => validateToolPayload({}, { q: "x" })).toThrow(/q/);
    expect(() => validateToolPayload([], null)).toThrow();
  });
});

describe("R2 fallback errors", () => {
  it("only 402 and 429 trigger fallback", () => {
    expect(isFallbackError(new AIHttpError(402, ""))).toBe(true);
    expect(isFallbackError(new AIHttpError(429, ""))).toBe(true);
    expect(isFallbackError(new AIHttpError(500, ""))).toBe(false);
    expect(isFallbackError(new Error("x"))).toBe(false);
  });
});

describe("R3 snapshot", () => {
  it("refuses secret tables and uploads real rows", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const client: any = {
      storage: { getBucket: async () => ({ data: {}, error: null }), from: (b: string) => { expect(b).toBe(SNAPSHOT_BUCKET); return { upload }; } },
      from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }) }) }) }),
    };
    await expect(createTableSnapshot(client, "provider_secrets")).rejects.toThrow();
    const r = await createTableSnapshot(client, "tasks");
    expect(r.rows).toBe(2);
    expect(upload).toHaveBeenCalledOnce();
  });
  it("creates the bucket when missing", async () => {
    const createBucket = vi.fn(async () => ({ error: null }));
    const client: any = {
      storage: { getBucket: async () => ({ data: null, error: { message: "not found" } }), createBucket, from: () => ({ upload: async () => ({ error: null }) }) },
      from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }),
    };
    await createTableSnapshot(client, "tasks");
    expect(createBucket).toHaveBeenCalledWith(SNAPSHOT_BUCKET, { public: false });
  });
});

describe("R5 manifest", () => {
  it("is installable standalone", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
  });
});

describe("R6 pricing", () => {
  it("uses per-model provider rates", () => {
    expect(computeCost("gemini", "gemini-2.5-flash", 1_000_000, 0)).toBeCloseTo(0.3);
    expect(computeCost("openai", "gpt-4o-mini", 0, 1_000_000)).toBeCloseTo(0.6);
    expect(computeCost("anthropic", "claude-3-haiku", 1_000_000, 0)).toBeCloseTo(0.8);
  });
});
