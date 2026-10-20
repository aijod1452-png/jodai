import type { ReactNode } from "react";

const tones: Record<string, string> = {
  QUEUED: "border-warning/30 bg-warning/10 text-warning",
  RUNNING: "border-primary/30 bg-primary/10 text-primary",
  SUCCEEDED: "border-success/30 bg-success/10 text-success",
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  PAUSED: "border-border bg-muted text-muted-foreground",
  CANCELED: "border-border bg-muted text-muted-foreground",
  PENDING: "border-border bg-muted text-muted-foreground",
  SKIPPED: "border-border bg-muted text-muted-foreground",
  SUCCESS: "border-success/30 bg-success/10 text-success",
};
const labels: Record<string, string> = {
  QUEUED: "ในคิว", RUNNING: "กำลังรัน", SUCCEEDED: "สำเร็จ", FAILED: "ล้มเหลว", PAUSED: "หยุดพัก", CANCELED: "ยกเลิก", PENDING: "รอ", SKIPPED: "ข้าม", SUCCESS: "สำเร็จ",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${tones[status] || tones["PENDING"]}`}>{labels[status] || status}</span>;
}

export function SubTabs<T extends string>({ value, onChange, items, right }: { value: T; onChange: (v: T) => void; items: [T, string][]; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
      <div className="flex flex-wrap gap-2">
        {items.map(([id, label]) => (
          <button key={id} onClick={() => onChange(id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${value === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>
      {right}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{message}</div>;
}
