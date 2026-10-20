import { useState } from "react";
import { ShieldCheck, Lock, Delete, WifiOff } from "lucide-react";
import { useAuth } from "../auth";

export function LockScreen() {
  const { isInitialized, isLoading, offline, login, setupPasscode, retry } = useAuth();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const press = (n: string) => { if (pin.length < 6) { setPin(pin + n); setError(null); } };
  const del = () => { setPin(pin.slice(0, -1)); setError(null); };

  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin)) { setError("กรุณากรอกรหัส PIN 4–6 หลัก"); return; }
    setError(null); setLoading(true);
    try {
      if (!isInitialized) {
        if (!isConfirming) { setConfirmPin(pin); setPin(""); setIsConfirming(true); return; }
        if (pin !== confirmPin) { setError("รหัส PIN ไม่ตรงกัน กรุณาเริ่มใหม่"); setPin(""); setConfirmPin(""); setIsConfirming(false); return; }
        await setupPasscode(pin);
      } else await login(pin);
    } catch (err: any) {
      setError(err.message || "ไม่สามารถยืนยันรหัส PIN ได้");
      if (typeof err.data?.remainingAttempts === "number") setRemaining(err.data.remainingAttempts);
      setPin("");
    } finally { setLoading(false); }
  };

  if (isLoading) return <div className="fixed inset-0 flex items-center justify-center bg-background text-muted-foreground">กำลังตรวจสอบระบบ...</div>;
  if (offline || isInitialized === null)
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <WifiOff className="text-muted-foreground" size={32} />
        <p className="text-sm text-muted-foreground">เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต</p>
        <button onClick={retry} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">ลองอีกครั้ง</button>
      </div>
    );

  const key = "h-16 rounded-2xl border border-border bg-card text-xl font-semibold transition active:scale-95 hover:bg-secondary";
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center space-y-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary">{!isInitialized ? <ShieldCheck size={32} /> : <Lock size={32} />}</div>
        <div className="text-center">
          <h1 className="text-2xl font-bold">{!isInitialized ? (isConfirming ? "ยืนยันรหัส PIN" : "ตั้งรหัส PIN") : "ปลดล็อก AI Hub"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{!isInitialized ? "กำหนดรหัสตัวเลข 4–6 หลัก" : "กรอกรหัส PIN เพื่อเข้าใช้งาน"}</p>
        </div>
        <div className="my-4 flex space-x-3">
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <div key={i} className={`h-4 w-4 rounded-full border ${i < pin.length ? "border-primary bg-primary" : "border-border bg-card"}`} />
          ))}
        </div>
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
            {error}
            {remaining !== null && <div className="mt-1">เหลือโอกาสอีก {remaining} ครั้ง</div>}
          </div>
        )}
        <div className="grid w-full max-w-[280px] grid-cols-3 gap-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => <button key={n} onClick={() => press(n)} disabled={loading} className={key}>{n}</button>)}
          <button onClick={del} disabled={loading || pin.length === 0} aria-label="ลบ" className="flex h-16 items-center justify-center rounded-2xl border border-border/60 bg-card/40 text-muted-foreground"><Delete size={22} /></button>
          <button onClick={() => press("0")} disabled={loading} className={key}>0</button>
          <button onClick={submit} disabled={loading || pin.length < 4} className="h-16 rounded-2xl bg-primary font-semibold text-primary-foreground disabled:opacity-50">{loading ? "..." : "ตกลง"}</button>
        </div>
      </div>
    </div>
  );
}
