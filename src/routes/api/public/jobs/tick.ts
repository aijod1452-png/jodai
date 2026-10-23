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
          return Response.json({ scheduler, worker });
        } catch (err: any) {
          console.error(err);
          return Response.json({ error: err?.message || String(err) }, { status: 500 });
        }
      },
    },
  },
});
