// Pure dispatch policies; state is local to a single server process, never a distributed limit.
export class ModelRpmThrottler {
  private requests = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  private prune() {
    const cutoff = this.now() - 60_000;
    for (const [id, times] of this.requests) {
      const active = times.filter(t => t > cutoff);
      if (active.length) this.requests.set(id, active); else this.requests.delete(id);
    }
  }
  available(id: string, limit?: number | null): boolean {
    this.prune();
    if (limit == null) return true;
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid model RPM limit");
    return (this.requests.get(id)?.length ?? 0) < limit;
  }
  tryAcquire(id: string, limit?: number | null): boolean {
    if (!this.available(id, limit)) return false;
    if (limit != null) this.requests.set(id, [...(this.requests.get(id) ?? []), this.now()]);
    return true;
  }
}

export class RollingModelLatency {
  private samples = new Map<string, number[]>();
  record(id: string, ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.set(id, [...(this.samples.get(id) ?? []), ms].slice(-20));
  }
  mean(id: string): number {
    const values = this.samples.get(id) ?? [];
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
}

export function rankModelsByLatency<T extends { id: string; priority: number }>(models: T[], latency: (id: string) => number = () => 0): T[] {
  return [...models].sort((a, b) => (a.priority + latency(a.id) / 1000) - (b.priority + latency(b.id) / 1000));
}
export function classifyPromptComplexity(prompt: string): "simple" | "complex" {
  return prompt.length > 500 || /```|\b(code|debug|analy[sz]e|analysis|plan|reason|tool|send|write|implement)\b|โค้ด|บั๊ก|วิเคราะห์|วางแผน|เหตุผล|เครื่องมือ|ส่ง|เขียน|สร้าง/i.test(prompt) ? "complex" : "simple";
}
export function isBudgetExceeded(spend: number, cap?: number | null): boolean {
  if (cap == null) return false;
  if (!Number.isFinite(cap) || cap < 0 || !Number.isFinite(spend) || spend < 0) throw new Error("Invalid daily budget or spend");
  return spend >= cap;
}
export function utcDayWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}
export function parseApiKeys(value: string): string[] {
  return [...new Set(value.split(",").map(k => k.trim()).filter(Boolean))];
}
export function maskSensitiveData(text: string, secrets: string[] = []): string {
  let safe = text;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join("[REDACTED]");
  return safe
    .replace(/\b(?:sk-(?:proj-)?|AIza|sb_secret_|AKIA)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/(\b(?:api[_ -]?key|access[_ -]?key|secret|token|password)\b["']?\s*[:=]\s*["']?)([^\s"',;}]+)/gi, "$1[REDACTED]")
    .replace(/(?<![\w\d])(?:\+\d[\d ()-]{7,}\d|0[689](?:[ -]?\d){8})(?![\w\d])/g, "[REDACTED_PHONE]");
}
export function squeezePrompt(text: string): string {
  // Entire structured inputs and fenced/indented code are preserved byte-for-byte.
  if (/^\s*[\[{]/.test(text)) return text;
  let fence = false;
  return text.split(/\r?\n/).map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
    if (fence || /^(?: {2,}|\t)/.test(line) || /^\s*[\[{"']/.test(line)) return line;
    return line.replace(/[ \t]+/g, " ").trimEnd();
  }).filter((line, i, lines) => line !== "" || i === 0 || lines[i - 1] !== "").join("\n").trim();
}

export function configuredLimit(raw: string | undefined, integer = false): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (integer && (!Number.isInteger(value) || value < 1))) throw new Error("Invalid routing limit configuration");
  return value;
}
export function isLovableGateway(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname === "ai.gateway.lovable.dev"; } catch { return false; }
}