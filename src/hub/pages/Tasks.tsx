import { useEffect, useState } from "react";
import { ArrowLeft, Play, Pause, RefreshCw, XCircle, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { ApiClient } from "../api-client";
import type { Task, TaskStep } from "../types";
import { CommandBox } from "../components/CommandBox";
import { StatusBadge, SubTabs, ErrorBox } from "../ui";

type Tab = "tasks" | "schedules" | "activity";

export function Tasks({ selectedTaskId, onBack, onSelectTask }: { selectedTaskId?: string | null; onBack?: () => void; onSelectTask?: (id: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [tab, setTab] = useState<Tab>("tasks");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", command: "", mode: "cron" as "cron" | "once", cronExpression: "0 9 * * *", runOnceAt: "", timezone: "Asia/Bangkok" });

  const loadTasks = async () => { const res = await ApiClient.request("tasks-service/list?limit=100"); setTasks(res.tasks || []); };
  const loadTaskDetail = async (id: string) => {
    try { const res = await ApiClient.request(`tasks-service/detail?id=${id}`); setCurrentTask(res.task); setSteps(res.steps || []); return res.task as Task; }
    catch (e: any) { setLoadError(e.message); return null; }
  };
  const loadSchedules = async () => {
    try { const res = await ApiClient.request("schedules-service/list"); setSchedules(res.schedules || []); setLoadError(""); }
    catch (e: any) { setLoadError(e.message || "โหลดตารางเวลาไม่สำเร็จ"); }
  };
  const loadActivity = async (q = "") => {
    try { const res = await ApiClient.request(`tasks-service/activity${q ? `?q=${encodeURIComponent(q)}` : ""}`); setActivity(res.activity || []); setLoadError(""); }
    catch (e: any) { setLoadError(e.message || "โหลดบันทึกกิจกรรมไม่สำเร็จ"); }
  };

  useEffect(() => {
    if (selectedTaskId) {
      // Poll the task; while it's active, also advance the queue so results appear without waiting for the background tick.
      const poll = async () => {
        const t = await loadTaskDetail(selectedTaskId);
        if (t && (t.status === "QUEUED" || t.status === "RUNNING")) ApiClient.request("tasks-service/tick", { method: "POST", body: "{}" }).catch(() => {});
      };
      poll();
      const timer = setInterval(poll, 5000);
      return () => clearInterval(timer);
    }
    setCurrentTask(null);
    if (tab === "tasks") loadTasks().catch((e: any) => setLoadError(e.message));
    if (tab === "schedules") loadSchedules();
    if (tab === "activity") loadActivity(search);
    return undefined;
  }, [selectedTaskId, tab]);

  const handleControl = async (commandType: string) => {
    if (!currentTask) return;
    try {
      await ApiClient.request("tasks-service/control", { method: "POST", body: JSON.stringify({ taskId: currentTask.id, commandType }) });
      loadTaskDetail(currentTask.id);
    } catch (e: any) { toast.error(e.message); }
  };

  const saveSchedule = async () => {
    try {
      await ApiClient.request("schedules-service/save", { method: "POST", body: JSON.stringify({ name: form.name, command: form.command, timezone: form.timezone, ...(form.mode === "cron" ? { cronExpression: form.cronExpression } : { runOnceAt: form.runOnceAt ? new Date(form.runOnceAt).toISOString() : "" }) }) });
      setShowForm(false); setForm({ ...form, name: "", command: "" }); toast.success("บันทึกตารางเวลาแล้ว"); loadSchedules();
    } catch (e: any) { toast.error(e.message); }
  };
  const toggleSchedule = async (id: string, enabled: boolean) => { try { await ApiClient.request("schedules-service/toggle", { method: "POST", body: JSON.stringify({ id, enabled }) }); loadSchedules(); } catch (e: any) { toast.error(e.message); } };
  const deleteSchedule = async (id: string) => { if (!confirm("ลบตารางเวลานี้?")) return; try { await ApiClient.request("schedules-service/delete", { method: "POST", body: JSON.stringify({ id }) }); loadSchedules(); } catch (e: any) { toast.error(e.message); } };

  if (currentTask) {
    const active = currentTask.status === "RUNNING" || currentTask.status === "QUEUED";
    return (
      <div className="space-y-6">
        <button onClick={() => { setCurrentTask(null); onBack?.(); }} className="flex items-center space-x-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /><span>กลับไปยังรายการงาน</span></button>
        <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <StatusBadge status={currentTask.status} />
            <div className="flex space-x-2">
              {active ? <button onClick={() => handleControl("pause")} className="rounded-lg bg-warning/10 p-1.5 text-warning hover:bg-warning/20" title="หยุดพัก"><Pause size={14} /></button>
                : currentTask.status === "PAUSED" ? <button onClick={() => handleControl("resume")} className="rounded-lg bg-success/10 p-1.5 text-success hover:bg-success/20" title="ทำงานต่อ"><Play size={14} /></button> : null}
              <button onClick={() => handleControl("retry")} className="rounded-lg bg-secondary p-1.5 hover:bg-secondary/80" title="ลองใหม่"><RefreshCw size={14} /></button>
              <button onClick={() => handleControl("cancel")} className="rounded-lg bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/20" title="ยกเลิก"><XCircle size={14} /></button>
            </div>
          </div>
          <h2 className="text-lg font-bold">{currentTask.goal}</h2>
          <div className="text-[11px] text-muted-foreground">ขั้นที่ {currentTask.current_step}/{currentTask.total_steps}{currentTask.selected_model && ` · โมเดล: ${currentTask.selected_model.display_name}`}{currentTask.model_selection_reason && ` · ${currentTask.model_selection_reason}`}</div>
          {active && <div className="flex items-center gap-2 text-[11px] text-primary"><Zap size={12} className="animate-pulse" />กำลังประมวลผล ระบบจะอัปเดตอัตโนมัติ</div>}
          {currentTask.failure_reason && <div className="whitespace-pre-wrap rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive"><div className="mb-1 font-semibold">สาเหตุที่ล้มเหลว:</div>{currentTask.failure_reason}</div>}
          {currentTask.result_summary && <div className="whitespace-pre-wrap rounded-xl border border-success/20 bg-success/10 p-3 text-xs text-success"><div className="mb-1 font-semibold">ผลลัพธ์สุดท้าย:</div>{currentTask.result_summary}</div>}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">ขั้นตอนการดำเนินงาน ({steps.length})</h3>
          {steps.length === 0 && <p className="text-xs text-muted-foreground">ยังไม่มีแผน — ระบบจะให้ AI วางแผนขั้นตอนเมื่อเริ่มประมวลผล</p>}
          {steps.map((s) => (
            <div key={s.id} className="space-y-1 rounded-xl border border-border bg-card/60 p-3 text-xs">
              <div className="flex justify-between gap-2"><span className="font-medium">ขั้นที่ {s.step_number}: {s.description}</span><StatusBadge status={s.status} /></div>
              {s.output_payload?.summary && <div className="whitespace-pre-wrap border-t border-border/40 pt-1 text-[11px] text-muted-foreground">{s.output_payload.summary}</div>}
              {s.error_message && <div className="text-[11px] text-destructive">{s.error_message}</div>}
            </div>
          ))}
        </div>
        <div className="pt-2">
          <div className="mb-2 text-xs text-muted-foreground">สั่งงานต่อในภารกิจนี้:</div>
          <CommandBox taskId={currentTask.id} onSuccess={() => loadTaskDetail(currentTask.id)} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SubTabs value={tab} onChange={setTab} items={[["tasks", "รายการงาน"], ["schedules", "ตารางเวลา"], ["activity", "บันทึกกิจกรรม"]]} />
      <ErrorBox message={loadError} />

      {tab === "activity" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadActivity(search)} placeholder="ค้นหาบันทึกกิจกรรม" className="field" />
            <button onClick={() => loadActivity(search)} className="rounded-lg bg-secondary px-3 py-2 text-xs">ค้นหา</button>
          </div>
          {activity.length ? activity.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-3 text-xs">
              <div className="flex justify-between"><b>{a.event_type}</b><time className="text-muted-foreground">{new Date(a.created_at).toLocaleString("th-TH")}</time></div>
              <p className="mt-1 text-muted-foreground">{a.description}</p>
              {a.task_id && <button onClick={() => onSelectTask?.(a.task_id)} className="mt-1 text-[10px] text-primary">เปิดงาน</button>}
            </div>
          )) : <p className="py-6 text-center text-xs text-muted-foreground">ไม่มีบันทึกกิจกรรม</p>}
        </div>
      )}

      {tab === "schedules" && (
        <div className="space-y-3">
          <div className="flex justify-end"><button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground"><Plus size={14} />เพิ่มตารางเวลา</button></div>
          {showForm && (
            <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
              <input className="field" placeholder="ชื่อตารางเวลา" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="field" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "cron" | "once" })}><option value="cron">ทำซ้ำ (cron)</option><option value="once">ครั้งเดียว</option></select>
              <textarea className="field md:col-span-2" rows={3} placeholder="คำสั่งที่จะส่งให้ AI" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
              {form.mode === "cron"
                ? <label className="text-xs text-muted-foreground">Cron (นาที ชั่วโมง วัน เดือน วันในสัปดาห์)<input className="field mt-1 font-mono" value={form.cronExpression} onChange={(e) => setForm({ ...form, cronExpression: e.target.value })} /></label>
                : <label className="text-xs text-muted-foreground">วันเวลา<input type="datetime-local" className="field mt-1" value={form.runOnceAt} onChange={(e) => setForm({ ...form, runOnceAt: e.target.value })} /></label>}
              <label className="text-xs text-muted-foreground">Timezone<input className="field mt-1" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label>
              <button onClick={saveSchedule} className="rounded-lg bg-success px-3 py-2 text-xs text-success-foreground md:col-span-2">บันทึกตารางเวลา</button>
            </div>
          )}
          {schedules.length ? schedules.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 text-xs">
              <div className="min-w-0">
                <b>{item.name}</b> <span className="font-mono text-[10px] text-muted-foreground">{item.cron_expression || "ครั้งเดียว"}</span>
                <p className="mt-1 text-muted-foreground">{item.command}</p>
                <p className="mt-1 text-muted-foreground">ครั้งถัดไป: {item.next_run_at ? new Date(item.next_run_at).toLocaleString("th-TH") : "ยังไม่กำหนด"} · ผลล่าสุด: {item.last_run_status || "ยังไม่เคยทำงาน"}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => toggleSchedule(item.id, !item.is_enabled)} className={item.is_enabled ? "text-success" : "text-muted-foreground"}>{item.is_enabled ? "เปิด" : "ปิด"}</button>
                <button onClick={() => deleteSchedule(item.id)} className="text-destructive" aria-label="ลบ"><Trash2 size={14} /></button>
              </div>
            </div>
          )) : <p className="py-6 text-center text-xs text-muted-foreground">ยังไม่มีตารางเวลา</p>}
        </div>
      )}

      {tab === "tasks" && (
        <div className="space-y-2">
          <CommandBox onSuccess={(id) => onSelectTask?.(id)} />
          {tasks.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">ยังไม่มีงาน</p>}
          {tasks.map((t) => (
            <button key={t.id} onClick={() => (onSelectTask ? onSelectTask(t.id) : loadTaskDetail(t.id))} className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-left text-xs hover:border-primary/40">
              <div className="min-w-0"><div className="truncate font-semibold">{t.goal}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleString("th-TH")} · ขั้น {t.current_step}/{t.total_steps}</div></div>
              <StatusBadge status={t.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
