export type SystemStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";

export interface Task {
  id: string;
  goal: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PAUSED" | "CANCELED";
  current_step: number;
  total_steps: number;
  result_summary?: string | null;
  failure_reason?: string | null;
  model_selection_reason?: string | null;
  selected_model?: { display_name: string; model_id: string } | null;
  created_at: string;
}

export interface TaskStep {
  id: string;
  task_id: string;
  step_number: number;
  action_type: "AI_CALL" | "TOOL_CALL" | "STORAGE_CALL";
  description: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  attempts: number;
  output_payload?: any;
  error_message?: string | null;
}

export interface Model {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  is_enabled: boolean;
  in_cooldown: boolean;
  priority: number;
  capabilities: { text: boolean; image: boolean | "unknown"; tools: boolean | "unknown"; long_context: boolean | "unknown" };
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  is_enabled: boolean;
  maskedKey: string;
  last_test_result?: string | null;
  last_test_latency_ms?: number | null;
  models: Model[];
}

export interface DashboardData {
  system: { status: SystemStatus; lastChecked: string | null; masterPause: boolean };
  tasks: { counts: { running: number; queued: number; failed_24h: number; paused: number }; recent: Task[] };
  ai: { enabledProviders: number; disabledProviders: number; enabledModels: number; disabledModels: number; cooldownModels: string[]; lastFallback: { time: string; reason: string } | null };
  usage: {
    today: { reported: { tokens: number; cost: number }; estimated: { tokens: number; cost: number } };
    last7Days: { reported: { tokens: number; cost: number }; estimated: { tokens: number; cost: number } };
  };
  schedules: any[];
  toolsStorage: { tools: any[]; storages: any[] };
  needsAttention: { type: string; id: string; title: string; action: string }[];
  recentActivity: any[];
}
