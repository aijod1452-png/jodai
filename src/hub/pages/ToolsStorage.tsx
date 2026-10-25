import { useEffect, useState } from "react";
import { Plus, Trash2, RefreshCw, Pencil, Power, Archive, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ApiClient } from "../api-client";
import { SubTabs, ErrorBox, StatusBadge } from "../ui";
import { LINE_TOOL_TEMPLATE, LINE_RUN_PRESETS } from "../line-presets";

type Tab = "tools" | "storage";
const emptyTool = { id: "", name: "", description: "", baseUrl: "", apiKey: "", authHeaderType: "Bearer", customHeaderName: "", sampleRequest: "" };
const emptyStorage = { id: "", name: "", projectUrl: "", serviceRoleKey: "", bucketName: "" };
const snapshotTables = ["settings", "providers", "models", "router_state", "tools", "storage_connections", "tasks", "task_steps", "schedules", "schedule_runs", "usage_records", "activity_log", "notifications", "health_checks"];

export function ToolsStorage() {
  const [tab, setTab] = useState<Tab>("tools");
  const [items, setItems] = useState<{ tools: any[]; storages: any[] }>({ tools: [], storages: [] });
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [toolForm, setToolForm] = useState(emptyTool);
  const [storageForm, setStorageForm] = useState(emptyStorage);
  const [testing, setTesting] = useState("");
  const [saving, setSaving] = useState(false);
  const [snapshotTable, setSnapshotTable] = useState("tasks");
  const [snapshotStorage, setSnapshotStorage] = useState("");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<{ path: string; bytes: number; rows: number; bucket: string } | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [runTool, setRunTool] = useState<any | null>(null);
  const [runPayload, setRunPayload] = useState("");
  const [runResult, setRunResult] = useState<{ success: boolean; status: number | null; latency: number; body: string; error?: string } | null>(null);
  const [runBusy, setRunBusy] = useState(false);

  const loadData = async () => { const res = await ApiClient.request("tools-storage-service/list"); setItems({ tools: res.tools || [], storages: res.storages || [] }); };
  useEffect(() => { loadData().catch((e: any) => setError(e.message)); }, []);

  const openNew = () => { setToolForm(emptyTool); setStorageForm(emptyStorage); setShowForm(!showForm); };
  const edit = (type: "tool" | "storage", x: any) => {
    if (type === "tool") setToolForm({ id: x.id, name: x.name || "", description: x.description || "", baseUrl: x.base_url || "", apiKey: "", authHeaderType: x.auth_header_type || "Bearer", customHeaderName: x.custom_header_name || "", sampleRequest: x.sample_request ? JSON.stringify(x.sample_request) : "" });
    else setStorageForm({ id: x.id, name: x.name || "", projectUrl: x.project_url || "", serviceRoleKey: "", bucketName: x.bucket_name || "" });
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (tab === "tools") {
        const { id, ...rest } = toolForm;
        await ApiClient.request("tools-storage-service/save-tool", { method: "POST", body: JSON.stringify({ ...rest, ...(id ? { id } : {}), customHeaderName: rest.customHeaderName || null, sampleRequest: rest.sampleRequest || null }) });
      } else {
        const { id, ...rest } = storageForm;
        await ApiClient.request("tools-storage-service/save-storage", { method: "POST", body: JSON.stringify({ ...rest, ...(id ? { id } : {}) }) });
      }
      setShowForm(false); setError(""); toast.success("บันทึกแล้ว"); await loadData();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };
  const remove = async (type: "tool" | "storage", id: string) => {
    if (!confirm("ต้องการลบการเชื่อมต่อนี้หรือไม่?")) return;
    try { await ApiClient.request("tools-storage-service/delete", { method: "POST", body: JSON.stringify({ type, id }) }); await loadData(); } catch (e: any) { setError(e.message); }
  };
  const toggle = async (type: "tool" | "storage", x: any) => {
    try { await ApiClient.request("tools-storage-service/toggle", { method: "POST", body: JSON.stringify({ type, id: x.id, isEnabled: x.is_enabled === false }) }); await loadData(); } catch (e: any) { setError(e.message); }
  };
  const test = async (type: "tool" | "storage", id: string) => {
    setTesting(id);
    try {
      const res = await ApiClient.request("tools-storage-service/test", { method: "POST", body: JSON.stringify({ type, id }) });
      const text = `${res.message || (res.success ? "เชื่อมต่อสำเร็จ" : "เชื่อมต่อล้มเหลว")}${res.latency ? ` · ${res.latency}ms` : ""}`;
      setMessages((m) => ({ ...m, [id]: { ok: !!res.success, text } }));
      if (res.success) toast.success(text); else toast.error(text);
      if (res.warning) toast.warning(res.warning);
      await loadData();
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message || "เกิดข้อผิดพลาดในการทดสอบ");
    } finally { setTesting(""); }
  };

  const openRun = (tool: any) => {
    setRunTool(tool);
    setRunResult(null);
    setRunPayload(tool.sample_request ? JSON.stringify(tool.sample_request, null, 2) : "{}");
  };
  const runToolNow = async () => {
    if (!runTool) return;
    let payload: unknown;
    try { payload = JSON.parse(runPayload || "{}"); } catch { toast.error("payload ต้องเป็น JSON ที่ถูกต้อง"); return; }
    setRunBusy(true); setRunResult(null);
    try {
      const res = await ApiClient.request("tools-storage-service/run-tool", { method: "POST", body: JSON.stringify({ id: runTool.id, payload }) });
      setRunResult(res);
      if (res.success) toast.success(`สำเร็จ · HTTP ${res.status} · ${res.latency}ms`); else toast.error(res.status === null ? `เรียกไม่สำเร็จ (${res.error})` : `ปลายทางตอบ HTTP ${res.status}`);
    } catch (e: any) { toast.error(e.message || "รันเครื่องมือไม่สำเร็จ"); } finally { setRunBusy(false); }
  };
  const fillLineTemplate = () => setToolForm((f) => ({ ...f, description: LINE_TOOL_TEMPLATE.description, sampleRequest: JSON.stringify(LINE_TOOL_TEMPLATE.sampleRequest, null, 2) }));

  const snapshot = async () => {
    setSnapshotBusy(true); setSnapshotResult(null); setError("");
    try {
      const result = await ApiClient.request("tools-storage-service/safety-snapshot", { method: "POST", body: JSON.stringify({ tableName: snapshotTable, ...(snapshotStorage ? { storageId: snapshotStorage } : {}) }) });
      if (!result.success) throw new Error(result.error || "สำรองข้อมูลไม่สำเร็จ");
      setSnapshotResult(result); toast.success(result.message);
    } catch (e: any) { setError(e.message); } finally { setSnapshotBusy(false); }
  };

  const row = (x: any, type: "tool" | "storage", url: string) => (
    <div key={x.id} className={`flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-xs ${x.is_enabled === false ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <b>{x.name}</b>{x.is_enabled === false && <span className="ml-2 text-warning">ปิดใช้งาน</span>}{x.description && <span className="ml-2 text-muted-foreground">{x.description}</span>}
        <p className="mt-1 truncate text-muted-foreground">{url} · {x.maskedKey}{type === "storage" && ` · bucket: ${x.bucket_name || "ยังไม่ตั้งค่า"}`}</p>
        <p className="mt-1 flex items-center gap-2 text-muted-foreground">ทดสอบล่าสุด: {x.last_test_result ? <StatusBadge status={x.last_test_result} /> : "ยังไม่ทดสอบ"}{x.last_test_latency_ms ? ` ${x.last_test_latency_ms}ms` : ""}</p>
        {messages[x.id] && <p className={`mt-1 break-words ${messages[x.id]?.ok ? "text-success" : "text-destructive"}`}>{messages[x.id]?.text}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        {type === "tool" && <Button variant="ghost" size="icon" onClick={() => openRun(x)} className="text-success" aria-label="รันเครื่องมือ"><Play size={14} /></Button>}
        <Button variant="ghost" size="icon" onClick={() => test(type, x.id)} disabled={testing === x.id} className="text-primary" aria-label="ทดสอบ"><RefreshCw size={14} className={testing === x.id ? "animate-spin" : ""} /></Button>
        <Button variant="ghost" size="icon" onClick={() => edit(type, x)} className="text-muted-foreground" aria-label="แก้ไข"><Pencil size={14} /></Button>
        <Button variant="ghost" size="icon" onClick={() => toggle(type, x)} className={x.is_enabled === false ? "text-muted-foreground" : "text-success"} aria-label={x.is_enabled === false ? "เปิดใช้งาน" : "ปิดใช้งาน"}><Power size={14} /></Button>
        <Button variant="ghost" size="icon" onClick={() => remove(type, x.id)} className="text-destructive" aria-label="ลบ"><Trash2 size={14} /></Button>
      </div>
    </div>
  );

  const editing = tab === "tools" ? !!toolForm.id : !!storageForm.id;
  return (
    <div className="space-y-4">
      <SubTabs value={tab} onChange={(t) => { setTab(t); setShowForm(false); }} items={[["tools", "เครื่องมือ (Tools)"], ["storage", "พื้นที่จัดเก็บภายนอก (External Storage)"]]} />
      <ErrorBox message={error} />
      <div className="flex justify-end"><Button onClick={openNew}><Plus size={14} />เพิ่ม{tab === "tools" ? "เครื่องมือ" : "Storage"}</Button></div>
      {showForm && (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
          {editing && <p className="text-xs text-muted-foreground md:col-span-2">กำลังแก้ไข — เว้นช่องคีย์ว่างไว้เพื่อใช้คีย์เดิม</p>}
          {tab === "tools" ? (
            <>
              <input className="field" placeholder="ชื่อเครื่องมือ" value={toolForm.name} onChange={(e) => setToolForm({ ...toolForm, name: e.target.value })} />
              <input className="field" placeholder="คำอธิบาย" value={toolForm.description} onChange={(e) => setToolForm({ ...toolForm, description: e.target.value })} />
              <input className="field" placeholder="Endpoint URL (https://... หรือ /api/...)" value={toolForm.baseUrl} onChange={(e) => setToolForm({ ...toolForm, baseUrl: e.target.value })} />
              <input className="field" type="password" placeholder={editing ? "API key ใหม่ (เว้นว่าง = ใช้คีย์เดิม)" : "API key (ไม่บังคับ)"} value={toolForm.apiKey} onChange={(e) => setToolForm({ ...toolForm, apiKey: e.target.value })} />
              <select className="field" value={toolForm.authHeaderType} onChange={(e) => setToolForm({ ...toolForm, authHeaderType: e.target.value })}><option value="Bearer">Bearer</option><option value="raw">Raw header value</option></select>
              <input className="field" placeholder="ชื่อ header (ค่าเริ่มต้น Authorization)" value={toolForm.customHeaderName} onChange={(e) => setToolForm({ ...toolForm, customHeaderName: e.target.value })} />
              <textarea className="field md:col-span-2" rows={3} placeholder='ตัวอย่างคำขอ JSON (ไม่บังคับ) เช่น {"ping":true}' value={toolForm.sampleRequest} onChange={(e) => setToolForm({ ...toolForm, sampleRequest: e.target.value })} />
              <Button type="button" variant="outline" onClick={fillLineTemplate} className="md:col-span-2"><Sparkles size={14} />เติมเทมเพลต LINE (คำอธิบาย + ตัวอย่างคำขอ)</Button>
            </>
          ) : (
            <>
              <input className="field" placeholder="ชื่อ Storage" value={storageForm.name} onChange={(e) => setStorageForm({ ...storageForm, name: e.target.value })} />
              <input className="field" placeholder="Project URL" value={storageForm.projectUrl} onChange={(e) => setStorageForm({ ...storageForm, projectUrl: e.target.value })} />
              <input className="field md:col-span-2" aria-label="ชื่อ bucket" placeholder="ชื่อ bucket" value={storageForm.bucketName} onChange={(e) => setStorageForm({ ...storageForm, bucketName: e.target.value })} />
              <input className="field md:col-span-2" type="password" placeholder={editing ? "คีย์ใหม่ (เว้นว่าง = ใช้คีย์เดิม)" : "Service role key (เก็บเข้ารหัส)"} value={storageForm.serviceRoleKey} onChange={(e) => setStorageForm({ ...storageForm, serviceRoleKey: e.target.value })} />
              <p className="text-xs text-warning md:col-span-2">Service role key มีสิทธิ์สูงมาก เก็บเฉพาะกรณีจำเป็นและอย่าเปิดเผย</p>
            </>
          )}
          <Button onClick={save} disabled={saving} className="bg-success text-success-foreground md:col-span-2">{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
        </div>
      )}
      <div className="space-y-2">
        {tab === "tools"
          ? items.tools.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">ยังไม่มีเครื่องมือที่เชื่อมต่อ</div> : items.tools.map((t) => row(t, "tool", t.base_url))
          : items.storages.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">ยังไม่มีฐานข้อมูลภายนอก</div> : items.storages.map((s) => row(s, "storage", s.project_url))}
      </div>
      {tab === "storage" && <section className="space-y-3 border-t border-border pt-4">
        <h2 className="text-sm font-semibold">Safety Snapshot</h2>
        <div className="grid items-end gap-3 md:grid-cols-3">
          <label className="space-y-1 text-xs">ตาราง<select className="field" value={snapshotTable} onChange={e => setSnapshotTable(e.target.value)}>{snapshotTables.map(table => <option key={table} value={table}>{table}</option>)}</select></label>
          <label className="space-y-1 text-xs">ปลายทาง<select className="field" value={snapshotStorage} onChange={e => setSnapshotStorage(e.target.value)}><option value="">พื้นที่ส่วนตัวของแอป</option>{items.storages.filter(s => s.is_enabled && s.bucket_name).map(s => <option key={s.id} value={s.id}>{s.name} / {s.bucket_name}</option>)}</select></label>
          <Button onClick={snapshot} disabled={snapshotBusy}><Archive size={16} />{snapshotBusy ? "กำลังสำรอง..." : "สำรองข้อมูล"}</Button>
        </div>
        {snapshotResult && <p className="break-all text-xs text-success">{snapshotResult.bucket}/{snapshotResult.path} · {snapshotResult.rows} แถว · {snapshotResult.bytes} bytes</p>}
      </section>}
    </div>
  );
}
