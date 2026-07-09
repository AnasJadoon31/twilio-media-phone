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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const auth = requireTenant(session);

  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const contactIds = Array.isArray(body.contactIds) ? body.contactIds.filter(Boolean) : [];
  const profileIds = Array.isArray(body.profileIds) ? body.profileIds.filter(Boolean) : [];

  if (contactIds.length + profileIds.length < 2) {
    return Response.json({ error: "Select at least two contacts or profiles to merge." }, { status: 400 });
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId: auth.tenantId,
      OR: [
        contactIds.length ? { id: { in: contactIds } } : undefined,
        profileIds.length ? { profileId: { in: profileIds } } : undefined,
      ].filter(Boolean) as any,
    },
    include: { profile: true },
    orderBy: { createdAt: "asc" },
  });

  const uniqueContacts = Array.from(new Map(contacts.map((contact) => [contact.id, contact])).values());
  const oldProfileIds = Array.from(new Set(uniqueContacts.map((contact) => contact.profileId)));

  if (uniqueContacts.length < 2 || oldProfileIds.length < 2) {
    return Response.json({ error: "Select contacts from at least two profiles to merge." }, { status: 400 });
  }

  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim()
      : uniqueContacts.find((contact) => contact.profile.displayName)?.profile.displayName ||
        uniqueContacts.find((contact) => contact.displayName)?.displayName ||
        uniqueContacts[0].externalId;

  const mergedProfile = await prisma.$transaction(async (tx) => {
    const profile = await tx.contactProfile.create({
      data: {
        tenantId: auth.tenantId,
        displayName,
      },
    });

    const selectedContactIds = uniqueContacts.map((contact) => contact.id);

    await tx.contact.updateMany({
      where: {
        tenantId: auth.tenantId,
        id: { in: selectedContactIds },
      },
      data: {
        profileId: profile.id,
      },
    });

    await tx.notification.updateMany({
      where: {
        tenantId: auth.tenantId,
        OR: [
          { profileId: { in: oldProfileIds } },
          { contactId: { in: selectedContactIds } },
        ],
      },
      data: {
        profileId: profile.id,
      },
    });

    await tx.contactProfile.deleteMany({
      where: {
        tenantId: auth.tenantId,
        id: { in: oldProfileIds },
        contacts: { none: {} },
      },
    });

    return profile;
  });

  return Response.json({ ok: true, profileId: mergedProfile.id });
}
