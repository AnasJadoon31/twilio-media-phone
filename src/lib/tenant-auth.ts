import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function requireTenantSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if ((session.user as any).role !== "tenant") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return {
    tenantId: (session.user as any).id as string,
    tenantSlug: ((session.user as any).slug || "") as string,
    tenantName: session.user.name || "Tenant",
  };
}
