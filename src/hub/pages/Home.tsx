import { useEffect, useState } from "react";
import { AlertCircle, PauseCircle, PlayCircle, CheckCircle2, Clock, Sparkles, Activity, Layers, Database } from "lucide-react";
import { toast } from "sonner";
import { ApiClient } from "../api-client";
import type { DashboardData } from "../types";
import { CommandBox } from "../components/CommandBox";
import { StatusBadge } from "../ui";

const card = "space-y-3 rounded-2xl border border-border bg-card/60 p-4";
const head = "flex items-center justify-between text-xs font-semibold";

export function Home({ onSelectTask, onNavigate }: { onSelectTask: (id: string) => void; onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDashboard = async () => {
    try { setData(await ApiClient.request<DashboardData>("dashboard-summary")); setError(""); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchDashboard(); const t = setInterval(fetchDashboard, 15000); return () => clearInterval(t); }, []);

  const toggleMasterPause = async () => {
    if (!data) return;
    const next = !data.system.masterPause;
    setData({ ...data, system: { ...data.system, masterPause: next } });
    try { await ApiClient.request("settings-service/master-pause", { method: "POST", body: JSON.stringify({ paused: next }) }); }
    catch (e: any) { setData({ ...data, system: { ...data.system, masterPause: !next } }); toast.error(e.message); }
  };

  const handleAttention = async (item: DashboardData["needsAttention"][number]) => {
    try {
      if (item.action === "retry") { await ApiClient.request("tasks-service/control", { method: "POST", body: JSON.stringify({ taskId: item.id, commandType: "retry" }) }); toast.success("ส่งงานกลับเข้าคิวแล้ว"); }
      else if (item.action === "open") { onSelectTask(item.id); return; }
      else if (item.action === "reset_cooldown") { await ApiClient.request("ai-service/reset-cooldown", { method: "POST", body: JSON.stringify({ id: item.id }) }); toast.success("รีเซ็ต Cooldown แล้ว"); }
      else if (item.action === "retest_tool" || item.action === "retest_storage") {
        const res = await ApiClient.request("tools-storage-service/test", { method: "POST", body: JSON.stringify({ type: item.action === "retest_tool" ? "tool" : "storage", id: item.id }) });
        res.success ? toast.success("เชื่อมต่อสำเร็จ") : toast.error("เชื่อมต่อล้มเหลว");
      }
      fetchDashboard();
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading && !data) return <div className="p-8 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูลระบบ...</div>;

  const statusTone: Record<string, string> = {
    HEALTHY: "border-success/30 bg-success/10 text-success",
    DEGRADED: "border-warning/30 bg-warning/10 text-warning",
    DOWN: "border-destructive/30 bg-destructive/10 text-destructive",
    UNKNOWN: "border-border bg-muted text-muted-foreground",
  };
  const status = data?.system.status || "UNKNOWN";

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 p-4">
        <div className="flex items-center space-x-3">
          <div className={`flex items-center space-x-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${statusTone[status]}`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /><span>{status}</span>
          </div>
          <span className="text-xs text-muted-foreground">ตรวจล่าสุด: {data?.system.lastChecked ? new Date(data.system.lastChecked).toLocaleTimeString("th-TH") : "ไม่ทราบ"}</span>
        </div>
        <button onClick={toggleMasterPause} className={`flex items-center space-x-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${data?.system.masterPause ? "border-warning/40 bg-warning/15 text-warning" : "border-border bg-secondary hover:bg-secondary/80"}`}>
          {data?.system.masterPause ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
          <span>{data?.system.masterPause ? "กำลังหยุดชั่วคราว (กดเพื่อทำงานต่อ)" : "หยุดการประมวลผลทั้งหมด"}</span>
        </button>
      </div>

      <CommandBox onSuccess={onSelectTask} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className={card}>
          <div className={head}><span className="flex items-center gap-1.5"><Layers size={14} className="text-primary" />สถานะงาน</span><span className="text-muted-foreground">{data?.tasks.counts.running || 0} กำลังรัน</span></div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {([["running", "กำลังรัน", "text-primary"], ["queued", "ในคิว", "text-warning"], ["failed_24h", "ล้มเหลว 24h", "text-destructive"], ["paused", "หยุดพัก", "text-muted-foreground"]] as const).map(([k, l, c]) => (
              <div key={k} className="rounded-xl border border-border/50 bg-background/60 p-2"><div className={`font-bold ${c}`}>{data ? data.tasks.counts[k] : "—"}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{l}</div></div>
            ))}
          </div>
          {data?.tasks.recent.length === 0 ? <div className="py-4 text-center text-xs text-muted-foreground">ไม่มีงานที่กำลังดำเนินการ</div> : (
            <div className="space-y-1.5 pt-1">
              {data?.tasks.recent.slice(0, 3).map((t) => (
                <button key={t.id} onClick={() => onSelectTask(t.id)} className="flex w-full items-center justify-between rounded-xl border border-border/50 bg-background/40 p-2 text-left text-xs hover:border-primary/40">
                  <span className="truncate pr-2">{t.goal}</span><StatusBadge status={t.status} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={card}>
          <div className={head}><span className="flex items-center gap-1.5"><AlertCircle size={14} className="text-destructive" />สิ่งที่ต้องดูแล</span><span className="text-muted-foreground">{data?.needsAttention.length || 0} รายการ</span></div>
          {data?.needsAttention.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-6 text-center text-xs text-success"><CheckCircle2 size={18} /><span>ระบบทำงานปกติ ไม่มีรายการติดขัด</span></div>
          ) : (
            <div className="space-y-1.5">
              {data?.needsAttention.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 p-2 text-xs">
                  <span className="truncate">{item.title}</span>
                  <button onClick={() => handleAttention(item)} className="shrink-0 rounded-lg bg-destructive/20 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/30">จัดการ</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={card}>
          <div className={head}><span className="flex items-center gap-1.5"><Sparkles size={14} className="text-accent-foreground" />โมเดล AI</span><span className="text-muted-foreground">{data?.ai.enabledModels || 0} พร้อมใช้งาน</span></div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-border/50 bg-background/60 p-2.5"><div className="text-[10px] text-muted-foreground">ผู้ให้บริการ (Providers)</div><div className="mt-1 text-sm font-bold">{data?.ai.enabledProviders} เปิด / {data?.ai.disabledProviders} ปิด</div></div>
            <div className="rounded-xl border border-border/50 bg-background/60 p-2.5"><div className="text-[10px] text-muted-foreground">โมเดล (Models)</div><div className="mt-1 text-sm font-bold">{data?.ai.enabledModels} เปิด / {data?.ai.disabledModels} ปิด</div></div>
          </div>
          {!!data?.ai.cooldownModels.length && <div className="rounded-xl border border-warning/20 bg-warning/10 p-2 text-[11px] text-warning">โมเดลที่ติด Cooldown: {data.ai.cooldownModels.join(", ")}</div>}
          {data?.ai.lastFallback && <div className="text-[11px] text-muted-foreground">Fallback ล่าสุด: {new Date(data.ai.lastFallback.time).toLocaleString("th-TH")} — {data.ai.lastFallback.reason}</div>}
          {data && data.ai.enabledModels === 0 && <button onClick={() => onNavigate("ai")} className="text-[11px] text-primary underline">เพิ่ม Provider เพื่อเริ่มใช้งาน</button>}
        </div>

        <div className={card}>
          <div className={head}><span className="flex items-center gap-1.5"><Activity size={14} className="text-primary" />ปริมาณการใช้งาน (Usage)</span><span className="text-[10px] text-muted-foreground">วันนี้ / 7 วัน</span></div>
          <div className="space-y-2 text-xs">
            {([["รายงานโดยตรง (Reported)", "reported"], ["ประเมินโดยระบบ (Estimated)", "estimated"]] as const).map(([label, k]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-muted-foreground">
                <span>{label}:</span>
                <span className="text-right font-semibold text-foreground">
                  {data?.usage.today[k].tokens.toLocaleString()} tokens (${data?.usage.today[k].cost.toFixed(4)})
                  <span className="block text-[10px] font-normal text-muted-foreground">7 วัน: {data?.usage.last7Days[k].tokens.toLocaleString()} (${data?.usage.last7Days[k].cost.toFixed(4)})</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <div className={head}><span className="flex items-center gap-1.5"><Clock size={14} className="text-success" />กำหนดการทำงาน (Schedules)</span></div>
          {data?.schedules.length === 0 ? <div className="py-5 text-center text-xs text-muted-foreground">ไม่มีกำหนดการทำงานล่วงหน้า</div> : (
            <div className="space-y-1.5">
              {data?.schedules.map((s) => (
                <div key={s.id} className="flex justify-between rounded-xl border border-border/50 bg-background/40 p-2 text-xs">
                  <span className="truncate">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground">{s.next_run_at ? new Date(s.next_run_at).toLocaleString("th-TH") : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={card}>
          <div className={head}><span className="flex items-center gap-1.5"><Database size={14} className="text-warning" />เครื่องมือและพื้นที่จัดเก็บ</span></div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>เครื่องมือ (Tools): {data?.toolsStorage.tools.length || 0}</span>
            <span>พื้นที่จัดเก็บ (Storage): {data?.toolsStorage.storages.length || 0}</span>
          </div>
        </div>
      </div>

      {!!data?.recentActivity.length && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">กิจกรรมล่าสุด</h3>
          {data.recentActivity.slice(0, 6).map((a) => (
            <div key={a.id} className="flex justify-between gap-3 rounded-xl border border-border/50 bg-card/40 p-2 text-xs">
              <span className="truncate"><b className="mr-2 text-primary">{a.event_type}</b>{a.description}</span>
              <time className="shrink-0 text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleTimeString("th-TH")}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
