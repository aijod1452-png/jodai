import { createFileRoute } from "@tanstack/react-router";

// AI Hub API gateway. Each request is authenticated inside dispatchHub:
// PIN session token (x-session-token) for app services, Bearer API token for remote-api,
// and only auth-service status/setup/verify are reachable without a session.
async function handle({ request, params }: { request: Request; params: { _splat?: string } }) {
  const { dispatchHub } = await import("@/server/hub/services");
  return dispatchHub(request, params._splat || "");
}

export const Route = createFileRoute("/api/public/hub/$")({
  server: { handlers: { GET: handle, POST: handle, OPTIONS: handle } },
});
