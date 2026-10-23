import { z } from "zod";

export function normalizeProjectUrl(value: unknown): string {
  const input = z.string().trim().min(1).max(2048).parse(value)
    .replace(/^(?:https:\/\/\s*)+/i, "https://");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Project URL ไม่ถูกต้อง กรุณาตรวจสอบ URL และชื่อโฮสต์");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Project URL ต้องเป็น HTTPS และไม่มีชื่อผู้ใช้หรือรหัสผ่านใน URL");
  }
  const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  const labels = url.hostname.split(".");
  if (url.hostname.length > 253 || labels.length < 2 || labels.some(label => !validLabel.test(label))) {
    throw new Error("Project URL มีชื่อโฮสต์ไม่ถูกต้อง");
  }
  if (["supabase.com", "www.supabase.com", "app.supabase.com"].includes(url.hostname)) {
    const project = url.pathname.match(/^\/(?:dashboard\/)?project\/([^/]+)(?:\/|$)/)?.[1];
    if (!project || !validLabel.test(project) || url.port) {
      throw new Error("กรุณาใช้ Dashboard URL ของโปรเจกต์ หรือ Project API URL");
    }
    return `https://${project.toLowerCase()}.supabase.co`;
  }
  return url.origin;
}

export function normalizeStorageKey(value: unknown): string {
  return z.string().trim().min(1).max(24576).parse(value);
}

export function storageHeaders(value: string): Headers {
  const key = normalizeStorageKey(value);
  const headers = new Headers({ apikey: key });
  if (key.startsWith("sb_secret_")) return headers;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("ใช้ Secret API Key หรือ legacy Service Role JWT เท่านั้น");
  }
  headers.set("Authorization", `Bearer ${key}`);
  return headers;
}

export type StorageTestResult = {
  success: boolean;
  latency: number;
  message: string;
  attempts: { endpoint: string; status: number | null; error?: "TIMEOUT" | "NETWORK" }[];
};

export async function testStorageConnection(projectUrl: unknown, key: string, fetcher: typeof fetch = fetch): Promise<StorageTestResult> {
  const origin = normalizeProjectUrl(projectUrl);
  const headers = storageHeaders(key);
  const start = Date.now();
  const attempts: StorageTestResult["attempts"] = [];
  // Both probes require the supplied credential. A public health endpoint cannot
  // establish key validity, and no arbitrary table or write is needed.
  for (const endpoint of ["/rest/v1/", "/storage/v1/bucket"]) {
    try {
      const response = await fetcher(`${origin}${endpoint}`, {
        method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(6000),
      });
      attempts.push({ endpoint, status: response.status });
      await response.body?.cancel();
      if (response.ok) return {
        success: true, latency: Date.now() - start, attempts,
        message: endpoint === "/rest/v1/" ? "เชื่อมต่อสำเร็จ · REST API" : "เชื่อมต่อสำเร็จ · Storage API (ปลายทางสำรอง); REST API ยังไม่ผ่านการทดสอบ",
      };
    } catch (error) {
      const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      attempts.push({ endpoint, status: null, error: timedOut ? "TIMEOUT" : "NETWORK" });
    }
  }
  const summary = attempts.map(a => `${a.endpoint}: ${a.status === null ? a.error === "TIMEOUT" ? "หมดเวลา 6 วินาที" : "เข้าถึงไม่ได้" : `HTTP ${a.status}`}`).join("; ");
  const reason = attempts.some(a => a.status === 401 || a.status === 403)
    ? "คีย์ไม่ถูกต้อง ไม่มีสิทธิ์ หรือไม่ตรงกับโปรเจกต์"
    : attempts.some(a => a.status === 404)
      ? "ไม่พบปลายทาง ตรวจสอบ Project URL และการเปิดบริการ"
      : "ปลายทางไม่พร้อมใช้งาน ตรวจสอบเครือข่ายและสถานะบริการ";
  return { success: false, latency: Date.now() - start, attempts, message: `${reason} · ${summary}` };
}
export const SNAPSHOT_BUCKET = "hub-snapshots";
/** Hub tables that may be snapshotted; secret, session and token tables are never exported. */
export const SNAPSHOT_TABLES = ["settings", "providers", "models", "router_state", "tools", "storage_connections", "tasks", "task_steps", "schedules", "schedule_runs", "usage_records", "activity_log", "notifications", "health_checks"] as const;

export async function ensureBucket(client: any, bucket = SNAPSHOT_BUCKET): Promise<void> {
  const { data, error } = await client.storage.getBucket(bucket);
  if (data && !error) return;
  const { error: createError } = await client.storage.createBucket(bucket, { public: false });
  if (createError && !/already exists/i.test(createError.message)) throw new Error(`สร้าง bucket ไม่สำเร็จ: ${createError.message}`);
}

export async function createTableSnapshot(client: any, tableName: unknown): Promise<{ path: string; rows: number; bytes: number }> {
  const table = String(tableName || "");
  if (!(SNAPSHOT_TABLES as readonly string[]).includes(table)) throw new Error("ไม่อนุญาตให้สำรองตารางนี้");
  await ensureBucket(client);
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`อ่านตาราง ${table} ไม่สำเร็จ: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const content = JSON.stringify({ table, createdAt: new Date().toISOString(), rows });
  const path = `${table}/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const { error } = await client.storage.from(SNAPSHOT_BUCKET).upload(path, new Blob([content], { type: "application/json" }), { contentType: "application/json", upsert: false });
  if (error) throw new Error(`อัปโหลด snapshot ไม่สำเร็จ: ${error.message}`);
  return { path, rows: rows.length, bytes: content.length };
}
