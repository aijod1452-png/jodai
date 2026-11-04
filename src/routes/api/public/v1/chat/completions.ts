import { createFileRoute } from "@tanstack/react-router";

// R23 OpenAI-compatible endpoint. Every request is authenticated inside the handler with an active api_tokens Bearer token.
async function handle({ request }: { request: Request }) {
  const { handleChatCompletions } = await import("@/server/hub/openai-gateway");
  const { getServiceClient, hashString, logActivity } = await import("@/server/hub/core");
  const { callWithFallback } = await import("@/server/hub/jobs");
  const supabase = await getServiceClient();
  return handleChatCompletions(request, {
    verifyToken: async (raw) => {
      const { data } = await supabase.from("api_tokens").select("id").eq("token_hash", await hashString(raw)).eq("is_active", true).maybeSingle();
      if (!data) return false;
      await supabase.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
      return true;
    },
    callModel: callWithFallback,
    recordUsage: async ({ router, result }) => {
      await supabase.from("usage_records").insert({ provider_id: router.provider.id, model_id: router.model.model_id, task_id: null, prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens, cost: result.cost, is_estimated: result.isEstimated });
      await logActivity(supabase, { eventType: "GATEWAY_COMPLETION", description: "OpenAI gateway completion", details: { promptTokens: result.promptTokens, completionTokens: result.completionTokens }, modelId: router.model.model_id });
    },
  });
}

export const Route = createFileRoute("/api/public/v1/chat/completions")({
  server: { handlers: { POST: handle, OPTIONS: handle } },
});
