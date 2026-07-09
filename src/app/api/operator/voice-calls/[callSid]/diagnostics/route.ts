import { fetchAiCore, readAiCoreJson } from "@/lib/ai-core";
import { requireTenantSession } from "@/lib/tenant-auth";

export const dynamic = "force-dynamic";

function belongsToTenant(data: any, tenantSlug: string) {
  const candidates = [
    data?.tenant_slug,
    data?.session_summary?.tenant_slug,
    data?.latest_turn_diagnostic?.tenant_slug,
    ...(Array.isArray(data?.turn_diagnostics)
      ? data.turn_diagnostics.map((turn: any) => turn?.tenant_slug)
      : []),
  ].filter(Boolean);

  return candidates.length === 0 || candidates.some((candidate) => candidate === tenantSlug);
}

export async function GET(_: Request, { params }: { params: Promise<{ callSid: string }> }) {
  const auth = await requireTenantSession();
  if ("error" in auth) return auth.error;

  const { callSid } = await params;
  if (!callSid) {
    return Response.json({ error: "Call SID is required." }, { status: 400 });
  }

  const response = await fetchAiCore(`/api/v1/call/${encodeURIComponent(callSid)}/diagnostics`);
  const data = await readAiCoreJson(response);

  if (!response.ok) {
    return Response.json(
      { error: data?.error || data?.detail || `AI Core returned HTTP ${response.status}` },
      { status: 502 }
    );
  }

  if (!belongsToTenant(data, auth.tenantSlug)) {
    return Response.json({ error: "Call diagnostics not found." }, { status: 404 });
  }

  return Response.json(data);
}
