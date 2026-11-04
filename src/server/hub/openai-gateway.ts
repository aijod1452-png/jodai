// R23 OpenAI-compatible gateway: Bearer api_tokens auth, OpenAI payload → callWithFallback → OpenAI wire format.
import { z } from "zod";

export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

const contentSchema = z.union([z.string().max(100_000), z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).max(50)]);
export const completionSchema = z.object({
  model: z.string().max(200).optional(),
  messages: z.array(z.object({ role: z.enum(["system", "developer", "user", "assistant", "tool"]), content: contentSchema.nullable().optional() }).passthrough()).min(1).max(200),
  stream: z.boolean().optional(),
}).passthrough();

const text = (c: unknown) => typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.type === "text" ? p.text || "" : "").join("") : "";

export function toPrompt(messages: z.infer<typeof completionSchema>["messages"]): { system: string; prompt: string } {
  const system = messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => text(m.content)).join("\n\n");
  const prompt = messages.filter((m) => m.role !== "system" && m.role !== "developer")
    .map((m) => `${m.role === "assistant" ? "assistant" : m.role === "tool" ? "tool" : "user"}: ${text(m.content)}`).join("\n");
  return { system, prompt };
}

const err = (status: number, message: string, type: string) => new Response(JSON.stringify({ error: { message, type } }), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export type GatewayDeps = {
  verifyToken: (raw: string) => Promise<boolean>;
  callModel: (prompt: string, system?: string) => Promise<{ router: { provider: any; model: any }; result: { text: string; promptTokens: number; completionTokens: number; cost: number; isEstimated: boolean } }>;
  recordUsage: (call: any) => Promise<void>;
  now?: () => number;
  id?: () => string;
};

export async function handleChatCompletions(req: Request, deps: GatewayDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return err(405, "Method not allowed", "invalid_request_error");
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !(await deps.verifyToken(token))) return err(401, "Invalid API token", "invalid_api_key");
  const parsed = completionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Invalid request body: messages are required", "invalid_request_error");
  const { system, prompt } = toPrompt(parsed.data.messages);
  if (!prompt.trim()) return err(400, "At least one user message is required", "invalid_request_error");

  let call;
  try { call = await deps.callModel(prompt, system || undefined); }
  catch { return err(502, "No model available or upstream model failed", "upstream_error"); }
  await deps.recordUsage(call);

  const id = `chatcmpl-${(deps.id ?? (() => crypto.randomUUID()))()}`;
  const created = Math.floor((deps.now ?? Date.now)() / 1000);
  const model = call.router.model.model_id;
  const usage = { prompt_tokens: call.result.promptTokens, completion_tokens: call.result.completionTokens, total_tokens: call.result.promptTokens + call.result.completionTokens };

  if (parsed.data.stream) {
    const chunk = (delta: any, finish: string | null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const body = chunk({ role: "assistant", content: call.result.text }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
    return new Response(body, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }
  return new Response(JSON.stringify({ id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content: call.result.text }, finish_reason: "stop" }], usage }), { headers: { ...CORS, "Content-Type": "application/json" } });
}
