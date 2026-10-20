// AI Hub HTTP services (ported 1:1 from supabase/functions/*-service).
import { json, getServiceClient, validateSession, hashPasscode, hashString, encryptSecret, decryptSecret, logActivity, nextCronRun } from "./core";
import { testProviderConnection } from "./router-core";
import { runWorkerTick } from "./jobs";

type Ctx = { req: Request; action: string; body: any; url: URL; supabase: any };
type Handler = (ctx: Ctx) => Promise<Response>;

const newSessionToken = async (supabase: any, req: Request) => {
  const token = crypto.randomUUID() + "-" + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("sessions").insert({ token_hash: await hashString(token), expires_at: expiresAt, user_agent: req.headers.get("user-agent") || "" });
  return { token, expiresAt };
};

// ---------------- auth-service (status/setup/verify are public) ----------------
const authService: Handler = async ({ req, action, body, supabase }) => {
  if (action === "status") {
    const { data: settings, error } = await supabase.from("settings").select("is_initialized, locked_until").eq("id", "SYSTEM_CONFIG").single();
    if (error || !settings) return json({ error: "Settings unavailable" }, 500);
    const isLocked = !!settings.locked_until && new Date(settings.locked_until) > new Date();
    return json({ initialized: !!settings.is_initialized, isLocked, lockedUntil: settings.locked_until });
  }
  if (action === "setup") {
    const { passcode } = body;
    if (typeof passcode !== "string" || !/^\d{4,6}$/.test(passcode)) return json({ error: "PIN ต้องเป็นตัวเลข 4–6 หลัก" }, 400);
    const { data: existing, error: getErr } = await supabase.from("settings").select("id, is_initialized").eq("id", "SYSTEM_CONFIG").single();
    if (getErr || !existing) return json({ error: "System settings not initialized" }, 500);
    if (existing.is_initialized) return json({ error: "System already initialized" }, 409);
    const salt = crypto.randomUUID();
    const passcodeHash = await hashPasscode(passcode, salt);
    const { data: updated, error: updateErr } = await supabase.from("settings").update({ is_initialized: true, passcode_hash: passcodeHash, passcode_salt: salt, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", "SYSTEM_CONFIG").eq("is_initialized", false).select("id");
    if (updateErr) throw updateErr;
    if (!updated || updated.length === 0) return json({ error: "System already initialized" }, 409);
    return json({ success: true, ...(await newSessionToken(supabase, req)) });
  }
  if (action === "verify") {
    const { passcode } = body;
    if (typeof passcode !== "string" || !/^\d{4,6}$/.test(passcode)) return json({ error: "PIN ต้องเป็นตัวเลข 4–6 หลัก" }, 400);
    const { data: settings, error } = await supabase.from("settings").select("*").eq("id", "SYSTEM_CONFIG").single();
    if (error || !settings || !settings.is_initialized) return json({ error: "System not initialized" }, 400);
    if (settings.locked_until && new Date(settings.locked_until) > new Date()) {
      const remaining = Math.ceil((new Date(settings.locked_until).getTime() - Date.now()) / 1000);
      return json({ error: `ลองใหม่ได้ใน ${remaining} วินาที`, locked: true, retryAfterSeconds: remaining }, 423);
    }
    const inputHash = await hashPasscode(passcode, settings.passcode_salt || "");
    if (inputHash !== settings.passcode_hash) {
      const newFailed = (settings.failed_attempts || 0) + 1;
      const lockUntil = newFailed >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
      await supabase.from("settings").update({ failed_attempts: lockUntil ? 0 : newFailed, locked_until: lockUntil, updated_at: new Date().toISOString() }).eq("id", "SYSTEM_CONFIG");
      return json({ error: "รหัส PIN ไม่ถูกต้อง", failedAttempts: newFailed, remainingAttempts: Math.max(0, 5 - newFailed), locked: !!lockUntil }, 401);
    }
    await supabase.from("settings").update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", "SYSTEM_CONFIG");
    return json({ success: true, ...(await newSessionToken(supabase, req)) });
  }
  if (action === "check-session") {
    const auth = await validateSession(req);
    return json({ valid: auth.valid, error: auth.error }, auth.valid ? 200 : 401);
  }
  if (action === "change-passcode") {
    const auth = await validateSession(req);
    if (!auth.valid) return json({ error: auth.error }, 401);
    const { currentPasscode, newPasscode } = body;
    if (typeof newPasscode !== "string" || !/^\d{4,6}$/.test(newPasscode)) return json({ error: "PIN ใหม่ต้องเป็นตัวเลข 4–6 หลัก" }, 400);
    const { data: settings } = await supabase.from("settings").select("*").eq("id", "SYSTEM_CONFIG").single();
    const currentHash = await hashPasscode(String(currentPasscode || ""), settings.passcode_salt);
    if (currentHash !== settings.passcode_hash) return json({ error: "PIN ปัจจุบันไม่ถูกต้อง" }, 400);
    const newSalt = crypto.randomUUID();
    await supabase.from("settings").update({ passcode_hash: await hashPasscode(newPasscode, newSalt), passcode_salt: newSalt, updated_at: new Date().toISOString() }).eq("id", "SYSTEM_CONFIG");
    return json({ success: true });
  }
  if (action === "lock") {
    const token = req.headers.get("x-session-token");
    if (!token) return json({ error: "Missing session" }, 401);
    await supabase.from("sessions").delete().eq("token_hash", await hashString(token));
    return json({ success: true });
  }
  return json({ error: "Unknown action" }, 404);
};

// ---------------- dashboard-summary ----------------
const dashboardSummary: Handler = async ({ supabase }) => {
  const { data: settings } = await supabase.from("settings").select("master_pause").eq("id", "SYSTEM_CONFIG").single();
  const { data: latestHealth } = await supabase.from("health_checks").select("status, checked_at").order("checked_at", { ascending: false }).limit(1).maybeSingle();
  let computedStatus = "UNKNOWN";
  if (latestHealth) {
    const ageMinutes = (Date.now() - new Date(latestHealth.checked_at).getTime()) / 60000;
    computedStatus = ageMinutes > 5 ? "UNKNOWN" : latestHealth.status;
  }
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: allTasks } = await supabase.from("tasks").select("id, status, goal, current_step, total_steps, created_at, lease_expires_at").order("created_at", { ascending: false }).limit(10);
  const cnt = async (status: string, since?: string) => {
    let q = supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", status);
    if (since) q = q.gte("created_at", since);
    const { count } = await q;
    return count || 0;
  };
  const taskCounts = { running: await cnt("RUNNING"), queued: await cnt("QUEUED"), failed_24h: await cnt("FAILED", dayAgo), paused: await cnt("PAUSED") };

  const { data: providers } = await supabase.from("providers").select("id, is_enabled");
  const { data: models } = await supabase.from("models").select("id, is_enabled, in_cooldown, display_name");
  const { data: routerState } = await supabase.from("router_state").select("last_fallback_event, last_fallback_reason").eq("id", "GLOBAL_ROUTER").single();
  const aiSummary = {
    enabledProviders: providers?.filter((p: any) => p.is_enabled).length || 0,
    disabledProviders: providers?.filter((p: any) => !p.is_enabled).length || 0,
    enabledModels: models?.filter((m: any) => m.is_enabled).length || 0,
    disabledModels: models?.filter((m: any) => !m.is_enabled).length || 0,
    cooldownModels: models?.filter((m: any) => m.in_cooldown).map((m: any) => m.display_name) || [],
    lastFallback: routerState?.last_fallback_event ? { time: routerState.last_fallback_event, reason: routerState.last_fallback_reason } : null,
  };

  const bp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (t: string) => bp.find((p) => p.type === t)?.value || "";
  const todayStart = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00+07:00`);
  const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const { data: usage } = await supabase.from("usage_records").select("prompt_tokens, completion_tokens, cost, is_estimated, created_at").gte("created_at", sevenDaysAgo);
  const u = { r7t: 0, e7t: 0, r7c: 0, e7c: 0, rTt: 0, eTt: 0, rTc: 0, eTc: 0 };
  (usage || []).forEach((x: any) => {
    const isToday = new Date(x.created_at) >= todayStart;
    const tokens = (x.prompt_tokens || 0) + (x.completion_tokens || 0);
    const cost = Number(x.cost) || 0;
    if (x.is_estimated) { u.e7t += tokens; u.e7c += cost; if (isToday) { u.eTt += tokens; u.eTc += cost; } }
    else { u.r7t += tokens; u.r7c += cost; if (isToday) { u.rTt += tokens; u.rTc += cost; } }
  });

  const { data: upcomingSchedules } = await supabase.from("schedules").select("id, name, next_run_at, last_run_status, last_run_at").eq("is_enabled", true).order("next_run_at", { ascending: true }).limit(5);
  const { data: tools } = await supabase.from("tools").select("id, name, last_test_result, last_tested_at");
  const { data: storages } = await supabase.from("storage_connections").select("id, name, last_test_result, last_tested_at");

  const needsAttention: any[] = [];
  const { data: failedTasks } = await supabase.from("tasks").select("id,goal,status").eq("status", "FAILED").order("created_at", { ascending: false }).limit(5);
  (failedTasks || []).forEach((t: any) => needsAttention.push({ type: "FAILED_TASK", id: t.id, title: t.goal, action: "retry" }));
  const { data: stuckTasks } = await supabase.from("tasks").select("id,goal").eq("status", "RUNNING").lt("lease_expires_at", new Date().toISOString()).limit(5);
  (stuckTasks || []).forEach((t: any) => needsAttention.push({ type: "STUCK_TASK", id: t.id, title: t.goal, action: "open" }));
  (models || []).filter((m: any) => m.in_cooldown).forEach((m: any) => needsAttention.push({ type: "COOLDOWN_MODEL", id: m.id, title: m.display_name, action: "reset_cooldown" }));
  (tools || []).filter((t: any) => t.last_test_result === "FAILED").forEach((t: any) => needsAttention.push({ type: "TOOL_FAILED", id: t.id, title: t.name, action: "retest_tool" }));
  (storages || []).filter((s: any) => s.last_test_result === "FAILED").forEach((s: any) => needsAttention.push({ type: "STORAGE_FAILED", id: s.id, title: s.name, action: "retest_storage" }));

  const { data: recentActivity } = await supabase.from("activity_log").select("id, event_type, description, details, created_at").order("created_at", { ascending: false }).limit(15);
  return json({
    system: { status: computedStatus, lastChecked: latestHealth?.checked_at || null, masterPause: !!settings?.master_pause },
    tasks: { counts: taskCounts, recent: (allTasks || []).slice(0, 10) },
    ai: aiSummary,
    usage: {
      today: { reported: { tokens: u.rTt, cost: u.rTc }, estimated: { tokens: u.eTt, cost: u.eTc } },
      last7Days: { reported: { tokens: u.r7t, cost: u.r7c }, estimated: { tokens: u.e7t, cost: u.e7c } },
    },
    schedules: upcomingSchedules || [],
    toolsStorage: { tools: tools || [], storages: storages || [] },
    needsAttention,
    recentActivity: recentActivity || [],
  });
};

// ---------------- tasks-service ----------------
const tasksService: Handler = async ({ req, action, body, url, supabase }) => {
  if (action === "list" && req.method === "GET") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const { data, error } = await supabase.from("tasks").select("id,goal,status,current_step,total_steps,result_summary,failure_reason,created_at,updated_at").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return json({ tasks: data || [] });
  }
  if (action === "activity" && req.method === "GET") {
    let query = supabase.from("activity_log").select("id,task_id,tool_id,model_id,event_type,description,details,created_at").order("created_at", { ascending: false }).limit(100);
    const taskId = url.searchParams.get("taskId");
    const eventType = url.searchParams.get("eventType");
    const search = url.searchParams.get("q")?.trim();
    if (taskId) query = query.eq("task_id", taskId);
    if (eventType) query = query.eq("event_type", eventType);
    if (search) query = query.ilike("description", `%${search.replace(/[%_]/g, "\\$&")}%`);
    const { data, error } = await query;
    if (error) throw error;
    return json({ activity: data || [] });
  }
  if (action === "submit") {
    const { command, idempotencyKey, targetReference, forceNew } = body;
    if (typeof command !== "string" || !command.trim() || command.length > 4000) return json({ error: "Command is required" }, 400);
    const iKey = idempotencyKey || crypto.randomUUID();
    if (!forceNew) {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: dups } = await supabase.from("tasks").select("id, goal, status, created_at").eq("goal", command.trim()).in("status", ["QUEUED", "RUNNING", "PAUSED"]).gte("created_at", tenMinsAgo).order("created_at", { ascending: false }).limit(1);
      const duplicate = dups?.[0];
      if (duplicate) return json({ duplicateFound: true, existingTask: duplicate, message: "พบงานที่เป้าหมายเดียวกันกำลังดำเนินการอยู่ในช่วง 10 นาทีที่ผ่านมา" });
    }
    const { data: task, error: insertErr } = await supabase.from("tasks").insert({ idempotency_key: iKey, goal: command.trim(), status: "QUEUED", target_reference: targetReference || null }).select().single();
    if (insertErr) {
      if (insertErr.code === "23505") {
        const { data: existing } = await supabase.from("tasks").select().eq("idempotency_key", iKey).single();
        return json({ task: existing, deduplicated: true });
      }
      throw insertErr;
    }
    await logActivity(supabase, { taskId: task.id, eventType: "TASK_QUEUED", description: `สร้างงานใหม่: ${command.slice(0, 50)}...`, details: { idempotency: iKey } });
    return json({ success: true, task });
  }
  if (action === "tick" && req.method === "POST") {
    // Advance the queue immediately (in addition to the background schedule).
    return json(await runWorkerTick());
  }
  if (action === "detail") {
    const taskId = url.searchParams.get("id");
    if (!taskId) return json({ error: "Task ID required" }, 400);
    const { data: task, error: taskErr } = await supabase.from("tasks").select("*, selected_model:models(*)").eq("id", taskId).single();
    if (taskErr || !task) return json({ error: "Task not found" }, 404);
    const { data: steps } = await supabase.from("task_steps").select("*").eq("task_id", taskId).order("step_number", { ascending: true });
    return json({ task, steps: steps || [] });
  }
  if (action === "follow-up") {
    const { taskId, followUpCommand } = body;
    if (!followUpCommand || String(followUpCommand).length > 4000) return json({ error: "Follow-up command is required and must be under 4000 characters" }, 400);
    const { data: task } = await supabase.from("tasks").select("*").eq("id", taskId).single();
    if (!task) return json({ error: "Task not found" }, 404);
    const { count } = await supabase.from("task_steps").select("*", { count: "exact", head: true }).eq("task_id", taskId);
    const nextStepNum = (count || 0) + 1;
    await supabase.from("task_steps").insert({ task_id: taskId, step_number: nextStepNum, action_type: "AI_CALL", description: `คำสั่งติดตาม: ${followUpCommand}`, input_payload: { followUpCommand }, status: "PENDING" });
    await supabase.from("tasks").update({ status: "QUEUED", total_steps: nextStepNum, result_summary: null, completed_at: null, failure_reason: null }).eq("id", taskId);
    await logActivity(supabase, { taskId, eventType: "TASK_FOLLOW_UP", description: `เพิ่มคำสั่งติดตาม: ${String(followUpCommand).slice(0, 50)}` });
    return json({ success: true });
  }
  if (action === "control") {
    const { taskId, commandType } = body;
    const statusMap: Record<string, string> = { cancel: "CANCELED", pause: "PAUSED", resume: "QUEUED", retry: "QUEUED" };
    const nextStatus = statusMap[commandType];
    if (!nextStatus || !taskId) return json({ error: "Invalid command or taskId" }, 400);
    if (commandType === "retry") {
      const { error: resetError } = await supabase.from("task_steps").update({ status: "PENDING", error_message: null, started_at: null, completed_at: null }).eq("task_id", taskId).eq("status", "FAILED");
      if (resetError) throw resetError;
    }
    const updates: Record<string, unknown> = { status: nextStatus, lease_expires_at: null, lease_token: null };
    if (commandType === "retry") Object.assign(updates, { failure_reason: null, completed_at: null });
    const { error: controlError } = await supabase.from("tasks").update(updates).eq("id", taskId);
    if (controlError) throw controlError;
    await logActivity(supabase, { taskId, eventType: `TASK_${String(commandType).toUpperCase()}`, description: `ควบคุมงาน: ${commandType}` });
    return json({ success: true, status: nextStatus });
  }
  return json({ error: "Unknown action" }, 404);
};

// ---------------- ai-service ----------------
const aiService: Handler = async ({ req, action, body, supabase }) => {
  if (action === "providers") {
    const { data: providers } = await supabase.from("providers").select("*, provider_secrets(masked_key)").order("created_at", { ascending: true });
    const { data: models } = await supabase.from("models").select("*").order("priority", { ascending: true });
    const mapped = (providers || []).map((p: any) => {
      const { provider_secrets, ...rest } = p;
      const sec = Array.isArray(provider_secrets) ? provider_secrets[0] : provider_secrets;
      return { ...rest, maskedKey: sec?.masked_key || "••••", models: (models || []).filter((m: any) => m.provider_id === p.id) };
    });
    return json({ providers: mapped });
  }
  if (action === "save-provider") {
    const { id, name, type, baseUrl, apiKey, customHeaders, models } = body;
    if (!name?.trim() || !baseUrl || !/^https:\/\//i.test(baseUrl) || !["openai_compatible", "anthropic", "gemini", "custom"].includes(type)) return json({ error: "Valid name, HTTPS base URL and provider type are required" }, 400);
    let providerId = id;
    const rec = { name: String(name).trim().slice(0, 100), type, base_url: baseUrl.replace(/\/$/, ""), custom_headers: customHeaders || {} };
    if (id) {
      const { error } = await supabase.from("providers").update({ ...rec, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    } else {
      const { data: created, error } = await supabase.from("providers").insert(rec).select().single();
      if (error) throw error;
      providerId = created.id;
    }
    if (apiKey && apiKey.trim().length > 0) {
      const encrypted = await encryptSecret(apiKey);
      const { error } = await supabase.from("provider_secrets").upsert({ provider_id: providerId, ...encrypted, api_key: null, masked_key: "••••" + apiKey.slice(-4), updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    if (Array.isArray(models)) {
      for (const m of models) {
        if (!m.modelId?.trim()) continue;
        const mrec = { model_id: m.modelId.trim().slice(0, 200), display_name: (m.displayName || m.modelId).trim().slice(0, 120), capabilities: m.capabilities || { text: true, image: "unknown", tools: "unknown", long_context: "unknown" } };
        if (m.id) {
          const { error } = await supabase.from("models").update(mrec).eq("id", m.id).eq("provider_id", providerId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("models").insert({ provider_id: providerId, ...mrec });
          if (error) throw error;
        }
      }
    }
    await logActivity(supabase, { eventType: "PROVIDER_SAVED", description: `บันทึก Provider: ${rec.name}` });
    return json({ success: true, providerId });
  }
  if (action === "delete-model" && req.method === "POST") {
    if (!body.id) return json({ error: "model id required" }, 400);
    const { error } = await supabase.from("models").delete().eq("id", body.id);
    if (error) throw error;
    return json({ success: true });
  }
  if (action === "delete-provider" && req.method === "POST") {
    if (!body.id) return json({ error: "provider id required" }, 400);
    const { error } = await supabase.from("providers").delete().eq("id", body.id);
    if (error) throw error;
    return json({ success: true });
  }
  if (action === "reset-cooldown" && req.method === "POST") {
    if (!body.id) return json({ error: "model id required" }, 400);
    const { error } = await supabase.from("models").update({ in_cooldown: false, cooldown_until: null }).eq("id", body.id);
    if (error) throw error;
    return json({ success: true });
  }
  if (action === "router-settings" && req.method === "GET") {
    const { data, error } = await supabase.from("router_state").select("*").eq("id", "GLOBAL_ROUTER").single();
    if (error) throw error;
    return json({ router: data });
  }
  if (action === "router-settings" && req.method === "POST") {
    const { fallbackOrder, cooldownDurationSeconds } = body;
    if (!Array.isArray(fallbackOrder) || !Number.isInteger(cooldownDurationSeconds) || cooldownDurationSeconds < 30 || cooldownDurationSeconds > 86400) return json({ error: "Invalid router settings" }, 400);
    const { error } = await supabase.from("router_state").update({ fallback_order: fallbackOrder, cooldown_duration_seconds: cooldownDurationSeconds, updated_at: new Date().toISOString() }).eq("id", "GLOBAL_ROUTER");
    if (error) throw error;
    return json({ success: true });
  }
  if (action === "test-connection") {
    const { data: provider } = await supabase.from("providers").select("*, provider_secrets(api_key,encrypted_secret,encryption_iv)").eq("id", body.providerId).single();
    if (!provider) return json({ error: "Provider not found" }, 404);
    const sec = Array.isArray(provider.provider_secrets) ? provider.provider_secrets[0] : provider.provider_secrets;
    const apiKey = await decryptSecret(sec?.encrypted_secret || null, sec?.encryption_iv || null, sec?.api_key || null);
    const { success, latency, error: errorMsg = null } = await testProviderConnection(provider, apiKey);
    await supabase.from("providers").update({ last_test_result: success ? "SUCCESS" : "FAILED", last_test_latency_ms: latency, last_tested_at: new Date().toISOString() }).eq("id", body.providerId);
    return json({ success, latency, error: errorMsg });
  }
  if (action === "toggle") {
    const { target, id, enabled } = body;
    if (typeof enabled !== "boolean") return json({ error: "enabled must be boolean" }, 400);
    const NIL = "00000000-0000-0000-0000-000000000000";
    let result;
    if (target === "provider" && id) result = await supabase.from("providers").update({ is_enabled: enabled }).eq("id", id);
    else if (target === "model" && id) result = await supabase.from("models").update({ is_enabled: enabled }).eq("id", id);
    else if (target === "all_providers") result = await supabase.from("providers").update({ is_enabled: enabled }).neq("id", NIL);
    else if (target === "all_models") result = await supabase.from("models").update({ is_enabled: enabled }).neq("id", NIL);
    else return json({ error: "Invalid toggle target" }, 400);
    if (result.error) throw result.error;
    return json({ success: true });
  }
  return json({ error: "Unknown action" }, 404);
};

// ---------------- tools-storage-service ----------------
const toolsStorageService: Handler = async ({ req, action, body, supabase }) => {
  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  if (action === "list") {
    const { data: tools } = await supabase.from("tools").select("*, tool_secrets(masked_key)").order("created_at");
    const { data: storages } = await supabase.from("storage_connections").select("*, storage_secrets(masked_key)").order("created_at");
    return json({
      tools: (tools || []).map(({ tool_secrets, ...t }: any) => ({ ...t, maskedKey: one(tool_secrets)?.masked_key || "••••" })),
      storages: (storages || []).map(({ storage_secrets, ...s }: any) => ({ ...s, maskedKey: one(storage_secrets)?.masked_key || "••••" })),
    });
  }
  if (action === "save-tool" && req.method === "POST") {
    const { id, name, description, baseUrl, apiKey, authHeaderType, customHeaderName, sampleRequest, isEnabled } = body;
    if (!name?.trim() || !baseUrl || !/^https:\/\//i.test(baseUrl)) return json({ error: "name and HTTPS baseUrl are required" }, 400);
    const record = { name: String(name).trim().slice(0, 100), description: String(description || "").slice(0, 1000), base_url: baseUrl, auth_header_type: authHeaderType || "Bearer", custom_header_name: customHeaderName || null, sample_request: sampleRequest || null, is_enabled: isEnabled !== false, updated_at: new Date().toISOString() };
    let toolId = id;
    if (id) { const { error } = await supabase.from("tools").update(record).eq("id", id); if (error) throw error; }
    else { const { data, error } = await supabase.from("tools").insert(record).select("id").single(); if (error) throw error; toolId = data.id; }
    if (apiKey) { const enc = await encryptSecret(apiKey); const { error } = await supabase.from("tool_secrets").upsert({ tool_id: toolId, ...enc, api_key: null, masked_key: `••••${apiKey.slice(-4)}` }); if (error) throw error; }
    await logActivity(supabase, { toolId, eventType: "TOOL_SAVED", description: `บันทึกเครื่องมือ: ${record.name}` });
    return json({ success: true, id: toolId });
  }
  if (action === "save-storage" && req.method === "POST") {
    const { id, name, projectUrl, serviceRoleKey, isEnabled } = body;
    if (!name?.trim() || !/^https:\/\//i.test(projectUrl || "")) return json({ error: "name and HTTPS projectUrl are required" }, 400);
    const record = { name: String(name).trim().slice(0, 100), project_url: String(projectUrl).replace(/\/$/, ""), is_enabled: isEnabled !== false, updated_at: new Date().toISOString() };
    let storageId = id;
    if (id) { const { error } = await supabase.from("storage_connections").update(record).eq("id", id); if (error) throw error; }
    else { const { data, error } = await supabase.from("storage_connections").insert(record).select("id").single(); if (error) throw error; storageId = data.id; }
    if (serviceRoleKey) { const enc = await encryptSecret(serviceRoleKey); const { error } = await supabase.from("storage_secrets").upsert({ storage_id: storageId, ...enc, service_role_key: null, masked_key: `••••${serviceRoleKey.slice(-4)}` }); if (error) throw error; }
    await logActivity(supabase, { eventType: "STORAGE_SAVED", description: `บันทึก Storage: ${record.name}` });
    return json({ success: true, id: storageId });
  }
  if (action === "delete" && req.method === "POST") {
    const { type, id } = body;
    const table = type === "tool" ? "tools" : type === "storage" ? "storage_connections" : null;
    if (!table || !id) return json({ error: "type and id required" }, 400);
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
    return json({ success: true });
  }
  if (action === "test") {
    const { type, id } = body;
    if (type === "tool") {
      const { data: tool } = await supabase.from("tools").select("*, tool_secrets(api_key,encrypted_secret,encryption_iv)").eq("id", id).single();
      if (!tool) return json({ error: "Tool not found" }, 404);
      const sec = one(tool.tool_secrets);
      const apiKey = await decryptSecret(sec?.encrypted_secret || null, sec?.encryption_iv || null, sec?.api_key || null);
      const start = Date.now();
      let success = false;
      try {
        const headers = new Headers();
        if (apiKey) headers.set(tool.custom_header_name || "Authorization", tool.auth_header_type === "Bearer" ? `Bearer ${apiKey}` : apiKey);
        if (tool.sample_request) headers.set("Content-Type", "application/json");
        const res = await fetch(tool.base_url, { headers, method: tool.sample_request ? "POST" : "GET", ...(tool.sample_request ? { body: JSON.stringify(tool.sample_request) } : {}), signal: AbortSignal.timeout(5000) });
        success = res.ok || res.status === 404;
      } catch { success = false; }
      const latency = Date.now() - start;
      await supabase.from("tools").update({ last_test_result: success ? "SUCCESS" : "FAILED", last_test_latency_ms: latency, last_tested_at: new Date().toISOString() }).eq("id", id);
      return json({ success, latency });
    }
        if (type === "storage") {
      const { data: st } = await supabase
        .from("storage_connections")
        .select("*, storage_secrets(service_role_key, encrypted_secret, encryption_iv)")
        .eq("id", id)
        .single();

      if (!st) return json({ error: "Storage connection not found" }, 404);

      const sec = one(st.storage_secrets);
      let key = "";
      try {
        key = await decryptSecret(sec?.encrypted_secret || null, sec?.encryption_iv || null, sec?.service_role_key || null);
      } catch (err: any) {
        return json({ success: false, error: "ไม่สามารถถอดรหัสคีย์ได้ (ตรวจสอบการตั้งค่า Secret Encryption)" }, 400);
      }

      if (!key) {
        return json({ success: false, error: "ไม่พบคีย์ Service Role / Secret Key" }, 400);
      }

      const cleanUrl = String(st.project_url || "").trim().replace(/\/+$/, "");
      const start = Date.now();
      let success = false;
      let statusText = "";

      try {
        // รองรับทั้ง Legacy JWT service_role และ Supabase Secret API Key รูปแบบใหม่ (sb_secret_...)
        const headers: Record<string, string> = { apikey: key };
        if (!key.startsWith("sb_secret_")) {
          headers["Authorization"] = `Bearer ${key}`;
        }

        const res = await fetch(`${cleanUrl}/rest/v1/`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          success = true;
          statusText = "เชื่อมต่อสำเร็จ";
        } else {
          success = false;
          if (res.status === 401 || res.status === 403) {
            statusText = "API Key / Service Role Key ไม่ถูกต้องหรือไม่มีสิทธิ์";
          } else if (res.status === 404) {
            statusText = "ไม่พบ REST API ปลายทาง ตรวจสอบ Project URL";
          } else {
            statusText = `เซิร์ฟเวอร์ปลายทางตอบกลับข้อผิดพลาด (HTTP ${res.status})`;
          }
        }
      } catch (err: any) {
        success = false;
        statusText = err?.name === "TimeoutError" ? "หมดเวลาเชื่อมต่อ (Timeout 6s)" : "ไม่สามารถเข้าถึงเครือข่ายปลายทางได้";
      }

      const latency = Date.now() - start;
      await supabase.from("storage_connections").update({
        last_test_result: success ? "SUCCESS" : "FAILED",
        last_tested_at: new Date().toISOString(),
      }).eq("id", id);

      return json({ success, latency, message: statusText });
    }

      const { data: st } = await supabase.from("storage_connections").select("*, storage_secrets(service_role_key,encrypted_secret,encryption_iv)").eq("id", id).single();
      if (!st) return json({ error: "Storage connection not found" }, 404);
      const sec = one(st.storage_secrets);
      const key = await decryptSecret(sec?.encrypted_secret || null, sec?.encryption_iv || null, sec?.service_role_key || null);
      let success = false;
      try {
        const res = await fetch(`${st.project_url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
        success = res.ok;
      } catch { success = false; }
      await supabase.from("storage_connections").update({ last_test_result: success ? "SUCCESS" : "FAILED", last_tested_at: new Date().toISOString() }).eq("id", id);
      return json({ success });
    }
    return json({ error: "type must be tool or storage" }, 400);
  }
  if (action === "safety-snapshot") {
    const { storageId, tableName } = body;
    await logActivity(supabase, { eventType: "BACKUP_SNAPSHOT", description: `บันทึก Snapshot ความปลอดภัยสำหรับตาราง ${tableName} อัตโนมัติก่อนเริ่มคำสั่งทำลายโครงสร้าง`, details: { storageId, tableName, timestamp: new Date().toISOString() } });
    return json({ success: true, message: "Snapshot created" });
  }
  return json({ error: "Unknown action" }, 404);
};

