import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

function requireTenant(session: Session | null) {
  if (!session?.user) return { error: "Unauthorized", status: 401 as const };
  if ((session.user as any).role !== "tenant") return { error: "Forbidden", status: 403 as const };
  return { tenantId: (session.user as any).id as string };
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const auth = requireTenant(session);

  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  const now = new Date();

  if (action === "read_all") {
    await prisma.notification.updateMany({
      where: {
        tenantId: auth.tenantId,
        dismissedAt: null,
        readAt: null,
      },
      data: { readAt: now },
    });

    return Response.json({ ok: true });
  }

  if (!ids.length) {
    return Response.json({ error: "ids are required for this action." }, { status: 400 });
  }

  if (action === "read") {
    await prisma.notification.updateMany({
      where: {
        tenantId: auth.tenantId,
        id: { in: ids },
      },
      data: { readAt: now },
    });

    return Response.json({ ok: true });
  }

  if (action === "dismiss") {
    await prisma.notification.updateMany({
      where: {
        tenantId: auth.tenantId,
        id: { in: ids },
      },
      data: {
        readAt: now,
        dismissedAt: now,
      },
    });

    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unsupported notification action." }, { status: 400 });
}
