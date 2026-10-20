import { useState } from "react";
import { Send, AtSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiClient } from "../api-client";

interface Props { onSuccess?: (taskId: string) => void; taskId?: string }

export function CommandBox({ onSuccess, taskId }: Props) {
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [duplicate, setDuplicate] = useState<any>(null);

  const kick = () => ApiClient.request("tasks-service/tick", { method: "POST", body: "{}" }).catch(() => {});

  const handleSubmit = async (forceNew = false) => {
    if (!command.trim() || loading) return;
    setLoading(true);
    try {
      if (taskId) {
        await ApiClient.request("tasks-service/follow-up", { method: "POST", body: JSON.stringify({ taskId, followUpCommand: command }) });
        setCommand("");
        kick();
        onSuccess?.(taskId);
      } else {
        const res = await ApiClient.request("tasks-service/submit", { method: "POST", body: JSON.stringify({ command, idempotencyKey: crypto.randomUUID(), forceNew }) });
        if (res.duplicateFound) { setDuplicate(res.existingTask); return; }
        setCommand("");
        kick();
        onSuccess?.(res.task.id);
      }
    } catch (err: any) {
      toast.error("เกิดข้อผิดพลาด: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full">
      <div className="flex items-center rounded-2xl border border-border bg-card p-2 shadow-lg transition-all focus-within:border-primary/60">
        <button type="button" className="rounded-xl p-2 text-muted-foreground hover:bg-secondary hover:text-primary" title="อ้างอิงเครื่องมือหรือพื้นที่จัดเก็บด้วย @" onClick={() => setCommand((c) => c + "@")}>
          <AtSign size={18} />
        </button>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          maxLength={4000}
          placeholder={taskId ? "พิมพ์คำสั่งเพิ่มเติมสำหรับงานนี้..." : "สั่งงาน AI หรือพิมพ์ภารกิจที่ต้องการ..."}
          className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button onClick={() => handleSubmit()} disabled={loading || !command.trim()} className="rounded-xl bg-primary p-2.5 text-primary-foreground transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-40" aria-label="ส่งคำสั่ง">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>

      {duplicate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6">
            <h3 className="text-lg font-bold">พบงานที่คล้ายกันกำลังทำงาน</h3>
            <p className="text-sm text-muted-foreground">พบงานเป้าหมาย "{duplicate.goal}" ที่ถูกสร้างเมื่อไม่นานมานี้ คุณต้องการทำอย่างไร?</p>
            <div className="flex flex-col gap-2 pt-2">
              <button onClick={() => { const d = duplicate; setDuplicate(null); onSuccess?.(d.id); }} className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">เปิดดูงานเดิม</button>
              <button onClick={() => { setDuplicate(null); handleSubmit(true); }} className="w-full rounded-xl bg-secondary py-2.5 text-sm font-medium hover:bg-secondary/80">สร้างเป็นงานใหม่ทันที</button>
              <button onClick={() => setDuplicate(null)} className="w-full py-2 text-xs text-muted-foreground">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
