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
  const contactId = typeof body.contactId === "string" ? body.contactId : "";

  if (!contactId) {
    return Response.json({ error: "contactId is required." }, { status: 400 });
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId: auth.tenantId,
    },
    include: {
      profile: {
        include: {
          contacts: {
            select: { id: true },
          },
        },
      },
    },
  });

  if (!contact) {
    return Response.json({ error: "Contact not found." }, { status: 404 });
  }

  if (contact.profile.contacts.length <= 1) {
    return Response.json({ ok: true, profileId: contact.profileId });
  }

  const newProfile = await prisma.$transaction(async (tx) => {
    const profile = await tx.contactProfile.create({
      data: {
        tenantId: auth.tenantId,
        displayName: contact.displayName || contact.externalId,
      },
    });

    await tx.contact.update({
      where: { id: contact.id },
      data: { profileId: profile.id },
    });

    await tx.notification.updateMany({
      where: {
        tenantId: auth.tenantId,
        contactId: contact.id,
      },
      data: {
        profileId: profile.id,
      },
    });

    await tx.contactProfile.deleteMany({
      where: {
        tenantId: auth.tenantId,
        id: contact.profileId,
        contacts: { none: {} },
      },
    });

    return profile;
  });

  return Response.json({ ok: true, profileId: newProfile.id });
}
