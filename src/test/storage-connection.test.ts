// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "../server/hub/core";
import { normalizeProjectUrl, normalizeStorageKey, storageHeaders, testStorageConnection } from "../server/hub/storage-connection";

afterEach(() => vi.unstubAllEnvs());

describe("Storage compatibility", () => {
  it("trims whitespace and drops project URL paths, queries and fragments", () => {
    expect(normalizeProjectUrl("  https://example.test/rest/v1/?q=1#x  ")).toBe("https://example.test");
    expect(() => normalizeProjectUrl("http://example.test")).toThrow();
    expect(() => normalizeProjectUrl("https://user:pass@example.test")).toThrow();
  });
  it("trims surrounding API key whitespace", () => {
    expect(normalizeStorageKey(" \n sb_secret_testfixture \t ")).toBe("sb_secret_testfixture");
    expect(() => normalizeStorageKey(" \n ")).toThrow();
  });
  it("removes repeated leading HTTPS schemes before normalizing the origin", () => {
    expect(normalizeProjectUrl(" https://https://example.test/rest/v1/?q=1#x ")).toBe("https://example.test");
    expect(normalizeProjectUrl("HTTPS:// https://https://example.test/storage/v1")).toBe("https://example.test");
    expect(() => normalizeProjectUrl("https://http://example.test")).toThrow();
  });
  it("converts an official project Dashboard URL to the API origin", () => {
    expect(normalizeProjectUrl("https://supabase.com/dashboard/project/abcdefghijklmnopqrst/storage/buckets?q=1#x")).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(normalizeProjectUrl(" https://https://supabase.com/dashboard/project/abcdefghijklmnopqrst ")).toBe("https://abcdefghijklmnopqrst.supabase.co");
  });
  it("supports legacy project Dashboard URLs", () => {
    expect(normalizeProjectUrl("https://app.supabase.com/project/abcdefghijklmnopqrst/settings/api")).toBe("https://abcdefghijklmnopqrst.supabase.co");
  });
  it("rejects Dashboard URLs without a valid project hostname", () => {
    for (const url of [
      "https://supabase.com/dashboard/project/",
      "https://supabase.com/dashboard/org/example",
      "https://supabase.com/dashboard/project/-invalid",
      "https://supabase.com/dashboard/project/project.example",
      "https://supabase.com/dashboard/project/abc%2Fdef",
    ]) expect(() => normalizeProjectUrl(url)).toThrow();
  });
  it("rejects malformed or incomplete hostnames", () => {
    for (const url of ["https://", "https://https://", "https://localhost", "https://-bad.example", "https://bad-.example", "https://bad_name.example", "https://bad..example", `https://${"a".repeat(64)}.example`]) {
      expect(() => normalizeProjectUrl(url)).toThrow();
    }
    expect(normalizeProjectUrl("https://storage.custom-domain.test:8443/rest/v1/")).toBe("https://storage.custom-domain.test:8443");
    expect(normalizeProjectUrl("https://supabase.com.example.test/dashboard/project/abc")).toBe("https://supabase.com.example.test");
  });
  it("sends opaque secret keys only in apikey", () => {
    const headers = storageHeaders(" sb_secret_testfixture ");
    expect(headers.get("apikey")).toBe("sb_secret_testfixture");
    expect(headers.has("Authorization")).toBe(false);
  });
  it("sends legacy JWT in apikey and Bearer headers", () => {
    const fixture = "testheader.testpayload.testsignature";
    const headers = storageHeaders(` ${fixture} `);
    expect(headers.get("apikey")).toBe(fixture);
    expect(headers.get("Authorization")).toBe(`Bearer ${fixture}`);
    expect(() => storageHeaders("sb_publishable_testfixture")).toThrow();
  });
  it("decrypts historical service-key encryption when the preferred key is now configured", async () => {
    vi.stubEnv("AIH_SECRET_ENCRYPTION_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "historical-test-encryption-source");
    const stored = await encryptSecret("stored-test-fixture");
    vi.stubEnv("AIH_SECRET_ENCRYPTION_KEY", "preferred-test-encryption-source");
    expect(await decryptSecret(stored.encrypted_secret, stored.encryption_iv)).toBe("stored-test-fixture");
  });
  it("encrypts new records using the preferred source", async () => {
    vi.stubEnv("AIH_SECRET_ENCRYPTION_KEY", "preferred-test-encryption-source");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "historical-test-encryption-source");
    const stored = await encryptSecret("stored-test-fixture");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "changed-test-encryption-source");
    expect(await decryptSecret(stored.encrypted_secret, stored.encryption_iv)).toBe("stored-test-fixture");
  });
  it("keeps legacy plaintext compatibility but rejects corrupted encrypted records", async () => {
    vi.stubEnv("AIH_SECRET_ENCRYPTION_KEY", "test-source");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await decryptSecret(null, null, "legacy-fixture")).toBe("legacy-fixture");
    await expect(decryptSecret("corrupt", "corrupt", "legacy-fixture")).rejects.toThrow();
    await expect(decryptSecret("corrupt", null, "legacy-fixture")).rejects.toThrow();
  });
  it("falls back to an authenticated Storage endpoint and identifies partial success", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response("[]"));
    const result = await testStorageConnection(" https://example.test/rest/v1 ", " sb_secret_testfixture ", fetcher);
    expect(result.success).toBe(true);
    expect(result.attempts).toEqual([{ endpoint: "/rest/v1/", status: 404 }, { endpoint: "/storage/v1/bucket", status: 200 }]);
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://example.test/storage/v1/bucket");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("apikey")).toBe("sb_secret_testfixture");
  });
  it("does not report success when both authenticated endpoints reject the key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 401 }));
    const result = await testStorageConnection("https://example.test", "sb_secret_testfixture", fetcher);
    expect(result.success).toBe(false);
    expect(result.attempts.map(a => a.status)).toEqual([401, 401]);
  });
  it("records timeout and network failures without returning upstream error details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new DOMException("untrusted detail", "TimeoutError")).mockRejectedValueOnce(new Error("untrusted detail"));
    const result = await testStorageConnection("https://example.test", "sb_secret_testfixture", fetcher);
    expect(result.success).toBe(false);
    expect(result.attempts.map(a => a.error)).toEqual(["TIMEOUT", "NETWORK"]);
    expect(JSON.stringify(result)).not.toContain("untrusted detail");
  });
});