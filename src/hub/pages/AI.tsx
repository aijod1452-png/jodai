import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiClient } from "../api-client";
import type { Provider, Model } from "../types";
import { SubTabs, ErrorBox } from "../ui";

type Tab = "providers" | "router" | "usage";
const presets: Record<string, { baseUrl: string; modelId: string; displayName: string }> = {
  openai_compatible: { baseUrl: "https://api.openai.com/v1", modelId: "gpt-4o-mini", displayName: "GPT-4o mini" },
  anthropic: { baseUrl: "https://api.anthropic.com", modelId: "claude-3-5-haiku-latest", displayName: "Claude Haiku" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com", modelId: "gemini-1.5-flash", displayName: "Gemini Flash" },
  custom: { baseUrl: "https://", modelId: "", displayName: "" },
};

export function AI() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tab, setTab] = useState<Tab>("providers");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", type: "openai_compatible", ...presets["openai_compatible"]!, apiKey: "" });
  const [modelForm, setModelForm] = useState<Record<string, { modelId: string; displayName: string }>>({});
  const [router, setRouter] = useState<any>(null);
  const [usage, setUsage] = useState<any[]>([]);

  const loadProviders = async () => { const res = await ApiClient.request("ai-service/providers"); setProviders(res.providers || []); };
  const loadOther = async () => {
    try {
      if (tab === "router") { const res = await ApiClient.request("ai-service/router-settings"); setRouter(res.router); }
      if (tab === "usage") { const res = await ApiClient.request("dashboard-summary"); setUsage(res.recentActivity || []); }
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { loadProviders().catch((e: any) => setError(e.message)); }, []);
  useEffect(() => { loadOther(); }, [tab]);

  const saveProvider = async () => {
    try {
      if (!form.name.trim() || !form.baseUrl.trim() || !form.modelId.trim()) throw new Error("กรอกชื่อ Provider, URL และ Model ให้ครบ");
      await ApiClient.request("ai-service/save-provider", { method: "POST", body: JSON.stringify({ name: form.name, type: form.type, baseUrl: form.baseUrl, apiKey: form.apiKey, models: [{ modelId: form.modelId, displayName: form.displayName, capabilities: { text: true, image: "unknown", tools: "unknown", long_context: "unknown" } }] }) });
      setShowForm(false); setForm({ ...form, name: "", apiKey: "" }); setError(""); toast.success("บันทึก Provider แล้ว"); await loadProviders();
    } catch (e: any) { setError(e.message); }
  };
  const addModel = async (p: Provider) => {
    const m = modelForm[p.id];
    if (!m?.modelId?.trim()) return;
    try {
      await ApiClient.request("ai-service/save-provider", { method: "POST", body: JSON.stringify({ id: p.id, name: p.name, type: p.type, baseUrl: p.base_url, models: [{ modelId: m.modelId, displayName: m.displayName || m.modelId }] }) });
      setModelForm({ ...modelForm, [p.id]: { modelId: "", displayName: "" } }); await loadProviders();
    } catch (e: any) { setError(e.message); }
  };
  const updateKey = async (p: Provider) => {
    const apiKey = prompt(`API key ใหม่สำหรับ ${p.name}`);
    if (!apiKey) return;
    try { await ApiClient.request("ai-service/save-provider", { method: "POST", body: JSON.stringify({ id: p.id, name: p.name, type: p.type, baseUrl: p.base_url, apiKey }) }); toast.success("อัปเดต API key แล้ว"); await loadProviders(); }
    catch (e: any) { setError(e.message); }
  };
  const deleteProvider = async (id: string) => { if (!confirm("ลบ Provider และ Models ของ Provider นี้?")) return; try { await ApiClient.request("ai-service/delete-provider", { method: "POST", body: JSON.stringify({ id }) }); await loadProviders(); } catch (e: any) { setError(e.message); } };
  const deleteModel = async (id: string) => { if (!confirm("ลบโมเดลนี้?")) return; try { await ApiClient.request("ai-service/delete-model", { method: "POST", body: JSON.stringify({ id }) }); await loadProviders(); } catch (e: any) { setError(e.message); } };
  const toggle = async (target: string, enabled: boolean, id?: string) => { try { await ApiClient.request("ai-service/toggle", { method: "POST", body: JSON.stringify({ target, id, enabled }) }); await loadProviders(); } catch (e: any) { setError(e.message); } };
  const resetCooldown = async (id: string) => { try { await ApiClient.request("ai-service/reset-cooldown", { method: "POST", body: JSON.stringify({ id }) }); await loadProviders(); } catch (e: any) { setError(e.message); } };
  const saveRouter = async (fallbackOrder: string[], cooldownDurationSeconds: number) => {
    try { await ApiClient.request("ai-service/router-settings", { method: "POST", body: JSON.stringify({ fallbackOrder, cooldownDurationSeconds }) }); const res = await ApiClient.request("ai-service/router-settings"); setRouter(res.router); }
    catch (e: any) { setError(e.message); }
  };
  const testConnection = async (providerId: string) => {
    setTestingId(providerId);
    try {
      const res = await ApiClient.request("ai-service/test-connection", { method: "POST", body: JSON.stringify({ providerId }) });
      res.success ? toast.success(`เชื่อมต่อสำเร็จ! ค่า Latency: ${res.latency}ms`) : toast.error(`เชื่อมต่อล้มเหลว: ${res.error}`);
      loadProviders();
    } catch (e: any) { toast.error("เกิดข้อผิดพลาด: " + e.message); }
    finally { setTestingId(null); }
  };

  const allModels: Model[] = providers.flatMap((p) => p.models || []);
  const order: string[] = router?.fallback_order || [];
  const cooldown = router?.cooldown_duration_seconds || 300;

  return (
    <div className="space-y-6">
      <SubTabs value={tab} onChange={setTab} items={[["providers", "ผู้ให้บริการ"], ["router", "ตัวจัดเส้นทาง (Router)"], ["usage", "ปริมาณการใช้งาน (Usage)"]]}
        right={<div className="flex gap-1.5"><button onClick={() => toggle("all_providers", true)} className="rounded-lg bg-secondary px-2.5 py-1 text-[11px]">เปิดทั้งหมด</button><button onClick={() => toggle("all_providers", false)} className="rounded-lg bg-secondary px-2.5 py-1 text-[11px]">ปิดทั้งหมด</button></div>} />
      <ErrorBox message={error} />

      {tab === "providers" && (
        <div className="space-y-4">
          <div className="flex justify-end"><button onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground"><Plus size={14} />เพิ่ม Provider</button></div>
          {showForm && (
            <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
              <input className="field" placeholder="ชื่อ Provider" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, ...presets[e.target.value]! })}>
                <option value="openai_compatible">OpenAI compatible</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="custom">Custom</option>
              </select>
              <input className="field" placeholder="HTTPS Base URL" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              <input className="field" type="password" placeholder="API key (เก็บเข้ารหัส)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
              <input className="field" placeholder="Model ID" value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} />
              <input className="field" placeholder="ชื่อแสดงผล" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              <button onClick={saveProvider} className="rounded-lg bg-success px-3 py-2 text-xs text-success-foreground md:col-span-2">บันทึก Provider + Model</button>
            </div>
          )}
          {providers.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">ยังไม่มี Provider — เพิ่ม Provider และ API key เพื่อให้ระบบประมวลผลงานได้</p>}
          {providers.map((p) => (
            <div key={p.id} className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><div className="text-sm font-bold">{p.name}</div><div className="text-[10px] text-muted-foreground">{p.type} • {p.base_url}</div></div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => updateKey(p)} className="rounded bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground" title="เปลี่ยน API key">{p.maskedKey}</button>
                  <button onClick={() => toggle("provider", !p.is_enabled, p.id)} className={`rounded-lg px-2.5 py-1 text-xs ${p.is_enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{p.is_enabled ? "เปิดอยู่" : "ปิดอยู่"}</button>
                  <button onClick={() => testConnection(p.id)} disabled={testingId === p.id} className="rounded-lg border border-primary/30 bg-primary/15 px-2.5 py-1 text-xs text-primary hover:bg-primary/25">{testingId === p.id ? "กำลังทดสอบ..." : "ทดสอบการเชื่อมต่อ"}</button>
                </div>
              </div>
              <div className="space-y-1">
                {p.models?.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-background/50 p-2 text-xs">
                    <span>{m.display_name} <small className="text-muted-foreground">({m.model_id}) · priority {m.priority}</small>{m.in_cooldown && <button onClick={() => resetCooldown(m.id)} className="ml-2 text-[10px] text-warning underline">Cooldown — รีเซ็ต</button>}</span>
                    <span className="flex gap-3"><button onClick={() => toggle("model", !m.is_enabled, m.id)} className={m.is_enabled ? "text-success" : "text-muted-foreground"}>{m.is_enabled ? "เปิด" : "ปิด"}</button><button onClick={() => deleteModel(m.id)} className="text-destructive" aria-label="ลบโมเดล"><Trash2 size={12} /></button></span>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <input className="field" placeholder="เพิ่ม Model ID" value={modelForm[p.id]?.modelId || ""} onChange={(e) => setModelForm({ ...modelForm, [p.id]: { displayName: modelForm[p.id]?.displayName || "", modelId: e.target.value } })} />
                  <input className="field" placeholder="ชื่อแสดงผล" value={modelForm[p.id]?.displayName || ""} onChange={(e) => setModelForm({ ...modelForm, [p.id]: { modelId: modelForm[p.id]?.modelId || "", displayName: e.target.value } })} />
                  <button onClick={() => addModel(p)} className="rounded-lg bg-secondary px-3 text-xs">เพิ่ม</button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>ผลทดสอบล่าสุด: {p.last_test_result || "ยังไม่เคยทดสอบ"}{p.last_test_latency_ms ? ` · ความเร็ว: ${p.last_test_latency_ms}ms` : ""}</span>
                <button onClick={() => deleteProvider(p.id)} className="inline-flex items-center gap-1 text-destructive"><Trash2 size={12} />ลบ Provider</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "router" && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Router / fallback</h3>
          <p className="text-xs text-muted-foreground">โมเดลที่ระบุใน fallback order จะถูกลองตามลำดับก่อนโมเดล priority</p>
          <ol className="space-y-1 text-xs">{order.map((id, i) => <li key={id}>{i + 1}. {allModels.find((m) => m.id === id)?.display_name || id}</li>)}</ol>
          <p className="text-xs text-muted-foreground">Cooldown ปัจจุบัน: {router?.cooldown_duration_seconds ?? "—"} วินาที</p>
          {router?.last_fallback_event && <p className="text-xs text-muted-foreground">Fallback ล่าสุด: {new Date(router.last_fallback_event).toLocaleString("th-TH")} — {router.last_fallback_reason}</p>}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">จัดลำดับ fallback โดยกดปุ่มขึ้น/ลง</p>
            {allModels.map((m) => {
              const index = order.indexOf(m.id);
              return (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-background/50 p-2 text-xs">
                  <span>{m.display_name}</span>
                  <div className="flex gap-3">
                    <button disabled={index <= 0} onClick={() => { const n = [...order]; [n[index - 1], n[index]] = [n[index]!, n[index - 1]!]; saveRouter(n, cooldown); }} className="disabled:opacity-30">↑</button>
                    <button disabled={index < 0 || index >= order.length - 1} onClick={() => { const n = [...order]; [n[index], n[index + 1]] = [n[index + 1]!, n[index]!]; saveRouter(n, cooldown); }} className="disabled:opacity-30">↓</button>
                    <button onClick={() => saveRouter(index >= 0 ? order.filter((x) => x !== m.id) : [...order, m.id], cooldown)} className="text-primary">{index >= 0 ? "เอาออก" : "เพิ่ม"}</button>
                  </div>
                </div>
              );
            })}
            <label className="block text-xs text-muted-foreground">Cooldown (วินาที)
              <input className="field mt-1" type="number" min={30} max={86400} value={cooldown} onChange={(e) => setRouter({ ...router, cooldown_duration_seconds: Number(e.target.value) })} onBlur={() => saveRouter(order, cooldown)} />
            </label>
          </div>
        </div>
      )}

      {tab === "usage" && (
        <div className="space-y-2">
          {usage.filter((a) => /MODEL|ROUTER|STEP|PLANNED/.test(String(a.event_type))).map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-3 text-xs"><div className="flex justify-between"><b>{a.event_type}</b><time className="text-muted-foreground">{new Date(a.created_at).toLocaleString("th-TH")}</time></div><p className="mt-1 text-muted-foreground">{a.description}</p></div>
          ))}
          <p className="text-xs text-muted-foreground">สรุป tokens และค่าใช้จ่ายอยู่บนหน้าหลัก</p>
        </div>
      )}
    </div>
  );
}
