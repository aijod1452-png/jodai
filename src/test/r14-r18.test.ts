// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac, createHash } from "node:crypto";
import { createR2Adapter, executeR2Operation, r2Path, r2Endpoint, R2_TEXT_LIMIT } from "../server/hub/r2-storage";
import { saveStorage, storageTarget, probeStorage, runStorageOperation, storageChatTools, STORAGE_PUBLIC_COLUMNS } from "../server/hub/storage-service";
import { createTableSnapshot, snapshotSafeRow } from "../server/hub/storage-connection";
import { runChat, type ModelCall } from "../server/hub/chat";

const config = { accountId: "a".repeat(32), bucketName: "backups", accessKeyId: "test_access", secretAccessKey: "test_secret" };
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllEnvs());
function database() {
  const records: Record<string, any[]> & { storage_connections: any[]; storage_secrets: any[]; activity_log: any[] } = { storage_connections: [], storage_secrets: [], activity_log: [] };
  const client = { from(table: string) {
    let action = "select", value: any, filter: any, single = false;
    const q: any = {
      select: () => q, eq: (key: string, val: any) => { filter = [key, val]; return q; },
      insert: (v: any) => { action = "insert"; value = v; return q; },
      upsert: (v: any) => { action = "upsert"; value = v; return q; },
      update: (v: any) => { action = "update"; value = v; return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (resolve: any) => {
        let data: any[] = (records[table] || []).filter(r => !filter || r[filter[0]] === filter[1]);
        if (action === "insert" || action === "upsert") { const row = { id, ...value }; const target = records[table]; if (!target) throw new Error("Unknown test table"); target.push(row); data = [row]; }
        if (action === "update") data.forEach(r => Object.assign(r, value));
        if (table === "storage_connections") data = data.map(r => ({ ...r, storage_secrets: records.storage_secrets.filter(s => s.storage_id === r.id) }));
        return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve);
      },
    }; return q;
  } };
  return { client, records };
}
async function connected() {
  vi.stubEnv("AIH_SECRET_ENCRYPTION_KEY", "test-encryption-source");
  const db = database();
  await saveStorage(db.client, { name: "Archive", storageType: "r2", accountId: config.accountId, bucketName: config.bucketName, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });
  return db;
}
function snapshotClient(rows: any[]) { return { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) }; }

describe("R14 encrypted provider lifecycle", () => {
  it("derives only a fixed R2 endpoint and rejects account injection", () => {
    expect(r2Endpoint(config.accountId)).toBe(`https://${config.accountId}.r2.cloudflarestorage.com`);
    for (const value of ["https://evil.test", "../evil", "", "a".repeat(31)]) expect(() => r2Endpoint(value)).toThrow();
  });
  it("stores both R2 credentials encrypted, returns only success/id and projects no credentials", async () => {
    const { client, records } = await connected();
    expect(records.storage_secrets[0].service_role_key).toBeNull();
    const secret = records.storage_secrets[0];
    expect(secret.encrypted_secret).not.toContain(config.accessKeyId);
    expect(secret.encrypted_secret).not.toContain(config.secretAccessKey);
    expect(secret.encryption_iv).toBeTruthy();
    expect(await storageTarget({ ...records.storage_connections[0], storage_secrets: secret })).toEqual({ type: "r2", ...config });
    expect(STORAGE_PUBLIC_COLUMNS).not.toMatch(/secret|access_key|encrypted/);
    await expect(saveStorage(client, { id, name: "Archive", storageType: "r2", accountId: "b".repeat(32), bucketName: "backups" })).rejects.toThrow("CREDENTIAL_REQUIRED");
  });
  it("keeps Supabase connections and legacy decrypt compatible", async () => {
    vi.stubEnv("AIH_SECRET_ENCRYPTION_KEY", "test-encryption-source"); const { client, records } = database();
    expect(await saveStorage(client, { name: "Old", projectUrl: "https://example.test/path", bucketName: "backup", serviceRoleKey: "sb_secret_fixture" })).toEqual({ success: true, id });
    expect(records.storage_connections[0].storage_type).toBe("supabase");
    expect(await storageTarget({ ...records.storage_connections[0], storage_secrets: records.storage_secrets[0] })).toEqual({ projectUrl: "https://example.test", bucketName: "backup", key: "sb_secret_fixture" });
    expect(await storageTarget({ project_url: "https://example.test", bucket_name: "backup", storage_secrets: { service_role_key: "sb_secret_legacy" } })).toMatchObject({ key: "sb_secret_legacy" });
  });
  it("rejects incomplete credentials before saving and corrupted ciphertext without plaintext downgrade", async () => {
    const { client, records } = await connected();
    await expect(saveStorage(client, { name: "Bad", storageType: "r2", accountId: config.accountId, bucketName: "backups", accessKeyId: config.accessKeyId })).rejects.toThrow();
    expect(records.storage_connections).toHaveLength(1);
    await expect(storageTarget({ ...records.storage_connections[0], storage_secrets: { encrypted_secret: "bad", encryption_iv: "bad", service_role_key: JSON.stringify(config) } })).rejects.toThrow("CREDENTIAL_DECRYPT_FAILED");
    const result = await saveStorage(client, { id, name: "Renamed", storageType: "r2", accountId: config.accountId, bucketName: "backups" });
    expect(result).toEqual({ success: true, id }); expect(records.storage_secrets).toHaveLength(1);
  });
});

