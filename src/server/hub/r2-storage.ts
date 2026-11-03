import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

export const R2_TEXT_LIMIT = 1024 * 1024;
export const R2_SNAPSHOT_LIMIT = 50 * 1024 * 1024;
export const R2_TYPES = ["application/json", "text/plain", "text/csv"] as const;
export type R2Config = { accountId: string; bucketName: string; accessKeyId: string; secretAccessKey: string };
export class R2Error extends Error {
  constructor(public code: string, public status: number | null = null) { super(`R2 ${code}${status === null ? "" : ` · HTTP ${status}`}`); }
}
export function r2Endpoint(account: unknown): string {
  const id = z.string().trim().regex(/^[a-f0-9]{32}$/i).parse(account);
  return `https://${id.toLowerCase()}.r2.cloudflarestorage.com`;
}
export function r2Bucket(value: unknown): string {
  return z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).parse(value);
}
export function r2Credentials(accessKeyId: unknown, secretAccessKey: unknown) {
  const credential = z.string().trim().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/);
  return { accessKeyId: credential.parse(accessKeyId), secretAccessKey: credential.parse(secretAccessKey) };
}
export function r2Path(value: unknown, prefix = false): string {
  if (prefix && value === "") return "";
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).length > 1024 || /[:\\%?#\u0000-\u001f\u007f]/.test(value) || value.startsWith("/") || value.split("/").some((p, index, segments) => p === "." || p === ".." || !p && !(prefix && index === segments.length - 1))) throw new R2Error("INVALID_PATH");
  return value;
}
export async function boundedText(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new R2Error("SIZE_LIMIT", response.status); }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > limit) { await reader.cancel(); throw new R2Error("SIZE_LIMIT", response.status); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(total); let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.length; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(all); } catch { throw new R2Error("INVALID_TEXT"); }
}
export function createR2Adapter(config: R2Config, fetcher: typeof fetch = fetch) {
  const origin = r2Endpoint(config.accountId); const bucket = r2Bucket(config.bucketName);
  const credentials = r2Credentials(config.accessKeyId, config.secretAccessKey);
  const signer = new AwsClient({ ...credentials, service: "s3", region: "auto", retries: 0 });
  async function request(method: "HEAD" | "GET" | "PUT", path = "", query?: URLSearchParams, blob?: Blob) {
    const url = `${origin}/${bucket}${path ? `/${r2Path(path).split("/").map(encodeURIComponent).join("/")}` : ""}${query ? `?${query}` : ""}`;
    try {
      const signed = await signer.sign(url, { method, ...(blob ? { body: await blob.arrayBuffer(), headers: { "Content-Type": blob.type } } : {}) });
      const response = await fetcher(signed, { redirect: "error", signal: AbortSignal.timeout(20000), cache: "no-store" });
      if (!response.ok) { await response.body?.cancel(); throw new R2Error(response.status === 401 || response.status === 403 ? "AUTH_DENIED" : response.status === 404 ? "NOT_FOUND" : "HTTP_ERROR", response.status); }
      return response;
    } catch (e) { if (e instanceof R2Error) throw e; throw new R2Error(e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name) ? "TIMEOUT" : "NETWORK"); }
  }
  return {
    bucket,
    async probe() { const start = Date.now(); try { const response = await request("HEAD"); await response.body?.cancel(); return { success: true, status: response.status, latency: Date.now() - start, message: "ตรวจ bucket R2 สำเร็จ (อ่านอย่างเดียว)" }; } catch (e) { const err = e instanceof R2Error ? e : new R2Error("CONFIGURATION"); return { success: false, status: err.status, latency: Date.now() - start, message: err.message }; } },
    async write(path: string, blob: Blob, limit = R2_TEXT_LIMIT) {
      r2Path(path);
      if (blob.size > limit) throw new R2Error("SIZE_LIMIT");
      if (!(R2_TYPES as readonly string[]).includes(blob.type)) throw new R2Error("CONTENT_TYPE");
      const response = await request("PUT", path, undefined, blob); await response.body?.cancel();
      return { status: response.status, path, bytes: blob.size, contentType: blob.type };
    },
    async read(path: string) {
      const response = await request("GET", r2Path(path));
      const contentType = (response.headers.get("content-type") || "").split(";")[0]?.trim() || "";
      if (!(R2_TYPES as readonly string[]).includes(contentType)) { await response.body?.cancel(); throw new R2Error("CONTENT_TYPE", response.status); }
      const content = await boundedText(response, R2_TEXT_LIMIT);
      if (content.includes(credentials.accessKeyId) || content.includes(credentials.secretAccessKey)) throw new R2Error("SENSITIVE_RESPONSE");
      return { status: response.status, path, bytes: new TextEncoder().encode(content).length, contentType, content };
    },
    async list(prefix = "", cursor?: string) {
      r2Path(prefix, true);
      if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 2048)) throw new R2Error("INVALID_CURSOR");
      const query = new URLSearchParams({ "list-type": "2", "max-keys": "100", prefix }); if (cursor) query.set("continuation-token", cursor);
      const response = await request("GET", "", query); const xml = await boundedText(response, R2_TEXT_LIMIT);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new R2Error("INVALID_RESPONSE");
      let root: any; try { root = new XMLParser({ processEntities: false, parseTagValue: false }).parse(xml).ListBucketResult; } catch { throw new R2Error("INVALID_RESPONSE"); }
      if (!root || root.Name !== bucket) throw new R2Error("INVALID_RESPONSE");
      const entries = root.Contents ? Array.isArray(root.Contents) ? root.Contents : [root.Contents] : [];
      const objects = entries.slice(0, 100).map((entry: any) => { const path = r2Path(entry.Key); if (!path.startsWith(prefix) || path.includes(credentials.accessKeyId) || path.includes(credentials.secretAccessKey)) throw new R2Error("INVALID_RESPONSE"); const bytes = Number(entry.Size); if (!Number.isSafeInteger(bytes) || bytes < 0) throw new R2Error("INVALID_RESPONSE"); return { path, bytes }; });
      if (root.NextContinuationToken && (typeof root.NextContinuationToken !== "string" || root.NextContinuationToken.length > 2048 || root.NextContinuationToken.includes(credentials.accessKeyId) || root.NextContinuationToken.includes(credentials.secretAccessKey))) throw new R2Error("INVALID_RESPONSE");
      return { status: response.status, objects, cursor: root.NextContinuationToken || null, truncated: root.IsTruncated === "true" };
    },
  };
}

export async function executeR2Operation(adapter: ReturnType<typeof createR2Adapter>, input: unknown) {
  const schema = z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("list"), prefix: z.string().default(""), cursor: z.string().optional() }).strict(),
    z.object({ operation: z.literal("read"), path: z.string() }).strict(),
    z.object({ operation: z.literal("write"), path: z.string(), contentType: z.enum(R2_TYPES), content: z.string() }).strict(),
  ]);
  const parsed = schema.safeParse(input); if (!parsed.success) throw new R2Error("INVALID_OPERATION");
  const op = parsed.data;
  if (op.operation === "list") return adapter.list(op.prefix, op.cursor);
  if (op.operation === "read") return adapter.read(op.path);
  if (op.contentType === "application/json") { try { JSON.parse(op.content); } catch { throw new R2Error("INVALID_JSON"); } }
  return adapter.write(op.path, new Blob([op.content], { type: op.contentType }));
}