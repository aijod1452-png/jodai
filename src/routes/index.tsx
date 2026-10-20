import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuthProvider, useAuth } from "@/hub/auth";
import { LockScreen } from "@/hub/components/LockScreen";
import { Navigation } from "@/hub/components/Navigation";
import { Home } from "@/hub/pages/Home";
import { Tasks } from "@/hub/pages/Tasks";
import { AI } from "@/hub/pages/AI";
import { ToolsStorage } from "@/hub/pages/ToolsStorage";
import { Settings } from "@/hub/pages/Settings";
import { Notifications } from "@/hub/pages/Notifications";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Hub — ศูนย์สั่งงาน AI ส่วนตัว" },
      { name: "description", content: "สั่งงาน AI หลายผู้ให้บริการ จัดคิวงาน ตั้งเวลา และติดตามผลในที่เดียว ปลดล็อกด้วย PIN" },
      { property: "og:title", content: "AI Hub — ศูนย์สั่งงาน AI ส่วนตัว" },
      { property: "og:description", content: "สั่งงาน AI หลายผู้ให้บริการ จัดคิวงาน ตั้งเวลา และติดตามผลในที่เดียว" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function MainApp() {
  const { isLocked, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("home");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  if (isLoading || isLocked) return <LockScreen />;
  const selectTask = (id: string) => { setSelectedTaskId(id); setActiveTab("tasks"); };
  const go = (t: string) => { setSelectedTaskId(null); setActiveTab(t); };
  return (
    <div className="flex min-h-screen flex-col">
      <Navigation activeTab={activeTab} setActiveTab={go} onOpenNotifications={() => go("notifications")} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:pb-10">
        {activeTab === "home" && <Home onSelectTask={selectTask} onNavigate={go} />}
        {activeTab === "tasks" && <Tasks selectedTaskId={selectedTaskId} onSelectTask={selectTask} onBack={() => go("tasks")} />}
        {activeTab === "ai" && <AI />}
        {activeTab === "tools-storage" && <ToolsStorage />}
        {activeTab === "settings" && <Settings />}
        {activeTab === "notifications" && <Notifications onBack={() => go("home")} onSelectTask={selectTask} />}
      </main>
    </div>
  );
}

function Index() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
