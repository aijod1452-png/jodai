import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Wrench, CheckCircle2, XCircle, Bot, User } from "lucide-react";
import { ApiClient } from "../api-client";

type ToolExec = { toolName: string; success: boolean; httpStatus: number | null; latencyMs: number; body: string; error: string | null; payload: unknown };
type Msg = { role: "user" | "assistant"; content: string; model?: string; tool?: ToolExec | null; error?: boolean };

const QUICK_PROMPTS = [
  "สรุปสถานะระบบตอนนี้ให้หน่อย",
  "ส่ง LINE หา Bomb ว่า ทดสอบระบบ JodAI",
  "ส่ง LINE หา XAUUSD ว่า แจ้งเตือนราคาทอง",
  "มีเครื่องมืออะไรให้ใช้บ้าง",
  "/sum ",
  "/fix ",
];

function ToolCard({ t }: { t: ToolExec }) {
  return (
    <details className={`mt-2 rounded-xl border p-2 text-[11px] ${t.success ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
      <summary className="flex cursor-pointer items-center gap-1.5 font-semibold">
        <Wrench size={12} />{t.toolName}
        {t.success ? <CheckCircle2 size={12} className="text-success" /> : <XCircle size={12} className="text-destructive" />}
        <span className="font-normal text-muted-foreground">{t.httpStatus === null ? t.error : `HTTP ${t.httpStatus}`} · {t.latencyMs} ms</span>
      </summary>
      <div className="mt-2 space-y-1">
        <div className="text-muted-foreground">Payload</div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2">{JSON.stringify(t.payload, null, 2)}</pre>
        <div className="text-muted-foreground">Response</div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2">{t.body || t.error || "-"}</pre>
      </div>
    </details>
  );
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId] = useState(() => crypto.randomUUID());
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const res = await ApiClient.request<{ reply: string; model: string; toolExecution: ToolExec | null }>("chat-service/send", { method: "POST", body: JSON.stringify({ message, history, conversationId }) });
      setMessages((m) => [...m, { role: "assistant", content: res.reply, model: res.model, tool: res.toolExecution }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: e.message, error: true }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex h-[65vh] min-h-[420px] flex-col rounded-2xl border border-border bg-card/60">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Bot size={28} className="text-primary" />
            <p className="text-sm text-muted-foreground">พิมพ์คำสั่ง แล้ว AI จะตอบหรือเรียกเครื่องมือให้ทันที</p>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {QUICK_PROMPTS.map((p) => (
                <button key={p} onClick={() => send(p)} className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs hover:border-primary/50">{p}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && <Bot size={16} className={`mt-1 shrink-0 ${m.error ? "text-destructive" : "text-primary"}`} />}
            <div className={`max-w-[85%] text-sm ${m.role === "user" ? "rounded-2xl bg-primary px-3 py-2 text-primary-foreground" : m.error ? "text-destructive" : ""}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.tool && <ToolCard t={m.tool} />}
              {m.model && <div className="mt-1 text-[10px] text-muted-foreground">{m.model}</div>}
            </div>
            {m.role === "user" && <User size={16} className="mt-1 shrink-0 text-muted-foreground" />}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />กำลังคิดและเรียกเครื่องมือ (ถ้าจำเป็น)...</div>}
        <div ref={endRef} />
      </div>
      {messages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2">
          {QUICK_PROMPTS.map((p) => <button key={p} disabled={busy} onClick={() => send(p)} className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">{p}</button>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2 border-t border-border p-3">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          rows={1} maxLength={4000} placeholder="พิมพ์ข้อความ... (Enter ส่ง, Shift+Enter ขึ้นบรรทัด)" aria-label="ข้อความแชท"
          className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <button type="submit" disabled={busy || !input.trim()} aria-label="ส่ง" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}
