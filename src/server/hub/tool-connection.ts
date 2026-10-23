// Server-only: tool endpoint normalization, header building and safe probes.
import { z } from "zod";

const validLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "metadata.google.internal"].includes(h)) return true;
  if (/\.(localhost|local|internal|lan|home|corp)$/.test(h)) return true;
  if (h.includes(":")) return true; // IPv6 literals are not allowed for tools
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return false;
}

export function normalizeToolUrl(value: unknown): string {
  const input = z.string().trim().min(1).max(2048).parse(value).replace(/^(?:https:\/\/\s*)+/i, "https://");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("URL ของเครื่องมือไม่ถูกต้อง"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("URL ต้องเป็น HTTPS และไม่มีชื่อผู้ใช้หรือรหัสผ่านใน URL");
  if (isPrivateHost(url.hostname)) throw new Error("ไม่อนุญาตที่อยู่ภายในหรือเครือข่ายส่วนตัว");
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
  const labels = url.hostname.split(".");
  if (!isIp && (url.hostname.length > 253 || labels.length < 2 || labels.some((l) => !validLabel.test(l)))) throw new Error("ชื่อโฮสต์ของเครื่องมือไม่ถูกต้อง");
  url.hash = "";
  return url.toString();
}

export function normalizeHeaderName(value: unknown): string {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return "Authorization";
  const name = z.string().trim().max(64).parse(value);
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error("ชื่อ header ไม่ถูกต้อง");
  if (["host", "content-length", "cookie", "connection"].includes(name.toLowerCase())) throw new Error("ไม่อนุญาตชื่อ header นี้");
  return name;
}

export function normalizeAuthType(value: unknown): "Bearer" | "raw" {
  if (value === undefined || value === null || value === "" || value === "Bearer") return "Bearer";
  if (value === "raw") return "raw";
  throw new Error("ประเภท header ต้องเป็น Bearer หรือ raw");
}

export function buildToolHeaders(apiKey: string, authType: unknown, headerName: unknown): Headers {
  const headers = new Headers();
  const key = apiKey.trim();
  if (key) {
    if (/[\r\n]/.test(key)) throw new Error("API key มีอักขระไม่ถูกต้อง");
    headers.set(normalizeHeaderName(headerName), normalizeAuthType(authType) === "Bearer" ? `Bearer ${key}` : key);
  }
  return headers;
}

export function parseSampleRequest(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error("ตัวอย่างคำขอต้องเป็น JSON ที่ถูกต้อง"); }
  }
  if (JSON.stringify(parsed).length > 10240) throw new Error("ตัวอย่างคำขอยาวเกิน 10KB");
  return parsed;
}

export type ToolTestResult = { success: boolean; latency: number; status: number | null; error?: "TIMEOUT" | "NETWORK"; message: string };

export async function testToolConnection(
  tool: { base_url: string; auth_header_type?: string | null; custom_header_name?: string | null; sample_request?: unknown },
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ToolTestResult> {
  const url = normalizeToolUrl(tool.base_url);
  const headers = buildToolHeaders(apiKey, tool.auth_header_type, tool.custom_header_name);
  const sample = parseSampleRequest(tool.sample_request);
  if (sample !== null) headers.set("Content-Type", "application/json");
  const start = Date.now();
  try {
    const res = await fetcher(url, { method: sample !== null ? "POST" : "GET", headers, redirect: "manual", signal: AbortSignal.timeout(6000), ...(sample !== null ? { body: JSON.stringify(sample) } : {}) });
    await res.body?.cancel();
    const latency = Date.now() - start;
    const s = res.status;
    if (s >= 200 && s < 300) return { success: true, latency, status: s, message: `เชื่อมต่อสำเร็จ · HTTP ${s}` };
    const reason = s === 401 || s === 403 ? "คีย์ไม่ถูกต้องหรือไม่มีสิทธิ์" : s === 404 ? "ไม่พบปลายทาง ตรวจสอบ URL" : s >= 300 && s < 400 ? "ปลายทางเปลี่ยนเส้นทาง ใช้ URL ปลายทางจริง" : s >= 500 ? "ปลายทางขัดข้อง" : "คำขอถูกปฏิเสธ";
    return { success: false, latency, status: s, message: `${reason} · HTTP ${s}` };
  } catch (error) {
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return { success: false, latency: Date.now() - start, status: null, error: timedOut ? "TIMEOUT" : "NETWORK", message: timedOut ? "หมดเวลา 6 วินาที" : "เข้าถึงปลายทางไม่ได้" };
  }
}

/** Required top-level keys come from the tool's sample_request object (its payload schema). */
export function validateToolPayload(payload: unknown, sampleRequest: unknown): Record<string, unknown> {
  const p = payload === undefined || payload === null ? {} : payload;
  if (typeof p !== "object" || Array.isArray(p)) throw new Error("payload ของเครื่องมือต้องเป็น JSON object");
  if (JSON.stringify(p).length > 102400) throw new Error("payload ของเครื่องมือยาวเกิน 100KB");
  const sample = parseSampleRequest(sampleRequest);
  if (sample && typeof sample === "object" && !Array.isArray(sample)) {
    const missing = Object.keys(sample as object).filter((k) => !(k in (p as object)));
    if (missing.length) throw new Error(`payload ขาดฟิลด์ที่จำเป็น: ${missing.join(", ")}`);
  }
  return p as Record<string, unknown>;
}

export type ToolCallResult = { success: boolean; status: number | null; latency: number; body: string; error?: "TIMEOUT" | "NETWORK" };

export async function executeToolCall(
  tool: { base_url: string; auth_header_type?: string | null; custom_header_name?: string | null; sample_request?: unknown },
  apiKey: string,
  payload: unknown,
  fetcher: typeof fetch = fetch,
): Promise<ToolCallResult> {
  const url = normalizeToolUrl(tool.base_url);
  const headers = buildToolHeaders(apiKey, tool.auth_header_type, tool.custom_header_name);
  const body = validateToolPayload(payload, tool.sample_request);
  headers.set("Content-Type", "application/json");
  const start = Date.now();
  try {
    const res = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20000) });
    const text = (await res.text()).slice(0, 8000);
    return { success: res.status >= 200 && res.status < 300, status: res.status, latency: Date.now() - start, body: text };
  } catch (error) {
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    return { success: false, status: null, latency: Date.now() - start, body: "", error: timedOut ? "TIMEOUT" : "NETWORK" };
  }
}