// ---------------- schedules-service ----------------
const schedulesService: Handler = async ({ req, action, body, supabase }) => {
  if (action === "list") {
    const { data, error } = await supabase.from("schedules").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return json({ schedules: data || [] });
  }
  if (action === "save") {
    const { id, name, command, cronExpression, runOnceAt, timezone, isEnabled } = body;
    if (typeof name !== "string" || !name.trim() || typeof command !== "string" || !command.trim()) return json({ error: "name and command are required" }, 400);
    const tz = timezone || "Asia/Bangkok";
    let nextRunAt: string | null = null;
    if (cronExpression) {
      nextRunAt = nextCronRun(String(cronExpression), tz, new Date());
      if (!nextRunAt) return json({ error: "cron expression or timezone is invalid" }, 400);
    } else if (runOnceAt) {
      const parsed = new Date(runOnceAt);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return json({ error: "runOnceAt must be a future date" }, 400);
      nextRunAt = parsed.toISOString();
    } else return json({ error: "Provide cronExpression or runOnceAt" }, 400);
    const record = { name: name.trim().slice(0, 120), command: command.trim().slice(0, 4000), cron_expression: cronExpression || null, run_once_at: runOnceAt ? new Date(runOnceAt).toISOString() : null, timezone: tz, is_enabled: isEnabled !== false, next_run_at: nextRunAt };
    if (id) { const { error } = await supabase.from("schedules").update({ ...record, updated_at: new Date().toISOString() }).eq("id", id); if (error) throw error; }
    else { const { error } = await supabase.from("schedules").insert(record); if (error) throw error; }
    return json({ success: true });
  }
  if (action === "toggle" && req.method === "POST") {
    if (!body.id || typeof body.enabled !== "boolean") return json({ error: "id and enabled required" }, 400);
    const { error } = await supabase.from("schedules").update({ is_enabled: body.enabled, updated_at: new Date().toISOString() }).eq("id", body.id);
    if (error) throw error;
    return json({ success: true });
  }
  if (action === "delete" && req.method === "POST") {
    if (!body.id) return json({ error: "id required" }, 400);
    const { error } = await supabase.from("schedules").delete().eq("id", body.id);
    if (error) throw error;
    return json({ success: true });
  }
  return json({ error: "Unknown action" }, 404);
};

