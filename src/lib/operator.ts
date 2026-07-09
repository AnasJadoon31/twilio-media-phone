import { Prisma } from "@prisma/client";
import type { Message, PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const OPERATOR_CHANNELS = [
  { id: "all", label: "All", shortLabel: "All" },
  { id: "voice", label: "Voice", shortLabel: "Voice" },
  { id: "whatsapp", label: "WhatsApp", shortLabel: "WA" },
  { id: "instagram", label: "Instagram", shortLabel: "IG" },
  { id: "messenger", label: "Messenger", shortLabel: "MSG" },
  { id: "twilio_sms", label: "Twilio SMS", shortLabel: "SMS" },
] as const;

export type OperatorChannel = (typeof OPERATOR_CHANNELS)[number]["id"];

type MessagePayload = {
  tenantId: string;
  channelType: string;
  direction: string;
  content: string;
  senderId?: string | null;
  receiverId?: string | null;
  externalMessageId?: string | null;
};

type MessageLike = Pick<
  Message,
  "tenantId" | "channelType" | "direction" | "senderId" | "receiverId" | "content" | "id" | "contactId"
>;

export function channelLabel(channelType: string) {
  const channel = OPERATOR_CHANNELS.find((item) => item.id === channelType);
  return channel?.label || channelType.replace(/_/g, " ");
}

export function participantForMessage(message: {
  direction: string;
  senderId?: string | null;
  receiverId?: string | null;
}) {
  const externalId =
    message.direction === "inbound"
      ? message.senderId || null
      : message.receiverId || null;

  return externalId?.trim() || null;
}

function notificationBody(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function ensureContactForParticipant(
  db: DbClient,
  {
    tenantId,
    channelType,
    externalId,
    displayName,
  }: {
    tenantId: string;
    channelType: string;
    externalId: string;
    displayName?: string | null;
  }
) {
  const normalizedExternalId = externalId.trim();
  const name = displayName?.trim() || normalizedExternalId;

  const existing = await db.contact.findUnique({
    where: {
      tenantId_channelType_externalId: {
        tenantId,
        channelType,
        externalId: normalizedExternalId,
      },
    },
  });

  if (existing) return existing;

  try {
    const profile = await db.contactProfile.create({
      data: {
        tenantId,
        displayName: name,
      },
    });

    return await db.contact.create({
      data: {
        tenantId,
        profileId: profile.id,
        channelType,
        externalId: normalizedExternalId,
        displayName: name,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const contact = await db.contact.findUnique({
      where: {
        tenantId_channelType_externalId: {
          tenantId,
          channelType,
          externalId: normalizedExternalId,
        },
      },
    });

    if (!contact) throw error;
    return contact;
  }
}

type NotificationMessage = Pick<Message, "id" | "tenantId" | "channelType" | "content" | "direction">;

export async function createInboundNotificationForMessage(
  db: DbClient,
  message: NotificationMessage,
  contact: { id: string; profileId: string } | null
) {
  if (message.direction !== "inbound" || !contact) return null;

  return db.notification.upsert({
    where: {
      tenantId_sourceType_sourceId: {
        tenantId: message.tenantId,
        sourceType: "message",
        sourceId: message.id,
      },
    },
    update: {
      profileId: contact.profileId,
      contactId: contact.id,
      body: notificationBody(message.content),
      dismissedAt: null,
    },
    create: {
      tenantId: message.tenantId,
      profileId: contact.profileId,
      contactId: contact.id,
      type: "inbound_message",
      channelType: message.channelType,
      title: `New ${channelLabel(message.channelType)} message`,
      body: notificationBody(message.content),
      severity: "info",
      sourceType: "message",
      sourceId: message.id,
      metadata: {
        messageId: message.id,
        channelType: message.channelType,
      },
    },
  });
}

export async function attachContactToMessage(db: DbClient, message: MessageLike) {
  const externalId = participantForMessage(message);
  if (!externalId) return null;

  const contact = await ensureContactForParticipant(db, {
    tenantId: message.tenantId,
    channelType: message.channelType,
    externalId,
  });

  if (message.contactId !== contact.id) {
    await db.message.update({
      where: { id: message.id },
      data: { contactId: contact.id },
    });
  }

  await createInboundNotificationForMessage(db, message, contact);
  return contact;
}

export async function createMessageWithContact(data: MessagePayload) {
  return prisma.$transaction(async (tx) => {
    const externalId = participantForMessage(data);
    const contact = externalId
      ? await ensureContactForParticipant(tx, {
          tenantId: data.tenantId,
          channelType: data.channelType,
          externalId,
        })
      : null;

    const message = await tx.message.create({
      data: {
        tenantId: data.tenantId,
        contactId: contact?.id,
        channelType: data.channelType,
        direction: data.direction,
        content: data.content,
        senderId: data.senderId,
        receiverId: data.receiverId,
        externalMessageId: data.externalMessageId,
      },
    });

    await createInboundNotificationForMessage(tx, message, contact);
    return message;
  });
}

export async function bootstrapTenantContacts(tenantId: string) {
  const messages = await prisma.message.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  for (const message of messages) {
    await attachContactToMessage(prisma, message);
  }
}