describe("R15 authenticated read-only R2 probe", () => {
  it("sends one signed HEAD, verifies SigV4 independently and performs no writes", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const result = await createR2Adapter(config, fetcher).probe();
    expect(result).toMatchObject({ success: true, status: 200 }); expect(fetcher).toHaveBeenCalledTimes(1);
    const req = fetcher.mock.calls[0]?.[0]; if (!(req instanceof Request)) throw new Error("missing request");
    expect(req.method).toBe("HEAD"); expect(req.url).toBe(`${r2Endpoint(config.accountId)}/backups`);
    const authorization = req.headers.get("authorization") || "";
    const signedHeaders = authorization.match(/SignedHeaders=([^,]+)/)?.[1] || "";
    const date = req.headers.get("x-amz-date") || ""; const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
    const headers = signedHeaders.split(";").map(name => `${name}:${name === "host" ? new URL(req.url).host : req.headers.get(name)}\n`).join("");
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    const canonical = ["HEAD", "/backups", "", headers, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
    const hmac = (key: string | Buffer, text: string) => createHmac("sha256", key).update(text).digest();
    const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date.slice(0, 8)), "auto"), "s3"), "aws4_request");
    const signature = createHmac("sha256", key).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest("hex");
    expect(authorization.endsWith(`Signature=${signature}`)).toBe(true);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it.each([401, 403, 404, 500])("reports actual HTTP %i without upstream secret echoes", async status => {
    const result = await createR2Adapter(config, async () => new Response(config.secretAccessKey, { status })).probe();
    expect(result).toMatchObject({ success: false, status }); expect(JSON.stringify(result)).not.toContain(config.secretAccessKey);
  });
  it.each(["TimeoutError", "TypeError"])("handles %s with safe diagnostics", async name => {
    const result = await createR2Adapter(config, async () => { throw new DOMException(config.secretAccessKey, name); }).probe();
    expect(result.success).toBe(false); expect(result.message).toContain(name === "TimeoutError" ? "TIMEOUT" : "NETWORK");
    expect(result.message).not.toContain(config.secretAccessKey);
  });
  it("service probe decrypts and records outcome metadata without credentials or writes", async () => {
    const { client, records } = await connected(); const fetcher = vi.fn<typeof fetch>(async () => new Response(null));
    expect((await probeStorage(client, id, fetcher)).success).toBe(true);
    expect(records.storage_connections[0].last_test_result).toBe("SUCCESS");
    expect(records.activity_log[0].details).toMatchObject({ storageId: id, provider: "r2", success: true, status: 200 });
    expect(JSON.stringify(records.activity_log)).not.toContain(config.secretAccessKey);
    expect((fetcher.mock.calls[0]?.[0] as Request).method).toBe("HEAD");
  });
  it("existing Supabase probe still validates bucket through its Storage API", async () => {
    vi.stubEnv("AIH_SECRET_ENCRYPTION_KEY", "test-encryption-source"); const { client } = database();
    await saveStorage(client, { name: "Existing", projectUrl: "https://example.test", bucketName: "backups", serviceRoleKey: "sb_secret_fixture" });
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"id":"backups"}'));
    expect((await probeStorage(client, id, fetcher)).success).toBe(true);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://example.test/storage/v1/bucket/backups");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});

describe("R16 snapshots", () => {
  it("removes credentials/session fields recursively including settings hash/salt", () => {
    expect(snapshotSafeRow({ id: "SYSTEM_CONFIG", master_pause: false, passcode_hash: "secret", passcode_salt: "salt", nested: { session: "secret", api_key: "secret", value: 1 }, details: { content: "file text", body: "body" } })).toEqual({ id: "SYSTEM_CONFIG", master_pause: false, nested: { value: 1 }, details: {} });
  });
  it("uploads real sanitized table JSON via R2 and reports row/path/UTF8 byte counts", async () => {
    const rows = [{ id: "row", name: "ไทย", access_key: "hidden", nested: { token: "hidden" } }];
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null));
    const snap = await createTableSnapshot(snapshotClient(rows), "settings", { type: "r2", ...config }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = fetcher.mock.calls[1]?.[0]; if (!(request instanceof Request)) throw new Error("missing request");
    expect(request.method).toBe("PUT"); const text = await request.text();
    expect(JSON.parse(text).rows).toEqual([{ id: "row", name: "ไทย", nested: {} }]);
    expect(snap).toMatchObject({ rows: 1, bucket: "backups", bytes: new TextEncoder().encode(text).length });
    expect(request.url).toBe(`${r2Endpoint(config.accountId)}/backups/${snap.path}`);
  });
  it("rejects session tables before network access and fails snapshots on upload refusal", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null)).mockResolvedValueOnce(new Response("private", { status: 403 }));
    await expect(createTableSnapshot(snapshotClient([]), "sessions", { type: "r2", ...config }, fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    await expect(createTableSnapshot(snapshotClient([]), "tasks", { type: "r2", ...config }, fetcher)).rejects.toThrow("AUTH_DENIED");
  });
});

