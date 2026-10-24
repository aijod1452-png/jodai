// Background jobs: task-worker and scheduler-runner (ported from supabase/functions).
import { getServiceClient, logActivity, nextCronRun, decryptSecret } from "./core";
import { pickBestModel, callAIModel, putModelInCooldown, isFallbackError } from "./router-core";
import { executeToolCall, buildStepToolPayload } from "./tool-connection";
import { getRequestUrl } from "@tanstack/react-start/server";

/** R2: try models in fallback order inside the same step; 402/429 → cooldown and continue. */
async function callWithFallback(prompt: string, systemPrompt?: string) {
  const tried: string[] = [];
  for (;;) {
    const router = await pickBestModel("text", tried);
    try {
      const result = await callAIModel(router.provider, router.model, router.apiKey, prompt, systemPrompt);
      return { router, result, tried };
    } catch (err: any) {
      if (!isFallbackError(err)) { (err as any).modelId = router.model.id; throw err; }
      tried.push(router.model.id);
      await putModelInCooldown(router.model.id, err.message);
    }
  }
}

/** R4: run worker ticks until idle, paused, or the budget is used. */
export async function runWorkerDrain(opts: { maxIterations?: number; timeBudgetMs?: number } = {}) {
  const max = opts.maxIterations ?? 10, budget = opts.timeBudgetMs ?? 40000, start = Date.now();
  const results: any[] = [];
  for (let i = 0; i < max && Date.now() - start < budget; i++) {
    const r = await runWorkerTick();
    results.push(r);
    if (r?.message === "No task available" || r?.status === "PAUSED") break;
  }
  return { iterations: results.length, results };
}

function extractJsonArray(text: string): any[] | null {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : null; } catch { /* fallthrough */ }
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : null; } catch { return null; } }
  return null;
}

