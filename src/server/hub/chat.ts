// R13 Chat-First Direct Engine: direct model call (no DB queue) with in-memory tool execution.
import { validateToolPayload, type ToolCallResult } from "./tool-connection";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatTool = { id: string; name: string; kind?: "r2"; storageId?: string; description?: string | null; sample_request?: unknown; base_url: string; auth_header_type?: string | null; custom_header_name?: string | null };
export type ModelCall = { router: { provider: any; model: any }; result: { text: string; promptTokens: number; completionTokens: number; cost: number; isEstimated: boolean }; tried: string[] };

export type ChatDeps = {
  callModel: (prompt: string, systemPrompt?: string) => Promise<ModelCall>;
  runTool: (tool: ChatTool, payload: unknown) => Promise<ToolCallResult>;
  recordUsage: (call: ModelCall) => Promise<void>;
  log: (eventType: string, description: string, details?: any, modelId?: string) => Promise<void>;
};

export type ChatToolExecution = { toolId: string; toolName: string; payload: unknown; success: boolean; httpStatus: number | null; latencyMs: number; body: string; error: string | null };
export type ChatResult = { reply: string; model: string; fallbackFrom: string[]; toolExecution: ChatToolExecution | null };

export function buildSystemPrompt(tools: ChatTool[]): string {
  const list = tools.length
    ? tools.map((t) => `- id: ${t.id}\n  name: ${t.name}\n  description: ${t.description || "-"}\n  sample_request: ${JSON.stringify(t.sample_request ?? {})}`).join("\n")
    : "(ไม่มีเครื่องมือที่เปิดใช้งาน)";
  return `คุณคือผู้ช่วย AI ของ JodAI ตอบเป็นภาษาไทยอย่างกระชับ\nเครื่องมือที่ใช้ได้:\n${list}\n\nหากต้องเรียกเครื่องมือ ให้ตอบเป็น JSON บรรทัดเดียวเท่านั้น: {"tool":"<id>","payload":{...}} โดย payload ต้องมีทุกฟิลด์ตาม sample_request\nหากไม่ต้องเรียกเครื่องมือ ให้ตอบเป็นข้อความปกติ`;
}

/** Extract a tool call decision from model text; returns null for a plain reply. */
export function parseToolDecision(text: string): { tool: string; payload: unknown } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (obj && typeof obj.tool === "string" && obj.payload !== undefined) return { tool: obj.tool, payload: obj.payload };
  } catch { /* plain text */ }
  return null;
}

const transcript = (history: ChatTurn[], message: string) =>
  [...history.slice(-10).map((t) => `${t.role === "user" ? "ผู้ใช้" : "ผู้ช่วย"}: ${t.content.slice(0, 2000)}`), `ผู้ใช้: ${message}`].join("\n");

export async function runChat(message: string, history: ChatTurn[], tools: ChatTool[], deps: ChatDeps): Promise<ChatResult> {
  const system = buildSystemPrompt(tools);
  const first = await deps.callModel(transcript(history, message), system);
  await deps.recordUsage(first);
  const decision = parseToolDecision(first.result.text);
  const tool = decision ? tools.find((t) => t.id === decision.tool || t.name === decision.tool) : undefined;
  if (!decision || !tool) {
    await deps.log("CHAT_REPLY", "ตอบแชท", { fallbackFrom: first.tried }, first.router.model.model_id);
    return { reply: first.result.text, model: first.router.model.display_name, fallbackFrom: first.tried, toolExecution: null };
  }

  let call: ToolCallResult;
  try {
    validateToolPayload(decision.payload, tool.sample_request);
    call = await deps.runTool(tool, decision.payload);
  } catch (e: any) {
    call = { success: false, status: null, latency: 0, body: "", error: tool.kind === "r2" ? "R2 operation failed or rejected" : e?.message || String(e) } as ToolCallResult;
  }
  // R2 write payloads can contain whole files; don't echo them in the execution card.
  const safePayload = tool.kind === "r2" ? { storageId: tool.storageId, operation: decision.payload && typeof decision.payload === "object" && "operation" in decision.payload ? decision.payload.operation : "rejected" } : decision.payload;
  const exec: ChatToolExecution = { toolId: tool.id, toolName: tool.name, payload: safePayload, success: call.success, httpStatus: call.status, latencyMs: call.latency, body: call.body, error: call.error ?? null };
  await deps.log("CHAT_TOOL_CALL", `แชทเรียก ${tool.name} → ${call.status === null ? call.error : `HTTP ${call.status}`}`, { httpStatus: call.status, latencyMs: call.latency, success: call.success }, first.router.model.model_id);

  const followUp = `${transcript(history, message)}\nผลการเรียกเครื่องมือ ${tool.name}: ${call.success ? "สำเร็จ" : "ล้มเหลว"} HTTP ${call.status ?? "-"}\n${(call.body || call.error || "").slice(0, 4000)}\nสรุปผลให้ผู้ใช้เป็นข้อความปกติ (ห้ามตอบเป็น JSON)`;
  const second = await deps.callModel(followUp, system);
  await deps.recordUsage(second);
  return { reply: second.result.text, model: second.router.model.display_name, fallbackFrom: [...first.tried, ...second.tried], toolExecution: exec };
}
