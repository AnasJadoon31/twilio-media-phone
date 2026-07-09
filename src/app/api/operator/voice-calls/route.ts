import { fetchAiCore, readAiCoreJson } from "@/lib/ai-core";
import { requireTenantSession } from "@/lib/tenant-auth";

export const dynamic = "force-dynamic";

function boundedInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(req: Request) {
  const auth = await requireTenantSession();
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const limit = boundedInt(url.searchParams.get("limit"), 50, 100);
  const offset = boundedInt(url.searchParams.get("offset"), 0, 10_000);

  const response = await fetchAiCore(`/api/v1/calls?limit=${limit}&offset=${offset}`);
  const data = await readAiCoreJson(response);

  if (!response.ok) {
    return Response.json(
      { error: data?.error || data?.detail || `AI Core returned HTTP ${response.status}` },
      { status: 502 }
    );
  }

  const calls = Array.isArray(data) ? data : [];
  const tenantCalls = calls.filter((call) => call?.tenant_slug === auth.tenantSlug);
  return Response.json(tenantCalls);
}
