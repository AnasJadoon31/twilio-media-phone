import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { extractEvolutionQr, extractEvolutionStatus } from "@/lib/evolution";
import {
  createQrReplyJob,
  normalizeEvolutionMessage,
  ownWhatsAppJids,
  shouldReplyToGroupMessage,
  upsertQrInboundMessage,
  WHATSAPP_QR_CHANNEL,
} from "@/lib/whatsapp-qr";

export const dynamic = "force-dynamic";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function eventName(body: any) {
  return String(body?.event || body?.type || "")
    .replace(/[.-]/g, "_")
    .toUpperCase();
}

function extractInstanceName(body: any) {
  return body?.instance || body?.instanceName || body?.instance_name || body?.data?.instance || "";
}

function extractGroupJid(body: any) {
  return body?.data?.id || body?.data?.jid || body?.data?.groupJid || body?.groupJid || "";
}

export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const body = await req.json().catch(() => null);

  if (!body) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const config = await prisma.channelConfig.findFirst({
    where: {
      channelType: WHATSAPP_QR_CHANNEL,
      webhookSecret: secret,
    },
  });

  if (!config) {
    return Response.json({ error: "Unknown webhook" }, { status: 404 });
  }

  const event = eventName(body);
  const instanceName = extractInstanceName(body);

  if (instanceName && config.providerInstanceName && instanceName !== config.providerInstanceName) {
    return Response.json({ error: "Instance mismatch" }, { status: 403 });
  }

  if (event === "QRCODE_UPDATED") {
    const qrCode = extractEvolutionQr(body);
    await prisma.channelConfig.update({
      where: { id: config.id },
      data: {
        qrCode,
        qrUpdatedAt: qrCode ? new Date() : config.qrUpdatedAt,
        connectionStatus: "qr",
        providerMetadata: asJson(body),
      },
    });
    return Response.json({ ok: true });
  }

  if (event === "CONNECTION_UPDATE") {
    const connectionStatus = extractEvolutionStatus(body);
    const qrCode = extractEvolutionQr(body) || config.qrCode;
    await prisma.channelConfig.update({
      where: { id: config.id },
      data: {
        connectionStatus,
        qrCode,
        qrUpdatedAt: qrCode !== config.qrCode ? new Date() : config.qrUpdatedAt,
        providerMetadata: asJson(body),
      },
    });
    return Response.json({ ok: true });
  }

  if (event === "GROUPS_UPSERT" || event === "GROUP_UPDATE") {
    const groupJid = extractGroupJid(body);
    if (groupJid) {
      await prisma.whatsAppGroupSetting.upsert({
        where: {
          tenantId_channelType_groupJid: {
            tenantId: config.tenantId,
            channelType: WHATSAPP_QR_CHANNEL,
            groupJid,
          },
        },
        update: {
          groupName: body?.data?.subject || body?.data?.name || undefined,
        },
        create: {
          tenantId: config.tenantId,
          channelType: WHATSAPP_QR_CHANNEL,
          groupJid,
          groupName: body?.data?.subject || body?.data?.name || undefined,
          isEnabled: false,
          replyRule: "mention_keyword",
          keywords: config.groupKeywords || [],
        },
      });
    }
    return Response.json({ ok: true });
  }

  if (event !== "MESSAGES_UPSERT") {
    return Response.json({ ok: true, ignored: true });
  }

  const items = Array.isArray(body?.data) ? body.data : [body];
  const results = [];

  for (const item of items) {
    const normalized = normalizeEvolutionMessage(item === body ? body : { ...body, data: item });
    if (!normalized) {
      results.push({ ok: false, reason: "unrecognized_message" });
      continue;
    }

    const { message, created } = await upsertQrInboundMessage({ config, message: normalized });

    if (!created || normalized.fromMe) {
      results.push({ ok: true, queued: false, duplicate: !created, fromMe: normalized.fromMe });
      continue;
    }

    let shouldQueue = !normalized.isGroup;

    if (normalized.isGroup) {
      const setting = await prisma.whatsAppGroupSetting.upsert({
        where: {
          tenantId_channelType_groupJid: {
            tenantId: config.tenantId,
            channelType: WHATSAPP_QR_CHANNEL,
            groupJid: normalized.chatId,
          },
        },
        update: {},
        create: {
          tenantId: config.tenantId,
          channelType: WHATSAPP_QR_CHANNEL,
          groupJid: normalized.chatId,
          isEnabled: false,
          replyRule: "mention_keyword",
          keywords: config.groupKeywords || [],
        },
      });

      shouldQueue = shouldReplyToGroupMessage({
        content: normalized.content,
        mentions: normalized.mentions,
        hasQuotedMessage: normalized.hasQuotedMessage,
        quotedParticipantId: normalized.quotedParticipantId,
        ownJids: ownWhatsAppJids(config),
        setting,
      });
    }

    if (shouldQueue && (normalized.content.trim() || normalized.mediaType === "voice" || normalized.mediaType === "audio")) {
      await createQrReplyJob({
        config,
        messageId: message.id,
        contactId: message.contactId,
        normalized,
      });
      await prisma.message.update({
        where: { id: message.id },
        data: { processingStatus: "queued" },
      });
      results.push({ ok: true, queued: true, messageId: message.id });
    } else {
      results.push({ ok: true, queued: false, messageId: message.id });
    }
  }

  return Response.json({ ok: true, results });
}
