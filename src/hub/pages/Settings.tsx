import { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth";
import { ApiClient } from "../api-client";
import { ErrorBox } from "../ui";

export function Settings() {
  const { lock } = useAuth();
  const [tokens, setTokens] = useState<any[]>([]);
  const [newToken, setNewToken] = useState("");
  const [error, setError] = useState("");
  const [pins, setPins] = useState({ current: "", next: "" });
  const [maxSteps, setMaxSteps] = useState<number>(30);

  const load = async () => {
    try {
      const res = await ApiClient.request("settings-service/api-tokens"); setTokens(res.apiTokens || []);
      const sys = await ApiClient.request("settings-service/system"); setMaxSteps(sys.settings?.max_steps_per_task || 30);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const createToken = async () => {
    try { const res = await ApiClient.request("settings-service/create-api-token", { method: "POST", body: JSON.stringify({ name: `Remote API ${new Date().toLocaleDateString("th-TH")}` }) }); setNewToken(res.token); await load(); setError(""); }
    catch (e: any) { setError(e.message); }
  };
  const revoke = async (id: string) => { try { await ApiClient.request("settings-service/revoke-api-token", { method: "POST", body: JSON.stringify({ id }) }); await load(); } catch (e: any) { setError(e.message); } };
  const changePin = async () => {
    try { await ApiClient.request("auth-service/change-passcode", { method: "POST", body: JSON.stringify({ currentPasscode: pins.current, newPasscode: pins.next }) }); setPins({ current: "", next: "" }); toast.success("เปลี่ยนรหัส PIN แล้ว"); }
    catch (e: any) { toast.error(e.message); }
  };
  const saveMaxSteps = async () => { try { await ApiClient.request("settings-service/max-steps", { method: "POST", body: JSON.stringify({ maxSteps }) }); toast.success("บันทึกแล้ว"); } catch (e: any) { toast.error(e.message); } };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const box = "rounded-2xl border border-border bg-card p-4";

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold">การตั้งค่าระบบ</h2>
      <div className="space-y-3">
        <div className={`${box} flex items-center justify-between gap-3`}>
          <div><div className="text-sm font-semibold">ล็อกหน้าจอทันที</div><div className="text-xs text-muted-foreground">ปิดเซสชันและกลับสู่หน้าใส่รหัสผ่าน PIN</div></div>
          <button onClick={lock} className="rounded-xl border border-destructive/30 bg-destructive/15 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/25">ล็อกหน้าจอ</button>
        </div>

        <div className={`${box} space-y-3`}>
          <div className="text-sm font-semibold">เปลี่ยนรหัส PIN</div>
          <div className="grid gap-2 md:grid-cols-3">
            <input className="field" type="password" inputMode="numeric" maxLength={6} placeholder="PIN ปัจจุบัน" value={pins.current} onChange={(e) => setPins({ ...pins, current: e.target.value.replace(/\D/g, "") })} />
            <input className="field" type="password" inputMode="numeric" maxLength={6} placeholder="PIN ใหม่ (4–6 หลัก)" value={pins.next} onChange={(e) => setPins({ ...pins, next: e.target.value.replace(/\D/g, "") })} />
            <button onClick={changePin} disabled={pins.current.length < 4 || pins.next.length < 4} className="rounded-lg bg-secondary px-3 py-2 text-xs disabled:opacity-40">บันทึก PIN ใหม่</button>
          </div>
        </div>

        <div className={`${box} flex flex-wrap items-center justify-between gap-3`}>
          <div><div className="text-sm font-semibold">จำนวนขั้นตอนสูงสุดต่องาน</div><div className="text-xs text-muted-foreground">ป้องกันงานที่วนไม่จบ</div></div>
          <div className="flex gap-2"><input className="field w-24" type="number" min={1} max={200} value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} /><button onClick={saveMaxSteps} className="rounded-lg bg-secondary px-3 text-xs">บันทึก</button></div>
        </div>

        <div className={`${box} flex items-center justify-between gap-3`}>
          <div><div className="text-sm font-semibold">โทเค็น Remote Submit API</div><div className="text-xs text-muted-foreground">สร้าง API Key สำหรับยิงคำสั่งจากภายนอก</div></div>
          <button onClick={createToken} className="rounded-xl bg-secondary px-3 py-1.5 text-xs hover:bg-secondary/80">สร้างโทเค็นใหม่</button>
        </div>
      </div>
      <ErrorBox message={error} />
      {newToken && (
        <div className="space-y-2 rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <b className="text-sm text-warning">คัดลอกโทเค็นนี้และเก็บในที่ปลอดภัย</b>
          <p className="text-xs text-muted-foreground">จะแสดงเต็มเพียงครั้งนี้เท่านั้น</p>
          <code className="block break-all rounded-lg bg-background p-3 text-xs">{newToken}</code>
          <button onClick={() => { navigator.clipboard.writeText(newToken); toast.success("คัดลอกแล้ว"); }} className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs"><Copy size={14} />คัดลอก</button>
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">โทเค็นที่สร้าง</h3>
        {tokens.length === 0 && <p className="text-xs text-muted-foreground">ยังไม่มีโทเค็น</p>}
        {tokens.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs">
            <div><b>{t.name}</b><div className="mt-1 text-muted-foreground">{t.token_prefix}•••• · {t.is_active ? "ใช้งาน" : "เพิกถอนแล้ว"}{t.last_used_at && ` · ใช้ล่าสุด ${new Date(t.last_used_at).toLocaleString("th-TH")}`}</div></div>
            {t.is_active && <button onClick={() => revoke(t.id)} title="เพิกถอน" className="rounded-lg p-2 text-destructive hover:bg-destructive/10"><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      <div className={`${box} space-y-2 text-xs`}>
        <div className="text-sm font-semibold">วิธีใช้ Remote API</div>
        <p className="text-muted-foreground">ส่งงาน:</p>
        <code className="block whitespace-pre-wrap break-all rounded-lg bg-background p-3">{`curl -X POST ${origin}/api/public/hub/remote-api/submit-task \\\n  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \\\n  -d '{"command":"สรุปข่าววันนี้"}'`}</code>
        <p className="text-muted-foreground">ตรวจสถานะ:</p>
        <code className="block break-all rounded-lg bg-background p-3">{`curl "${origin}/api/public/hub/remote-api/task-status?id=<TASK_ID>" -H "Authorization: Bearer <TOKEN>"`}</code>
      </div>
    </div>
  );
}
