import { useEffect, useState } from "react";
import { Home, CheckSquare, Cpu, Wrench, Settings, Bell } from "lucide-react";
import { ApiClient } from "../api-client";

interface Props { activeTab: string; setActiveTab: (t: string) => void; onOpenNotifications: () => void }

export const TABS = [
  { id: "home", label: "หน้าหลัก", icon: Home },
  { id: "tasks", label: "งาน", icon: CheckSquare },
  { id: "ai", label: "เอไอ", icon: Cpu },
  { id: "tools-storage", label: "เครื่องมือ", icon: Wrench },
  { id: "settings", label: "ตั้งค่า", icon: Settings },
];

export function Navigation({ activeTab, setActiveTab, onOpenNotifications }: Props) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const load = () => ApiClient.request("notifications-service/unread-count").then((r) => setUnread(r.count || 0)).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [activeTab]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground">AI</div>
            <span className="font-bold">AI Hub</span>
          </div>
          <nav className="hidden items-center space-x-1 rounded-xl bg-card p-1 md:flex">
            {TABS.map((t) => { const Icon = t.icon; return (
              <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center space-x-2 rounded-lg px-3 py-2 text-xs ${activeTab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}><Icon size={14} /><span>{t.label}</span></button>
            ); })}
          </nav>
          <button onClick={onOpenNotifications} className="relative rounded-xl p-2 text-muted-foreground hover:bg-card" aria-label="การแจ้งเตือน">
            <Bell size={18} />
            {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">{unread > 99 ? "99+" : unread}</span>}
          </button>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-border bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.map((t) => { const Icon = t.icon; return (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] ${activeTab === t.id ? "text-primary" : "text-muted-foreground"}`}><Icon size={18} /><span>{t.label}</span></button>
        ); })}
      </nav>
    </>
  );
}
