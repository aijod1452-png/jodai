import { z } from "zod";

export function normalizeProjectUrl(value: unknown): string {
  const input = z.string().trim().min(1).max(2048).parse(value);
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Project URL ต้องเป็น HTTPS และไม่มีชื่อผู้ใช้หรือรหัสผ่านใน URL");
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