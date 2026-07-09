import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { OPERATOR_CHANNELS, bootstrapTenantContacts } from "@/lib/operator";

export const dynamic = "force-dynamic";

const RECENT_MESSAGE_LIMIT = 500;

function isTenantSession(session: Session | null) {
  return session?.user && (session.user as any).role === "tenant";
}

function configuredForChannel(channelType: string, config: any) {
  if (channelType === "voice") return true;
  if (!config) return false;
  if (channelType === "whatsapp_qr") return Boolean(config.providerInstanceName && config.webhookSecret);
  if (channelType === "whatsapp") return Boolean(config.verifyToken && config.accessToken && config.phoneId);
  if (channelType === "instagram" || channelType === "messenger") {
    return Boolean(config.verifyToken && config.accessToken && config.pageId);
  }
  if (channelType === "twilio_sms") return Boolean(config.phoneId || config.accessToken || config.verifyToken);
  return Boolean(config.isActive);
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTenantSession(session)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = (session.user as any).id as string;

  await bootstrapTenantContacts(tenantId);

  const [profiles, recentMessagesDesc, notifications, channelConfigs] = await Promise.all([
    prisma.contactProfile.findMany({
      where: { tenantId },
      include: {
        contacts: {
          orderBy: [{ channelType: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    prisma.message.findMany({
      where: {
        tenantId,
        contactId: { not: null },
      },
      include: {
        contact: {
          select: {
            id: true,
            profileId: true,
            channelType: true,
            externalId: true,
            displayName: true,
            lastReadAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_MESSAGE_LIMIT,
    }),
    prisma.notification.findMany({
      where: {
        tenantId,
        dismissedAt: null,
      },
      include: {
        contact: {
          select: {
            id: true,
            channelType: true,
            externalId: true,
            displayName: true,
          },
        },
        profile: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.channelConfig.findMany({
      where: { tenantId },
    }),
  ]);

  const recentMessages = [...recentMessagesDesc].reverse();
  const messagesByProfile = new Map<string, typeof recentMessages>();
  const unreadByChannel = new Map<string, number>();

  for (const message of recentMessages) {
    const profileId = message.contact?.profileId;
    if (!profileId) continue;

    const existing = messagesByProfile.get(profileId) || [];
    existing.push(message);
    messagesByProfile.set(profileId, existing);

    const isUnread =
      message.direction === "inbound" &&
      (!message.contact?.lastReadAt || message.createdAt > message.contact.lastReadAt);

    if (isUnread) {
      unreadByChannel.set(message.channelType, (unreadByChannel.get(message.channelType) || 0) + 1);
      unreadByChannel.set("all", (unreadByChannel.get("all") || 0) + 1);
    }
  }

  const profileSummaries = profiles
    .filter((profile) => profile.contacts.length > 0)
    .map((profile) => {
      const profileMessages = messagesByProfile.get(profile.id) || [];
      const lastMessage = profileMessages[profileMessages.length - 1] || null;
      const unreadCount = profileMessages.filter(
        (message) =>
          message.direction === "inbound" &&
          (!message.contact?.lastReadAt || message.createdAt > message.contact.lastReadAt)
      ).length;

      const channels = Array.from(new Set(profile.contacts.map((contact) => contact.channelType)));
      const displayName =
        profile.displayName ||
        profile.contacts.find((contact) => contact.displayName)?.displayName ||
        profile.contacts[0]?.externalId ||
        "Unknown contact";

      return {
        id: profile.id,
        displayName,
        notes: profile.notes,
        channels,
        unreadCount,
        lastActivityAt: toIso(lastMessage?.createdAt || profile.updatedAt),
        lastMessageSnippet: lastMessage?.content || "",
        contacts: profile.contacts.map((contact) => ({
          id: contact.id,
          channelType: contact.channelType,
          externalId: contact.externalId,
          displayName: contact.displayName,
          lastReadAt: toIso(contact.lastReadAt),
          createdAt: toIso(contact.createdAt),
        })),
        messages: profileMessages.map((message) => ({
          id: message.id,
          contactId: message.contactId,
          channelType: message.channelType,
          direction: message.direction,
          content: message.content,
          senderId: message.senderId,
          receiverId: message.receiverId,
          externalMessageId: message.externalMessageId,
          createdAt: toIso(message.createdAt),
          contactExternalId: message.contact?.externalId || null,
        })),
      };
    })
    .sort((a, b) => {
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    });

  const configByChannel = new Map(channelConfigs.map((config) => [config.channelType, config]));
  const channels = OPERATOR_CHANNELS.map((channel) => {
    const config = configByChannel.get(channel.id);
    const configured = configuredForChannel(channel.id, config);
    const isActive = channel.id === "all" || channel.id === "voice" ? true : Boolean(config?.isActive);

    return {
      ...channel,
      configured,
      isActive,
      unreadCount: unreadByChannel.get(channel.id) || 0,
      status: channel.id === "all" || channel.id === "voice"
        ? "ready"
        : !config
          ? "missing"
          : !config.isActive
            ? "paused"
            : configured
              ? "ready"
              : "needs_setup",
    };
  });

  return Response.json({
    tenant: {
      id: tenantId,
      name: session.user.name || "Tenant Workspace",
      slug: (session.user as any).slug || "",
    },
    channels,
    profiles: profileSummaries,
    notifications: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      channelType: notification.channelType,
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      readAt: toIso(notification.readAt),
      createdAt: toIso(notification.createdAt),
      profileId: notification.profileId,
      contactId: notification.contactId,
      contact: notification.contact,
      profile: notification.profile,
    })),
  });
}
