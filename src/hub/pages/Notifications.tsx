import { useEffect, useState } from "react";
import { CheckCheck, ArrowLeft } from "lucide-react";
import { ApiClient } from "../api-client";
import { ErrorBox } from "../ui";

export function Notifications({ onBack, onSelectTask }: { onBack?: () => void; onSelectTask?: (id: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = async () => { try { const res = await ApiClient.request("notifications-service/list"); setItems(res.notifications || []); setError(""); } catch (e: any) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  const markRead = async (id?: string) => { try { await ApiClient.request("notifications-service/mark-read", { method: "POST", body: JSON.stringify(id ? { id } : { all: true }) }); await load(); } catch (e: any) { setError(e.message); } };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-xs text-muted-foreground"><ArrowLeft size={14} />กลับ</button>
        <button onClick={() => markRead()} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs"><CheckCheck size={14} />อ่านทั้งหมด</button>
      </div>
      <h2 className="text-lg font-bold">การแจ้งเตือน</h2>
      <ErrorBox message={error} />
      {items.length ? items.map((item) => (
        <button key={item.id} onClick={() => { if (!item.is_read) markRead(item.id); if (item.reference_id && String(item.type).startsWith("TASK_")) onSelectTask?.(item.reference_id); }} className={`w-full rounded-xl border p-3 text-left ${item.is_read ? "border-border bg-card/50" : "border-primary/30 bg-primary/5"}`}>
          <div className="flex justify-between gap-2"><b className="text-sm">{item.title}</b><time className="shrink-0 text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString("th-TH")}</time></div>
          <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
        </button>
      )) : <p className="py-10 text-center text-xs text-muted-foreground">ไม่มีการแจ้งเตือน</p>}
    </div>
  );
}
