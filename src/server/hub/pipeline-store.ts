// Database-backed PipelineStore for R19–R22 (service client; tables are deny-all for anon/authenticated).
import type { PipelineStore } from "./chat-pipeline";
import { pickBestModel } from "./router-core";

export function createPipelineStore(supabase: any): PipelineStore {
  return {
    currentModelId: async (prompt) => (await pickBestModel("text", [], prompt)).model.model_id,
    getCache: async (hash, modelId) => {
      const { data } = await supabase.from("prompt_cache").select("response,model_display_name,original_cost,expires_at")
        .eq("prompt_hash", hash).eq("model_id", modelId).gt("expires_at", new Date().toISOString()).maybeSingle();
      return data ? { response: data.response, model_display_name: data.model_display_name, original_cost: Number(data.original_cost) || 0 } : null;
    },
    recordHit: async (hash, modelId, costSaved) => {
      const { data } = await supabase.from("prompt_cache").select("id,hit_count,cost_saved").eq("prompt_hash", hash).eq("model_id", modelId).maybeSingle();
      if (data) await supabase.from("prompt_cache").update({ hit_count: data.hit_count + 1, cost_saved: Number(data.cost_saved) + costSaved }).eq("id", data.id);
    },
    putCache: async (hash, modelId, entry, expiresAt) => {
      await supabase.from("prompt_cache").upsert({ prompt_hash: hash, model_id: modelId, response: entry.response, model_display_name: entry.model_display_name, original_cost: entry.original_cost, hit_count: 0, cost_saved: 0, expires_at: expiresAt.toISOString(), created_at: new Date().toISOString() }, { onConflict: "prompt_hash,model_id" });
    },
    getSnippet: async (command) => {
      const { data } = await supabase.from("ai_snippets").select("command,template,system_instruction").eq("command", command).eq("is_enabled", true).maybeSingle();
      return data || null;
    },
    listMemories: async () => {
      const { data } = await supabase.from("user_memories").select("content").eq("is_enabled", true).order("created_at", { ascending: true }).limit(50);
      return (data || []).map((m: any) => m.content);
    },
    addMemory: async (content) => { await supabase.from("user_memories").insert({ content, source: "chat" }); },
    getSummary: async (id) => {
      const { data } = await supabase.from("chat_summaries").select("summary,turns_covered").eq("conversation_id", id).maybeSingle();
      return data || null;
    },
    saveSummary: async (id, summary, turns) => {
      await supabase.from("chat_summaries").upsert({ conversation_id: id, summary, turns_covered: turns, updated_at: new Date().toISOString() });
    },
  };
}
