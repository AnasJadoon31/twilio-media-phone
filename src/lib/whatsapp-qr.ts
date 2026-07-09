import crypto from "crypto";
import type { ChannelConfig, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createMessageWithContact } from "@/lib/operator";

export const WHATSAPP_QR_CHANNEL = "whatsapp_qr";

type NormalizedEvolutionMessage = {
  event: string;
  instanceName: string;
  messageId: string;
  fromMe: boolean;
  chatId: string;
  replyJid: string;
  participantId: string | null;
  isGroup: boolean;
  content: string;
  mediaType: string | null;
  mediaBase64: string | null;
  mediaUrl: string | null;
  mimetype: string | null;
  fileName: string | null;
  mentions: string[];
  hasQuotedMessage: boolean;
  quotedParticipantId: string | null;
  raw: Prisma.InputJsonValue;
};

export function newWebhookSecret() {
  return crypto.randomBytes(24).toString("hex");
}

export function publicEvolutionWebhookUrl(secret: string) {
  const baseUrl =
    process.env.EVOLUTION_WEBHOOK_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "";

  if (!baseUrl) {
    throw new Error("EVOLUTION_WEBHOOK_PUBLIC_BASE_URL or NEXTAUTH_URL is required.");
  }

  return `${baseUrl.replace(/\/$/, "")}/api/webhooks/evolution/${secret}`;
}

function getTextFromMessage(message: any) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.listResponseMessage?.title ||
    ""
  );
}

function getMediaType(message: any) {
  if (message?.audioMessage) return message.audioMessage.ptt ? "voice" : "audio";
  if (message?.imageMessage) return "image";
  if (message?.videoMessage) return "video";
  if (message?.documentMessage) return "document";
  if (message?.stickerMessage) return "sticker";
  return null;
}

function getMediaNode(message: any) {
  return (
    message?.audioMessage ||
    message?.imageMessage ||
    message?.videoMessage ||
    message?.documentMessage ||
    message?.stickerMessage ||
    null
  );
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function ownJidCandidate(value: unknown) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (raw.endsWith("@s.whatsapp.net") || raw.endsWith("@g.us")) {
    return raw.toLowerCase();
  }

  if (raw.endsWith("@c.us")) {
    return `${raw.replace("@c.us", "")}@s.whatsapp.net`.toLowerCase();
  }

  if (/^\+?\d{8,20}$/.test(raw.replace(/\s+/g, ""))) {
    return `${raw.replace(/\D/g, "")}@s.whatsapp.net`.toLowerCase();
  }

  return null;
}

function providerMetadataObject(config: Pick<ChannelConfig, "providerMetadata">) {
  return typeof config.providerMetadata === "object" && config.providerMetadata && !Array.isArray(config.providerMetadata)
    ? (config.providerMetadata as Record<string, any>)
    : {};
}

export function ownWhatsAppJids(config: Pick<ChannelConfig, "providerMetadata" | "providerInstanceId">) {
  const metadata = providerMetadataObject(config);
  const candidates = [
    config.providerInstanceId,
    metadata.owner,
    metadata?.instance?.owner,
    metadata?.data?.owner,
    metadata?.data?.instance?.owner,
    metadata?.lastConnectResult?.owner,
    metadata?.lastConnectResult?.instance?.owner,
    metadata?.lastConnectionState?.owner,
    metadata?.lastConnectionState?.instance?.owner,
  ];

  return Array.from(new Set(candidates.map(ownJidCandidate).filter((item): item is string => Boolean(item))));
}

export function normalizeEvolutionMessage(body: any): NormalizedEvolutionMessage | null {
  const event = body?.event || body?.type || "";
  const data = body?.data || body?.message || body;
  const key = data?.key || data?.message?.key || {};
  const message = data?.message?.message || data?.message || data?.messages?.[0]?.message || data?.content || {};
  const instanceName =
    body?.instance ||
    body?.instanceName ||
    body?.instance_name ||
    data?.instance ||
    data?.instanceName ||
    "";
  const chatId = key?.remoteJid || data?.remoteJid || data?.chatId || data?.jid || "";
  // LID-mode contacts must be replied to via their @lid JID; sends addressed to
  // the resolved phone-number JID are rejected by WhatsApp with status ERROR.
  const remoteJidAlt = key?.remoteJidAlt || data?.remoteJidAlt || "";
  const replyJid =
    [chatId, remoteJidAlt].find((jid) => typeof jid === "string" && jid.endsWith("@lid")) || chatId;
  const participantId = key?.participant || data?.participant || data?.participantId || null;
  const messageId = key?.id || data?.id || data?.messageId || data?.key?.id || "";
  const fromMe = Boolean(key?.fromMe || data?.fromMe);
  const mediaNode = getMediaNode(message);
  const contextInfo = message?.extendedTextMessage?.contextInfo || mediaNode?.contextInfo || {};

  if (!instanceName || !chatId || !messageId) return null;

  return {
    event,
    instanceName,
    messageId,
    fromMe,
    chatId,
    replyJid,
    participantId,
    isGroup: chatId.endsWith("@g.us"),
    content: getTextFromMessage(message),
    mediaType: getMediaType(message),
    mediaBase64: data?.message?.base64 || data?.base64 || data?.mediaBase64 || null,
    mediaUrl: data?.mediaUrl || data?.url || mediaNode?.url || null,
    mimetype: mediaNode?.mimetype || null,
    fileName: mediaNode?.fileName || null,
    mentions: Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [],
    hasQuotedMessage: Boolean(contextInfo?.quotedMessage || contextInfo?.stanzaId),
    quotedParticipantId: contextInfo?.participant || null,
    raw: asJson(body),
  };
}

