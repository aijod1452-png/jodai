// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildToolHeaders, normalizeToolUrl, buildStepToolPayload, executeToolCall } from "../server/hub/tool-connection";
import { normalizeBucketName, testStorageConnection, createTableSnapshot } from "../server/hub/storage-connection";

describe("R7 real tool request contract", () => {
  it("Bearer always uses Authorization while raw uses custom or Authorization", () => {
    const bearer = buildToolHeaders(" key ", "Bearer", "X-Key");
    expect(bearer.get("Authorization")).toBe("Bearer key");
    expect(bearer.has("X-Key")).toBe(false);
    expect(buildToolHeaders("key", "raw", "X-Key").get("X-Key")).toBe("key");
    expect(buildToolHeaders("key", "raw", null).get("Authorization")).toBe("key");
  });
  it("resolves /api against origin without allowing private cross-origin escapes", () => {
    expect(normalizeToolUrl("/api/run?q=1#f", "https://app.example.test/page")).toBe("https://app.example.test/api/run?q=1");
    expect(normalizeToolUrl("/api/run", "http://localhost:8080")).toBe("http://localhost:8080/api/run");
    for (const url of ["//127.0.0.1/api", "/\\127.0.0.1/api", "https://10.0.0.1/api"]) expect(() => normalizeToolUrl(url, "https://app.example.test")).toThrow();
    expect(() => normalizeToolUrl("/api/run")).toThrow();
  });
  it("sends actual earlier successful outputs and retains the real complete response", async () => {
    const previous = { summary: "ก่อนหน้า".repeat(300), data: { value: 17 } };
    const payload = buildStepToolPayload({ q: "request" }, [
      { step_number: 1, status: "SUCCEEDED", output_payload: previous },
      { step_number: 2, status: "FAILED", output_payload: { summary: "excluded" } },
      { step_number: 4, status: "SUCCEEDED", output_payload: { summary: "future" } },
    ], 3);
    const body = "real response".repeat(1000);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 201 }));
    const call = await executeToolCall({ base_url: "/api/run", sample_request: { q: "" } }, "key", payload, fetcher, "https://app.example.test");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ q: "request", previousOutput: previous, previousSteps: [{ stepNumber: 1, output: previous }] });
    expect(call).toMatchObject({ success: true, status: 201, body });
    expect(call.latency).toBeGreaterThanOrEqual(0);
  });
});

describe("R8 external bucket and snapshot", () => {
  it("requires a valid explicitly configured bucket", () => {
    expect(normalizeBucketName(" backups-01 ")).toBe("backups-01");
    for (const name of [null, "", "../other", "bucket/name", "bad name"]) expect(() => normalizeBucketName(name)).toThrow();
  });
  it("verifies the selected bucket, not a REST or bucket-list success", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "backups" })));
    expect((await testStorageConnection("https://storage.example.test", "sb_secret_fixture", fetcher, "backups")).success).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://storage.example.test/storage/v1/bucket/backups");
    fetcher.mockResolvedValue(new Response("[]"));
    expect((await testStorageConnection("https://storage.example.test", "sb_secret_fixture", fetcher, "backups")).success).toBe(false);
    fetcher.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await testStorageConnection("https://storage.example.test", "sb_secret_fixture", fetcher, "backups")).success).toBe(false);
  });
  it("uploads table JSON to the external bucket and counts UTF-8 bytes", async () => {
    const rows = [{ id: "row", goal: "ข้อมูลจริง" }];
    const client = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"id":"backups"}')).mockResolvedValueOnce(new Response('{"Key":"backups/tasks/file.json"}', { status: 200 }));
    const result = await createTableSnapshot(client, "tasks", { projectUrl: "https://storage.example.test/path", key: "sb_secret_fixture", bucketName: "backups" }, fetcher);
    const init = fetcher.mock.calls[1]?.[1];
    const blob = init?.body;
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new Error("upload body is not Blob");
    expect(JSON.parse(await blob.text()).rows).toEqual(rows);
    expect(result).toMatchObject({ bucket: "backups", rows: 1, bytes: blob.size });
    expect(blob.size).toBeGreaterThan((await blob.text()).length);
    expect(fetcher.mock.calls[1]?.[0]).toBe(`https://storage.example.test/storage/v1/object/backups/${result.path}`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("apikey")).toBe("sb_secret_fixture");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });
  it("refuses secret tables and failed uploads rather than reporting success", async () => {
    const client = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) };
    const target = { projectUrl: "https://storage.example.test", key: "sb_secret_fixture", bucketName: "backups" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"id":"backups"}')).mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(createTableSnapshot(client, "tool_secrets", target, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(createTableSnapshot(client, "tasks", target, fetcher)).rejects.toThrow("HTTP 403");
  });
});