export async function runWorkerTick(): Promise<any> {
  const supabase = await getServiceClient();
  const { data: settings } = await supabase.from("settings").select("master_pause,max_steps_per_task").eq("id", "SYSTEM_CONFIG").single();
  // Health heartbeat for the dashboard status pill.
  await supabase.from("health_checks").insert({ status: "HEALTHY", details: { source: "task-worker" } });
  await supabase.from("health_checks").delete().lt("checked_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if (settings?.master_pause) return { status: "PAUSED" };
  const maxSteps = settings?.max_steps_per_task || 30;

  const { data: claimedRows, error: claimError } = await supabase.rpc("claim_next_task", { lease_seconds: 120 });
  if (claimError) throw claimError;
  const task = claimedRows?.[0];
  if (!task) return { message: "No task available" };
  const release = (updates: Record<string, unknown>) =>
    supabase.from("tasks").update({ ...updates, lease_expires_at: null, lease_token: null }).eq("id", task.id).eq("lease_token", task.lease_token).eq("status", "RUNNING");

  const { data: steps0, error: stepsError } = await supabase.from("task_steps").select("*").eq("task_id", task.id).order("step_number", { ascending: true });
  if (stepsError) throw stepsError;
  const steps: any[] = steps0 || [];

  if (steps.length === 0) {
    try {
      const { data: tools } = await supabase.from("tools").select("id,name,description,sample_request").eq("is_enabled", true);
      const toolIds = new Set((tools || []).map((t: any) => t.id));
      const toolList = (tools || []).map((t: any) => `- id=${t.id} ชื่อ=${t.name} คำอธิบาย=${t.description} payload ตัวอย่าง=${JSON.stringify(t.sample_request ?? {})}`).join("\n");
      const { router, result: plan } = await callWithFallback(
        `แบ่งคำสั่งนี้เป็นขั้นตอนที่ทำได้จริงและตอบเป็น JSON array ของ {description, expected_output, tool_id?, payload?} ใส่ tool_id และ payload เฉพาะขั้นที่ต้องเรียกเครื่องมือ\nเครื่องมือที่มี:\n${toolList || "- ไม่มี"}\nคำสั่ง: ${task.goal}`,
        "คุณคือ Task Planner; ตอบกลับเป็น JSON เท่านั้น ห้ามดำเนินการแทนขั้นตอน");
      let planItems = extractJsonArray(plan.text) || [];
      if (planItems.length === 0) planItems = [{ description: task.goal, expected_output: "ผลลัพธ์ของงาน" }];
      if (planItems.length > maxSteps) planItems = planItems.slice(0, maxSteps);
      const rows = planItems.map((s: any, i: number) => {
        const isTool = typeof s?.tool_id === "string" && toolIds.has(s.tool_id);
        return {
          task_id: task.id, step_number: i + 1, action_type: isTool ? "TOOL_CALL" : "AI_CALL", target_id: isTool ? s.tool_id : router.model.id,
          description: String(s?.description || `ขั้นตอน ${i + 1}`), expected_output: String(s?.expected_output || "ผลลัพธ์"),
          input_payload: isTool ? { goal: task.goal, toolPayload: s.payload ?? {} } : { goal: task.goal, plan: planItems }, status: "PENDING",
        };
      });
      const { error: insertError } = await supabase.from("task_steps").insert(rows);
      if (insertError) throw insertError;
      await supabase.from("tasks").update({ total_steps: rows.length, selected_model_id: router.model.id, model_selection_reason: router.selectionReason }).eq("id", task.id);
      await supabase.from("usage_records").insert({ provider_id: router.provider.id, model_id: router.model.model_id, task_id: task.id, prompt_tokens: plan.promptTokens, completion_tokens: plan.completionTokens, cost: plan.cost, is_estimated: plan.isEstimated });
      await logActivity(supabase, { taskId: task.id, eventType: "TASK_PLANNED", description: `สร้างแผน ${rows.length} ขั้นตอนสำหรับงาน`, modelId: router.model.model_id });
      await release({ status: "QUEUED" });
      return { status: "PLANNED", taskId: task.id, steps: rows.length };
    } catch (planErr: any) {
      await release({ status: "FAILED", failure_reason: planErr.message, completed_at: new Date().toISOString() });
      await supabase.from("notifications").insert({ title: "วางแผนงานล้มเหลว", message: String(planErr.message).slice(0, 200), type: "TASK_FAILED", reference_id: task.id });
      await logActivity(supabase, { taskId: task.id, eventType: "TASK_FAILED", description: `วางแผนล้มเหลว: ${planErr.message}` });
      return { status: "FAILED", error: planErr.message };
    }
  }

  if (steps.length > maxSteps) {
    await release({ status: "FAILED", failure_reason: `เกินขีดจำกัด ${maxSteps} ขั้นตอน`, completed_at: new Date().toISOString() });
    await supabase.from("notifications").insert({ title: "งานเกินขีดจำกัด", message: task.goal.slice(0, 100), type: "TASK_FAILED", reference_id: task.id });
    return { status: "FAILED", reason: "Runaway guard" };
  }

  const nextStep = steps.find((s) => s.status === "PENDING");
  if (!nextStep) {
    if (steps.some((s) => s.status === "FAILED")) {
      await release({ status: "FAILED", failure_reason: "มีขั้นตอนที่ล้มเหลว", completed_at: new Date().toISOString() });
      return { status: "FAILED" };
    }
    const summary = steps[steps.length - 1]?.output_payload?.summary || "งานดำเนินการเสร็จสิ้น";
    await release({ status: "SUCCEEDED", result_summary: summary, completed_at: new Date().toISOString() });
    await supabase.from("notifications").insert({ title: "งานเสร็จสมบูรณ์", message: task.goal.slice(0, 100), type: "TASK_SUCCEEDED", reference_id: task.id });
    await logActivity(supabase, { taskId: task.id, eventType: "TASK_SUCCEEDED", description: "งานเสร็จสมบูรณ์" });
    return { status: "SUCCEEDED", taskId: task.id };
  }

  await supabase.from("task_steps").update({ status: "RUNNING", attempts: (nextStep.attempts || 0) + 1, started_at: new Date().toISOString() }).eq("id", nextStep.id);
  await supabase.from("tasks").update({ current_step: nextStep.step_number }).eq("id", task.id).eq("lease_token", task.lease_token);

  const failStep = async (message: string) => {
    await supabase.from("task_steps").update({ status: "FAILED", error_message: message, completed_at: new Date().toISOString() }).eq("id", nextStep.id);
    await release({ status: "FAILED", failure_reason: message });
    await supabase.from("notifications").insert({ title: "งานล้มเหลว", message: String(message).slice(0, 200), type: "TASK_FAILED", reference_id: task.id });
    await logActivity(supabase, { taskId: task.id, eventType: "TASK_FAILED", description: `ขั้นที่ ${nextStep.step_number} ล้มเหลว: ${String(message).slice(0, 200)}` });
    return { status: "FAILED", error: message };
  };

  if (nextStep.action_type === "TOOL_CALL") {
    // R1: real tool execution with the real HTTP status.
    try {
      const { data: tool } = await supabase.from("tools").select("*, tool_secrets(api_key,encrypted_secret,encryption_iv)").eq("id", nextStep.target_id).maybeSingle();
      if (!tool) return await failStep("ไม่พบเครื่องมือที่ขั้นตอนนี้อ้างถึง");
      if (!tool.is_enabled) return await failStep(`เครื่องมือ ${tool.name} ถูกปิดใช้งาน`);
      const sec = Array.isArray(tool.tool_secrets) ? tool.tool_secrets[0] : tool.tool_secrets;
      const apiKey = sec ? await decryptSecret(sec.encrypted_secret || null, sec.encryption_iv || null, sec.api_key || null) : "";
      const payload = buildStepToolPayload(nextStep.input_payload?.toolPayload, steps, nextStep.step_number);
      const call = await executeToolCall(tool, apiKey, payload, fetch, getRequestUrl().origin);
      const output = { summary: call.body.slice(0, 4000), responseBody: call.body, tool: tool.name, httpStatus: call.status, latencyMs: call.latency, error: call.error ?? null };
      await logActivity(supabase, { taskId: task.id, eventType: "TOOL_CALL", description: `เรียก ${tool.name} → ${call.status === null ? call.error : `HTTP ${call.status}`}`, details: { stepNumber: nextStep.step_number, httpStatus: call.status, latencyMs: call.latency } });
      if (!call.success) {
        await supabase.from("task_steps").update({ output_payload: output }).eq("id", nextStep.id);
        return await failStep(call.status === null ? `เรียกเครื่องมือ ${tool.name} ไม่ได้ (${call.error})` : `เครื่องมือ ${tool.name} ตอบ HTTP ${call.status}`);
      }
      await supabase.from("task_steps").update({ status: "SUCCEEDED", output_payload: output, checkpoint_state: { completedAt: new Date().toISOString() }, completed_at: new Date().toISOString(), error_message: null }).eq("id", nextStep.id);
      await release({ status: "QUEUED" });
      return { status: "STEP_COMPLETED", taskId: task.id, stepNumber: nextStep.step_number, httpStatus: call.status };
    } catch (toolErr: any) {
      return await failStep(toolErr.message);
    }
  }

  try {
    const previous = steps.filter((s) => s.status === "SUCCEEDED").map((s) => `ขั้นที่ ${s.step_number}: ${String(s.output_payload?.summary || "").slice(0, 800)}`).join("\n");
    const prompt = `เป้าหมายของงาน: ${task.goal}\nผลลัพธ์ขั้นก่อนหน้า:\n${previous || "-"}\nขั้นตอนที่ต้องทำ: ${nextStep.description}\nผลลัพธ์ที่คาดหวัง: ${nextStep.expected_output || ""}\nคำสั่งติดตาม: ${nextStep.input_payload?.followUpCommand || ""}`;
    const { router, result, tried } = await callWithFallback(prompt);
    await supabase.from("task_steps").update({ status: "SUCCEEDED", output_payload: { summary: result.text, model: router.model.display_name, fallbackFrom: tried }, checkpoint_state: { completedAt: new Date().toISOString() }, completed_at: new Date().toISOString(), error_message: null }).eq("id", nextStep.id);
    await release({ status: "QUEUED" });
    await supabase.from("usage_records").insert({ provider_id: router.provider.id, model_id: router.model.model_id, task_id: task.id, prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens, cost: result.cost, is_estimated: result.isEstimated });
    await logActivity(supabase, { taskId: task.id, eventType: "STEP_EXECUTE", description: `ดำเนินขั้นที่ ${nextStep.step_number} แล้ว${tried.length ? ` (สลับโมเดล ${tried.length} ครั้ง)` : ""}`, modelId: router.model.model_id });
    return { status: "STEP_COMPLETED", taskId: task.id, stepNumber: nextStep.step_number };
  } catch (stepError: any) {
    return await failStep(stepError.message);
  }
}

export async function runSchedulerTick(): Promise<any> {
  const supabase = await getServiceClient();
  const now = new Date();
  const { data: due, error } = await supabase.from("schedules").select("*").eq("is_enabled", true).not("next_run_at", "is", null).lte("next_run_at", now.toISOString()).limit(50);
  if (error) throw error;
  const results: any[] = [];
  for (const schedule of due || []) {
    const dueAt = schedule.next_run_at;
    const next = schedule.cron_expression ? nextCronRun(schedule.cron_expression, schedule.timezone || "UTC", new Date(Math.max(new Date(dueAt).getTime(), now.getTime()))) : null;
    const { data: claimed, error: updateError } = await supabase.from("schedules").update({ next_run_at: next, is_enabled: schedule.cron_expression ? schedule.is_enabled : false, last_run_at: now.toISOString(), last_run_status: "QUEUED", updated_at: now.toISOString() }).eq("id", schedule.id).eq("next_run_at", dueAt).select("id").maybeSingle();
    if (updateError || !claimed) { results.push({ scheduleId: schedule.id, status: "skipped" }); continue; }
    const idempotencyKey = `schedule:${schedule.id}:${new Date(dueAt).toISOString()}`;
    const { data: task, error: taskError } = await supabase.from("tasks").upsert({ idempotency_key: idempotencyKey, goal: schedule.command, status: "QUEUED" }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (taskError) {
      await supabase.from("schedules").update({ last_run_status: "FAILED" }).eq("id", schedule.id);
      await supabase.from("schedule_runs").insert({ schedule_id: schedule.id, status: "FAILED", error_message: taskError.message });
      results.push({ scheduleId: schedule.id, status: "failed" });
      continue;
    }
    let taskId = task?.id;
    if (!taskId) { const { data: existing } = await supabase.from("tasks").select("id").eq("idempotency_key", idempotencyKey).maybeSingle(); taskId = existing?.id; }
    await supabase.from("schedule_runs").insert({ schedule_id: schedule.id, task_id: taskId || null, status: "QUEUED" });
    await logActivity(supabase, { taskId: taskId || null, eventType: "SCHEDULE_TRIGGERED", description: `เริ่มงานตามกำหนดการ: ${schedule.name}`, details: { scheduleId: schedule.id, dueAt } });
    results.push({ scheduleId: schedule.id, taskId, status: "queued" });
  }
  return { processed: results.length, results };
}