describe("R17 scoped AI list/read/write", () => {
  it.each(["../x", "/other/key", "https://evil.test/x", "x%2Fy", "x\\y", "x//y", "a/../b"])("rejects path %s", path => { expect(() => r2Path(path)).toThrow(); });
  it("lists only configured bucket, reads bounded text, writes signed validated JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<ListBucketResult><Name>backups</Name><Contents><Key>notes/a.txt</Key><Size>3</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>')).mockResolvedValueOnce(new Response("ไทย", { headers: { "content-type": "text/plain" } })).mockResolvedValueOnce(new Response(null));
    const adapter = createR2Adapter(config, fetcher);
    expect(await executeR2Operation(adapter, { operation: "list", prefix: "notes/" })).toMatchObject({ objects: [{ path: "notes/a.txt", bytes: 3 }] });
    expect(await executeR2Operation(adapter, { operation: "read", path: "notes/a.txt" })).toMatchObject({ content: "ไทย", bytes: 9 });
    expect(await executeR2Operation(adapter, { operation: "write", path: "notes/a.json", contentType: "application/json", content: '{"n":1}' })).toMatchObject({ bytes: 7, status: 200 });
    expect(fetcher.mock.calls.map(call => (call[0] as Request).method)).toEqual(["GET", "GET", "PUT"]);
    expect(fetcher.mock.calls.every(call => (call[0] as Request).url.startsWith(`${r2Endpoint(config.accountId)}/backups`))).toBe(true);
  });
  it.each([{ operation: "delete", path: "x" }, { operation: "list", url: "https://evil.test" }, { operation: "read", path: "https://evil.test/x" }, { operation: "write", path: "a", contentType: "text/html", content: "x" }, { operation: "write", path: "a", contentType: "application/json", content: "invalid" }, { operation: "write", path: "a", contentType: "text/plain", content: "x".repeat(R2_TEXT_LIMIT + 1) }])("rejects forbidden operation %# before sending", async input => {
    const fetcher = vi.fn<typeof fetch>(); await expect(executeR2Operation(createR2Adapter(config, fetcher), input)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects oversized streamed reads, binary types and cross-bucket list responses", async () => {
    for (const response of [new Response("x".repeat(R2_TEXT_LIMIT + 1), { headers: { "content-type": "text/plain" } }), new Response("binary", { headers: { "content-type": "image/png" } })]) await expect(createR2Adapter(config, async () => response).read("a")).rejects.toThrow();
    await expect(createR2Adapter(config, async () => new Response("<ListBucketResult><Name>other</Name></ListBucketResult>")).list()).rejects.toThrow("INVALID_RESPONSE");
  });
  it("refuses credential echoes in successful reads and malformed list metadata", async () => {
    await expect(createR2Adapter(config, async () => new Response(config.secretAccessKey, { headers: { "content-type": "text/plain" } })).read("a")).rejects.toThrow("SENSITIVE_RESPONSE");
    await expect(createR2Adapter(config, async () => new Response('<ListBucketResult><Name>backups</Name><Contents><Key>a</Key><Size>-1</Size></Contents></ListBucketResult>')).list()).rejects.toThrow("INVALID_RESPONSE");
    expect(() => r2Path("a//b/", true)).toThrow();
  });
  it.each(["list", "read", "write"])("AI %s invokes the real backend adapter without prompt credentials or content audit", async operation => {
    const { client, records } = await connected(); const storage = records.storage_connections[0];
    const tools = storageChatTools([{ ...storage, storage_secrets: records.storage_secrets[0] }]);
    const content = "private file contents";
    const payload = operation === "list" ? { operation, prefix: "" } : operation === "read" ? { operation, path: "a.txt" } : { operation, path: "a.txt", contentType: "text/plain", content };
    const texts = [JSON.stringify({ tool: `r2:${id}`, payload }), "ผลลัพธ์"];
    const prompts: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async () => operation === "list" ? new Response('<ListBucketResult><Name>backups</Name><IsTruncated>false</IsTruncated></ListBucketResult>') : operation === "read" ? new Response(content, { headers: { "content-type": "text/plain" } }) : new Response(null));
    const result = await runChat("ทำงาน", [], tools, {
      callModel: async (prompt, system): Promise<ModelCall> => { prompts.push(prompt + system); return { router: { provider: {}, model: { model_id: "m", display_name: "M" } }, tried: [], result: { text: texts.shift() || "", promptTokens: 1, completionTokens: 1, cost: 0, isEstimated: false } }; },
      runTool: async (tool, input) => { const result = await runStorageOperation(client, tool.storageId, input, fetcher); return { success: true, status: result.status, latency: result.latency, body: JSON.stringify(result) }; },
      recordUsage: async () => {}, log: async (_event, _description, details) => { records.activity_log.push({ details }); },
    });
    expect(result.toolExecution?.success).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(prompts.join()).not.toContain(config.secretAccessKey); expect(prompts.join()).not.toContain(config.accessKeyId);
    expect(JSON.stringify(records.activity_log)).not.toContain(content); expect(JSON.stringify(records.activity_log)).not.toContain(config.secretAccessKey);
  });
});

