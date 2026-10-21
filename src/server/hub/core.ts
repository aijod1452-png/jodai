// Shared server-side helpers for AI Hub (ported from supabase/functions/_shared).
// Server-only: never import from client components.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export async function getServiceClient(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export function maskSecret(key: string): string {
  return key ? "ตั้งค่าคีย์แล้ว" : "ยังไม่ตั้งค่าคีย์";
}

export function sanitizeDetails(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const clone: any = Array.isArray(obj) ? [...obj] : { ...obj };
  const sensitiveWords = ["key", "secret", "token", "password", "passcode", "auth"];
  for (const k of Object.keys(clone)) {
    if (sensitiveWords.some((w) => k.toLowerCase().includes(w))) clone[k] = "[REDACTED]";
    else if (typeof clone[k] === "object") clone[k] = sanitizeDetails(clone[k]);
  }
  return clone;
}

export async function logActivity(
  supabase: any,
  params: { eventType: string; description: string; taskId?: string | null; toolId?: string | null; modelId?: string | null; details?: Record<string, any> },
) {
  try {
    await supabase.from("activity_log").insert({
      event_type: params.eventType,
      description: params.description,
      task_id: params.taskId || null,
      tool_id: params.toolId || null,
      model_id: params.modelId || null,
      details: sanitizeDetails(params.details || {}),
    });
  } catch (err) {
    console.error("Failed to write activity log:", err);
  }
}

// PBKDF2 (100,000 iterations, SHA-256)
export async function hashPasscode(passcode: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passcode), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"],
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return Array.from(new Uint8Array(exported as ArrayBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashString(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validateSession(req: Request): Promise<{ valid: boolean; error?: string }> {
  const token = req.headers.get("x-session-token");
  if (!token) return { valid: false, error: "Missing session token" };
  const tokenHash = await hashString(token);
  const supabase = await getServiceClient();
  const { data: session, error } = await supabase.from("sessions").select("id, expires_at").eq("token_hash", tokenHash).single();
  if (error || !session) return { valid: false, error: "Invalid session" };
  if (new Date(session.expires_at) < new Date()) return { valid: false, error: "Session expired" };
  await supabase.from("sessions").update({ last_active_at: new Date().toISOString() }).eq("id", session.id);
  return { valid: true };
}

// ---------- AES-GCM secret encryption ----------
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function encryptionSources(): string[] {
  const sources = [process.env["AIH_SECRET_ENCRYPTION_KEY"], process.env["SUPABASE_SERVICE_ROLE_KEY"]]
    .filter((value): value is string => !!value);
  if (!sources.length) throw new Error("Missing secret encryption configuration");
  return [...new Set(sources)];
}
async function key(configured: string) {
  // Derive a 32-byte key from the configured secret.
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(configured));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encryptSecret(value: string): Promise<{ encrypted_secret: string; encryption_iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const source = encryptionSources()[0];
  if (!source) throw new Error("Missing secret encryption configuration");
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(source), encoder.encode(value));
  return { encrypted_secret: b64(new Uint8Array(encrypted)), encryption_iv: b64(iv) };
}
export async function decryptSecret(encrypted: string | null, iv: string | null, legacy?: string | null): Promise<string> {
  if (!encrypted && !iv) return legacy || "";
  if (encrypted && iv) {
    for (const source of encryptionSources()) {
      try {
        return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(source), unb64(encrypted)));
      } catch {
        // Older records may have used the service key. Never return ciphertext or
        // silently downgrade to legacy plaintext when an encrypted record fails.
      }
    }
  }
  throw new Error("Stored secret could not be decrypted; restore the original encryption configuration or re-enter the connection key");
}

// ---------- Cron ----------
function matches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    const [rangePart = "*", stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let low = min, high = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) [low, high] = rangePart.split("-").map(Number) as [number, number];
      else low = high = Number(rangePart);
    }
    return Number.isInteger(low) && Number.isInteger(high) && low >= min && high <= max && value >= low && value <= high && (value - low) % step === 0;
  });
}

export function nextCronRun(expression: string, timezone: string, after = new Date()): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const ranges: Array<[string, number, number]> = [[minute, 0, 59], [hour, 0, 23], [day, 1, 31], [month, 1, 12], [weekday, 0, 7]];
  if (ranges.some(([field, min, max]) => field.split(/[/,-]/).some((t) => t !== "*" && (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max)))) return null;
  const start = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short", hourCycle: "h23" });
  } catch {
    return null;
  }
  for (let i = 0; i < 60 * 24 * 370; i++) {
    const date = new Date(start + i * 60000);
    const parts: Record<string, string> = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts["weekday"] ?? "");
    if (
      matches(minute, Number(parts["minute"]), 0, 59) &&
      matches(hour, Number(parts["hour"]), 0, 23) &&
      matches(day, Number(parts["day"]), 1, 31) &&
      matches(month, Number(parts["month"]), 1, 12) &&
      (matches(weekday, dow, 0, 6) || (dow === 0 && matches(weekday, 7, 0, 7)))
    )
      return date.toISOString();
  }
  return null;
}