// ---------------- notifications-service ----------------
const notificationsService: Handler = async ({ req, action, body, supabase }) => {
  if (action === "list" && req.method === "GET") {
    const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return json({ notifications: data || [] });
  }
  if (action === "unread-count") {
    const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false);
    return json({ count: count || 0 });
  }
  if (action === "mark-read" && req.method === "POST") {
    if (body.id) { const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", body.id); if (error) throw error; }
    else if (body.all === true) { const { error } = await supabase.from("notifications").update({ is_read: true }).eq("is_read", false); if (error) throw error; }
    else return json({ error: "id or all=true required" }, 400);
    return json({ success: true });
  }
  return json({ error: "Unknown action" }, 404);
};

// ---------------- settings-service ----------------
const settingsService: Handler = async ({ req, action, body, supabase }) => {
  if (action === "create-api-token" && req.method === "POST") {
    const name = String(body.name || "Remote API").trim().slice(0, 80);
    if (!name) return json({ error: "กรุณาระบุชื่อโทเค็น" }, 400);
    const rawToken = `aih_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const { data, error } = await supabase.from("api_tokens").insert({ name, token_hash: await hashString(rawToken), token_prefix: rawToken.slice(0, 12), is_active: true }).select("id,name,token_prefix,created_at").single();
    if (error) throw error;
    await logActivity(supabase, { eventType: "API_TOKEN_CREATED", description: `สร้างโทเค็น Remote API: ${name}` });
    return json({ token: rawToken, apiToken: data });
  }
  if (action === "api-tokens" && req.method === "GET") {
    const { data, error } = await supabase.from("api_tokens").select("id,name,token_prefix,is_active,last_used_at,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    return json({ apiTokens: data || [] });
  }
  if (action === "revoke-api-token" && req.method === "POST") {
    const id = String(body.id || "");
    if (!id) return json({ error: "id required" }, 400);
    const { error } = await supabase.from("api_tokens").update({ is_active: false }).eq("id", id);
    if (error) throw error;
    await logActivity(supabase, { eventType: "API_TOKEN_REVOKED", description: "เพิกถอนโทเค็น Remote API" });
    return json({ success: true });
  }
  if (action === "master-pause") {
    if (typeof body.paused !== "boolean") return json({ error: "paused must be boolean" }, 400);
    await supabase.from("settings").update({ master_pause: body.paused, updated_at: new Date().toISOString() }).eq("id", "SYSTEM_CONFIG");
    await logActivity(supabase, { eventType: body.paused ? "MASTER_PAUSE_ON" : "MASTER_PAUSE_OFF", description: body.paused ? "หยุดการประมวลผลทั้งหมด" : "เปิดการประมวลผลอีกครั้ง" });
    return json({ success: true, paused: body.paused });
  }
  if (action === "system" && req.method === "GET") {
    const { data } = await supabase.from("settings").select("master_pause,max_steps_per_task").eq("id", "SYSTEM_CONFIG").single();
    return json({ settings: data });
  }
  if (action === "max-steps" && req.method === "POST") {
    const n = Number(body.maxSteps);
    if (!Number.isInteger(n) || n < 1 || n > 200) return json({ error: "maxSteps must be 1–200" }, 400);
    await supabase.from("settings").update({ max_steps_per_task: n, updated_at: new Date().toISOString() }).eq("id", "SYSTEM_CONFIG");
    return json({ success: true });
  }
  return json({ error: "Unknown action" }, 404);
};

// ---------------- remote-api (Bearer API token) ----------------
const remoteApi = async (req: Request, action: string, body: any, url: URL, supabase: any): Promise<Response> => {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing authorization token" }, 401);
  const { data: apiToken } = await supabase.from("api_tokens").select("*").eq("token_hash", await hashString(token)).eq("is_active", true).maybeSingle();
  if (!apiToken) return json({ error: "Invalid API token" }, 401);
  await supabase.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", apiToken.id);
  if (req.method === "POST" && action === "submit-task") {
    const { command, idempotency_key } = body;
    if (typeof command !== "string" || !command.trim() || command.length > 4000) return json({ error: "Command is required" }, 400);
    const iKey = idempotency_key || crypto.randomUUID();
    const { data: task, error } = await supabase.from("tasks").insert({ idempotency_key: iKey, goal: command.trim(), status: "QUEUED" }).select().single();
    if (error && error.code === "23505") {
      const { data: existing } = await supabase.from("tasks").select().eq("idempotency_key", iKey).single();
      return json({ task_id: existing.id, status: existing.status });
    }
    if (error) throw error;
    await logActivity(supabase, { taskId: task.id, eventType: "TASK_QUEUED", description: `สร้างงานผ่าน Remote API: ${command.slice(0, 50)}` });
    return json({ task_id: task.id, status: task.status });
  }
  if (req.method === "GET" && action === "task-status") {
    const taskId = url.searchParams.get("id");
    if (!taskId) return json({ error: "id parameter required" }, 400);
    const { data: task } = await supabase.from("tasks").select("id, status, goal, result_summary, failure_reason, completed_at").eq("id", taskId).maybeSingle();
    if (!task) return json({ error: "Task not found" }, 404);
    return json(task);
  }
  return json({ error: "Endpoint not found" }, 404);
};

const sessionServices: Record<string, Handler> = {
  "dashboard-summary": dashboardSummary,
  "tasks-service": tasksService,
  "ai-service": aiService,
  "tools-storage-service": toolsStorageService,
  "schedules-service": schedulesService,
  "notifications-service": notificationsService,
  "settings-service": settingsService,
};

export async function dispatchHub(req: Request, splat: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
  try {
    const parts = splat.split("/").filter(Boolean);
    const service = parts[0] || "";
    const action = parts[parts.length - 1] || "";
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const supabase = await getServiceClient();
    if (service === "auth-service") return await authService({ req, action, body, url, supabase });
    if (service === "remote-api") return await remoteApi(req, action, body, url, supabase);
    const handler = sessionServices[service];
    if (!handler) return json({ error: "Unknown service" }, 404);
    const auth = await validateSession(req);
    if (!auth.valid) return json({ error: auth.error }, 401);
    return await handler({ req, action, body, url, supabase });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message || String(err) }, 500);
  }
}
