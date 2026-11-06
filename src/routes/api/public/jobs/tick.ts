import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled every minute: run due schedules, then advance the task queue.
export const Route = createFileRoute("/api/public/jobs/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { runSchedulerTick, runWorkerDrain } = await import("@/server/hub/jobs");
        try {
          const scheduler = await runSchedulerTick();
          const worker = await runWorkerDrain({ maxIterations: 10, timeBudgetMs: 40000 });
          // R34: each provider is probed at most once per 5 minutes via a free list-models call.
          const { runHeartbeatNow } = await import("@/server/hub/services");
          const health = await runHeartbeatNow(false).catch(() => ({ error: "health check failed" }));
          return Response.json({ scheduler, worker, health });
        } catch (err: any) {
          console.error(err);
          return Response.json({ error: err?.message || String(err) }, { status: 500 });
        }
      },
    },
  },
});