describe("R18 failed/rejected calls are audited safely", () => {
  it("does not report success if real call succeeded but audit persistence failed", async () => {
    const { client } = await connected(); const original = client.from;
    client.from = (table: string) => table === "activity_log" ? { insert: async () => ({ error: { message: "internal" } }) } as any : original(table);
    await expect(runStorageOperation(client, id, { operation: "write", path: "a.txt", contentType: "text/plain", content: "private" }, async () => new Response(null))).rejects.toThrow("AUDIT_FAILED");
  });
  it("records denied HTTP status and rejected deletes without upstream body or file contents", async () => {
    const { client, records } = await connected(); const fetcher = vi.fn<typeof fetch>(async () => new Response(config.secretAccessKey, { status: 403 }));
    await expect(runStorageOperation(client, id, { operation: "read", path: "a.txt" }, fetcher)).rejects.toThrow("AUTH_DENIED");
    await expect(runStorageOperation(client, id, { operation: "delete", path: "a.txt", content: "private" }, fetcher)).rejects.toThrow("INVALID_OPERATION");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(records.activity_log[0].details).toMatchObject({ status: 403, success: false, operation: "read" });
    expect(records.activity_log[1].details).toMatchObject({ success: false, operation: "rejected" });
    expect(JSON.stringify(records.activity_log)).not.toContain(config.secretAccessKey); expect(JSON.stringify(records.activity_log)).not.toContain("private");
  });
});