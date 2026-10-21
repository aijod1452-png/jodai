import { useEffect, useState } from "react";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ApiClient } from "../api-client";
import { SubTabs, ErrorBox, StatusBadge } from "../ui";

type Tab = "tools" | "storage";

export function ToolsStorage() {
  const [tab, setTab] = useState<Tab>("tools");
  const [items, setItems] = useState<{ tools: any[]; storages: any[] }>({ tools: [], storages: [] });
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [toolForm, setToolForm] = useState({ name: "", description: "", baseUrl: "https://", apiKey: "", authHeaderType: "Bearer", customHeaderName: "" });
  const [storageForm, setStorageForm] = useState({ name: "", projectUrl: "https://", serviceRoleKey: "" });
  const [testing, setTesting] = useState("");

  const loadData = async () => { const res = await ApiClient.request("tools-storage-service/list"); setItems({ tools: res.tools || [], storages: res.storages || [] }); };
  useEffect(() => { loadData().catch((e: any) => setError(e.message)); }, []);

  const save = async () => {
    try {
      if (tab === "tools") await ApiClient.request("tools-storage-service/save-tool", { method: "POST", body: JSON.stringify({ ...toolForm, customHeaderName: toolForm.customHeaderName || null }) });
      else await ApiClient.request("tools-storage-service/save-storage", { method: "POST", body: JSON.stringify(storageForm) });
      setShowForm(false); setError(""); toast.success("บันทึกแล้ว"); await loadData();
    } catch (e: any) { setError(e.message); }
  };
  const remove = async (type: "tool" | "storage", id: string) => {
    if (!confirm("ต้องการลบการเชื่อมต่อนี้หรือไม่?")) return;
    try { await ApiClient.request("tools-storage-service/delete", { method: "POST", body: JSON.stringify({ type, id }) }); await loadData(); } catch (e: any) { setError(e.message); }
  };
    const test = async (type: "tool" | "storage", id: string) => {
    setTesting(id);
    try {
      const res = await ApiClient.request("tools-storage-service/test", {
        method: "POST",
        body: JSON.stringify({ type, id }),
      });
      if (res.success) {
        toast.success(`${res.message || "เชื่อมต่อสำเร็จ"}${res.latency ? ` · ${res.latency}ms` : ""}`);
      } else {
        toast.error(res.message || res.error || "เชื่อมต่อล้มเหลว");
      }
      if (res.warning) toast.warning(res.warning);
      await loadData();
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message || "เกิดข้อผิดพลาดในการทดสอบ");
    } finally {
      setTesting("");
    }
  };


  const row = (x: any, type: "tool" | "storage", url: string) => (
    <div key={x.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-xs">
      <div className="min-w-0">
        <b>{x.name}</b>{x.description && <span className="ml-2 text-muted-foreground">{x.description}</span>}
        <p className="mt-1 truncate text-muted-foreground">{url} · {x.maskedKey}</p>
        <p className="mt-1 flex items-center gap-2 text-muted-foreground">ทดสอบล่าสุด: {x.last_test_result ? <StatusBadge status={x.last_test_result} /> : "ยังไม่ทดสอบ"}{x.last_test_latency_ms ? ` ${x.last_test_latency_ms}ms` : ""}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => test(type, x.id)} disabled={testing === x.id} className="p-2 text-primary" aria-label="ทดสอบ"><RefreshCw size={14} className={testing === x.id ? "animate-spin" : ""} /></button>
        <button onClick={() => remove(type, x.id)} className="p-2 text-destructive" aria-label="ลบ"><Trash2 size={14} /></button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <SubTabs value={tab} onChange={(t) => { setTab(t); setShowForm(false); }} items={[["tools", "เครื่องมือ (Tools)"], ["storage", "พื้นที่จัดเก็บภายนอก (External Storage)"]]} />
      <ErrorBox message={error} />
      <div className="flex justify-end"><button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground"><Plus size={14} />เพิ่ม{tab === "tools" ? "เครื่องมือ" : "Storage"}</button></div>
      {showForm && (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
          {tab === "tools" ? (
            <>
              <input className="field" placeholder="ชื่อเครื่องมือ" value={toolForm.name} onChange={(e) => setToolForm({ ...toolForm, name: e.target.value })} />
              <input className="field" placeholder="คำอธิบาย" value={toolForm.description} onChange={(e) => setToolForm({ ...toolForm, description: e.target.value })} />
              <input className="field" placeholder="HTTPS endpoint" value={toolForm.baseUrl} onChange={(e) => setToolForm({ ...toolForm, baseUrl: e.target.value })} />
              <input className="field" type="password" placeholder="API key (ไม่บังคับ)" value={toolForm.apiKey} onChange={(e) => setToolForm({ ...toolForm, apiKey: e.target.value })} />
              <select className="field" value={toolForm.authHeaderType} onChange={(e) => setToolForm({ ...toolForm, authHeaderType: e.target.value })}><option>Bearer</option><option value="raw">Raw header value</option></select>
              <input className="field" placeholder="ชื่อ header (ค่าเริ่มต้น Authorization)" value={toolForm.customHeaderName} onChange={(e) => setToolForm({ ...toolForm, customHeaderName: e.target.value })} />
            </>
          ) : (
            <>
              <input className="field" placeholder="ชื่อ Storage" value={storageForm.name} onChange={(e) => setStorageForm({ ...storageForm, name: e.target.value })} />
              <input className="field" placeholder="Project URL" value={storageForm.projectUrl} onChange={(e) => setStorageForm({ ...storageForm, projectUrl: e.target.value })} />
              <input className="field md:col-span-2" type="password" placeholder="Service role key (เก็บเข้ารหัส)" value={storageForm.serviceRoleKey} onChange={(e) => setStorageForm({ ...storageForm, serviceRoleKey: e.target.value })} />
              <p className="text-xs text-warning md:col-span-2">Service role key มีสิทธิ์สูงมาก เก็บเฉพาะกรณีจำเป็นและอย่าเปิดเผย</p>
            </>
          )}
          <button onClick={save} className="rounded-lg bg-success px-3 py-2 text-xs text-success-foreground md:col-span-2">บันทึก</button>
        </div>
      )}
      <div className="space-y-2">
        {tab === "tools"
          ? items.tools.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">ยังไม่มีเครื่องมือที่เชื่อมต่อ</div> : items.tools.map((t) => row(t, "tool", t.base_url))
          : items.storages.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">ยังไม่มีฐานข้อมูลภายนอก</div> : items.storages.map((s) => row(s, "storage", s.project_url))}
      </div>
    </div>
  );
}
