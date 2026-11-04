// R19–R22 chat pipeline: exact prompt cache, slash snippets, user memories and rolling context compaction.
// Pure logic with an injected store so services and tests share one flow.
import { runChat, buildSystemPrompt, type ChatDeps, type ChatResult, type ChatTool, type ChatTurn } from "./chat";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPACT_THRESHOLD = 10;
export const KEEP_RECENT = 4;

export type Snippet = { command: string; template: string; system_instruction: string };
export type CacheEntry = { response: string; model_display_name: string; original_cost: number };

export type PipelineStore = {
  currentModelId: () => Promise<string>;
  getCache: (hash: string, modelId: string) => Promise<CacheEntry | null>;
  recordHit: (hash: string, modelId: string, costSaved: number) => Promise<void>;
  putCache: (hash: string, modelId: string, entry: CacheEntry, expiresAt: Date) => Promise<void>;
  getSnippet: (command: string) => Promise<Snippet | null>;
  listMemories: () => Promise<string[]>;
  addMemory: (content: string) => Promise<void>;
  getSummary: (conversationId: string) => Promise<{ summary: string; turns_covered: number } | null>;
  saveSummary: (conversationId: string, summary: string, turnsCovered: number) => Promise<void>;
};

export type PipelineResult = ChatResult & { cached?: boolean; memorySaved?: string; snippet?: string | undefined; compacted?: boolean };

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** R19: messages whose answer depends on the current time must always run live. */
export function isTimeSensitive(text: string): boolean {
  return /(วันนี้|ตอนนี้|เดี๋ยวนี้|ขณะนี้|เวลา|กี่โมง|พรุ่งนี้|เมื่อวาน|ล่าสุด|ปัจจุบัน|สัปดาห์นี้|เดือนนี้|ปีนี้|\btoday\b|\bnow\b|\btime\b|\bdate\b|\btomorrow\b|\byesterday\b|\blatest\b|\bcurrent\b)/i.test(text);
}

/** R20: "/cmd rest" → { command, input }. */
export function parseSnippet(text: string): { command: string; input: string } | null {
  const m = text.match(/^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i);
  return m ? { command: m[1].toLowerCase(), input: (m[2] || "").trim() } : null;
}

export function applySnippet(snippet: Snippet, input: string): { message: string; system: string } {
  return { message: snippet.template.split("{input}").join(input), system: snippet.system_instruction };
}

/** R21: "จำไว้ว่า ..." / "remember: ..." → fact to store. */
export function parseMemoryCommand(text: string): string | null {
  const m = text.trim().match(/^(?:จำไว้ว่า|ช่วยจำว่า|จำไว้|remember(?:\s+that)?\s*:?)\s*([\s\S]+)$/i);
  const fact = m?.[1].trim();
  return fact && fact.length <= 1000 ? fact : null;
}

export function memoryBlock(memories: string[]): string {
  return memories.length ? `ข้อเท็จจริงที่ผู้ใช้ให้จำไว้:\n${memories.map((m) => `- ${m}`).join("\n")}` : "";
}

const fmt = (turns: ChatTurn[]) => turns.map((t) => `${t.role === "user" ? "ผู้ใช้" : "ผู้ช่วย"}: ${t.content.slice(0, 2000)}`).join("\n");

/** R22: when history exceeds the threshold, fold older turns into a running summary and keep the latest turns. */
export async function compactHistory(conversationId: string | null, history: ChatTurn[], store: PipelineStore, deps: ChatDeps): Promise<{ summary: string; recent: ChatTurn[]; compacted: boolean }> {
  const existing = conversationId ? await store.getSummary(conversationId) : null;
  if (history.length <= COMPACT_THRESHOLD) return { summary: existing && existing.turns_covered <= history.length ? existing.summary : "", recent: history, compacted: false };
  const cut = history.length - KEEP_RECENT;
  const covered = existing && existing.turns_covered <= cut ? existing.turns_covered : 0;
  const prior = covered ? existing!.summary : "";
  if (covered === cut) return { summary: prior, recent: history.slice(cut), compacted: false };
  const call = await deps.callModel(
    `${prior ? `สรุปเดิม:\n${prior}\n\n` : ""}บทสนทนาเพิ่มเติม:\n${fmt(history.slice(covered, cut))}\n\nรวมเป็นสรุปเดียวที่กระชับ เก็บข้อเท็จจริง การตัดสินใจ และงานค้างไว้ครบ`,
    "คุณคือตัวบีบอัดบริบท ตอบเป็นสรุปภาษาไทยไม่เกิน 1200 ตัวอักษร",
  );
  await deps.recordUsage(call);
  const summary = call.result.text.slice(0, 2000);
  if (conversationId) await store.saveSummary(conversationId, summary, cut);
  await deps.log("CHAT_COMPACTED", `บีบอัดบริบท ${cut} turns`, { turnsCovered: cut }, call.router.model.model_id);
  return { summary, recent: history.slice(cut), compacted: true };
}

export async function runChatPipeline(
  input: { message: string; history: ChatTurn[]; conversationId: string | null },
  tools: ChatTool[], store: PipelineStore, deps: ChatDeps,
): Promise<PipelineResult> {
  const memoryFact = parseMemoryCommand(input.message);
  if (memoryFact) {
    await store.addMemory(memoryFact);
    await deps.log("MEMORY_SAVED", "บันทึกความจำผู้ใช้", { length: memoryFact.length });
    return { reply: `จำไว้แล้ว: ${memoryFact}`, model: "JodAI Memory", fallbackFrom: [], toolExecution: null, memorySaved: memoryFact };
  }

  let message = input.message, snippetSystem = "", snippetName: string | undefined;
  const slash = parseSnippet(message);
  if (slash) {
    const snippet = await store.getSnippet(slash.command);
    if (snippet) { const applied = applySnippet(snippet, slash.input); message = applied.message; snippetSystem = applied.system; snippetName = slash.command; }
  }

  const { summary, recent, compacted } = await compactHistory(input.conversationId, input.history, store, deps);
  const extra = [memoryBlock(await store.listMemories()), snippetSystem ? `คำสั่งเพิ่มเติม: ${snippetSystem}` : "", summary ? `สรุปบทสนทนาก่อนหน้า:\n${summary}` : ""].filter(Boolean).join("\n\n");

  const live = isTimeSensitive(message) || snippetName === "line";
  const modelId = live ? "" : await store.currentModelId();
  const hash = live ? "" : await sha256(JSON.stringify({ system: buildSystemPrompt(tools), extra, history: recent, message }));
  if (!live) {
    const hit = await store.getCache(hash, modelId);
    if (hit) {
      await store.recordHit(hash, modelId, hit.original_cost);
      await deps.log("CACHE_HIT", "ตอบจากแคช", { costSaved: hit.original_cost }, modelId);
      return { reply: hit.response, model: hit.model_display_name, fallbackFrom: [], toolExecution: null, cached: true, snippet: snippetName, compacted };
    }
  }

  let cost = 0;
  const trackingDeps: ChatDeps = { ...deps, recordUsage: async (c) => { cost += Number(c.result.cost) || 0; await deps.recordUsage(c); } };
  const result = await runChat(message, recent, tools, trackingDeps, extra);
  // Only plain replies from the expected model are cached; tool calls always run live.
  if (!live && !result.toolExecution && result.fallbackFrom.length === 0) {
    await store.putCache(hash, modelId, { response: result.reply, model_display_name: result.model, original_cost: cost }, new Date(Date.now() + CACHE_TTL_MS));
  }
  return { ...result, cached: false, snippet: snippetName, compacted };
}
