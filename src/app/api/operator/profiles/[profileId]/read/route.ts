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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const session = await getServerSession(authOptions);
  const auth = requireTenant(session);

  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const { profileId } = await params;
  const body = await req.json().catch(() => ({}));
  const channelType = typeof body.channelType === "string" && body.channelType !== "all" ? body.channelType : null;
  const now = new Date();

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId: auth.tenantId,
      profileId,
      ...(channelType ? { channelType } : {}),
    },
    select: { id: true },
  });

  if (contacts.length === 0) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  const contactIds = contacts.map((contact) => contact.id);

  await prisma.$transaction([
    prisma.contact.updateMany({
      where: {
        tenantId: auth.tenantId,
        id: { in: contactIds },
      },
      data: { lastReadAt: now },
    }),
    prisma.notification.updateMany({
      where: {
        tenantId: auth.tenantId,
        dismissedAt: null,
        OR: [
          { profileId },
          { contactId: { in: contactIds } },
        ],
      },
      data: { readAt: now },
    }),
  ]);

  return Response.json({ ok: true, readAt: now.toISOString() });
}