export function shouldReplyToGroupMessage({
  content,
  mentions,
  hasQuotedMessage,
  quotedParticipantId,
  ownJids,
  setting,
}: {
  content: string;
  mentions: string[];
  hasQuotedMessage: boolean;
  quotedParticipantId?: string | null;
  ownJids?: string[];
  setting: { isEnabled: boolean; keywords: Prisma.JsonValue | null } | null;
}) {
  if (!setting?.isEnabled) return false;

  const botJids = new Set((ownJids || []).map((jid) => jid.toLowerCase()));
  const mentionedBot = mentions.some((jid) => botJids.has(String(jid).toLowerCase()));
  const quotedBot = Boolean(quotedParticipantId && botJids.has(quotedParticipantId.toLowerCase()));

  if (mentionedBot || (hasQuotedMessage && quotedBot)) return true;

  const keywords = Array.isArray(setting.keywords)
    ? setting.keywords.filter((item): item is string => typeof item === "string")
    : [];

  if (!keywords.length) return false;

  const lowered = content.toLowerCase();
  return keywords.some((keyword) => lowered.includes(keyword.toLowerCase()));
}

export async function upsertQrInboundMessage({
  config,
  message,
}: {
  config: ChannelConfig;
  message: NormalizedEvolutionMessage;
}) {
  const existing = await prisma.message.findFirst({
    where: {
      tenantId: config.tenantId,
      channelType: WHATSAPP_QR_CHANNEL,
      externalMessageId: message.messageId,
    },
  });

  if (existing) return { message: existing, created: false };

  const participant = message.isGroup
    ? message.participantId || message.chatId
    : message.chatId;

  const saved = await createMessageWithContact({
    tenantId: config.tenantId,
    channelType: WHATSAPP_QR_CHANNEL,
    direction: message.fromMe ? "outbound" : "inbound",
    content: message.content || (message.mediaType ? `[${message.mediaType}]` : ""),
    senderId: message.fromMe ? config.providerInstanceName || "bot" : participant,
    receiverId: message.fromMe ? participant : config.providerInstanceName || "bot",
    externalMessageId: message.messageId,
    provider: "evolution",
    chatId: message.chatId,
    groupId: message.isGroup ? message.chatId : null,
    participantId: message.participantId,
    mediaType: message.mediaType,
    processingStatus: message.fromMe ? "sent" : "received",
    providerPayload: message.raw,
  });

  return { message: saved, created: true };
}

export async function createQrReplyJob({
  config,
  messageId,
  contactId,
  normalized,
}: {
  config: ChannelConfig;
  messageId: string;
  contactId?: string | null;
  normalized: NormalizedEvolutionMessage;
}) {
  const jobType = normalized.mediaType === "voice" || normalized.mediaType === "audio"
    ? "whatsapp_qr_voice_reply"
    : "whatsapp_qr_text_reply";

  await prisma.outboundMessageJob.create({
    data: {
      tenantId: config.tenantId,
      messageId,
      contactId,
      channelType: WHATSAPP_QR_CHANNEL,
      jobType,
      payload: {
        instanceName: config.providerInstanceName,
        chatId: normalized.chatId,
        replyJid: normalized.replyJid,
        groupId: normalized.isGroup ? normalized.chatId : null,
        participantId: normalized.participantId,
        messageId: normalized.messageId,
        text: normalized.content,
        mediaType: normalized.mediaType,
        mediaBase64: normalized.mediaBase64,
        mediaUrl: normalized.mediaUrl,
        mimetype: normalized.mimetype,
        fileName: normalized.fileName,
        quotedParticipantId: normalized.quotedParticipantId,
        voiceReplyMode: config.voiceReplyMode || "voice",
      },
    },
  });
}
