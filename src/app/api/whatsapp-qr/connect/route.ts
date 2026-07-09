import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireTenantSession } from "@/lib/tenant-auth";
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  extractEvolutionQr,
  extractEvolutionStatus,
  qrInstanceName,
  setEvolutionWebhook,
} from "@/lib/evolution";
import { newWebhookSecret, publicEvolutionWebhookUrl, WHATSAPP_QR_CHANNEL } from "@/lib/whatsapp-qr";

export const dynamic = "force-dynamic";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export async function POST() {
  const auth = await requireTenantSession();
  if ("error" in auth) return auth.error;

  const existing = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channelType: {
        tenantId: auth.tenantId,
        channelType: WHATSAPP_QR_CHANNEL,
      },
    },
  });

  const instanceName = existing?.providerInstanceName || qrInstanceName(auth.tenantId);
  const webhookSecret = existing?.webhookSecret || newWebhookSecret();
  const webhookUrl = publicEvolutionWebhookUrl(webhookSecret);

  let createResult: any = null;
  try {
    createResult = await createEvolutionInstance(instanceName);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("exist") && !message.includes("already")) {
      throw error;
    }
  }

  await setEvolutionWebhook(instanceName, webhookUrl);
  const connectResult = await connectEvolutionInstance(instanceName);
  const qrCode = extractEvolutionQr(connectResult) || extractEvolutionQr(createResult);
  const connectionStatus = extractEvolutionStatus(connectResult);
  const providerMetadata = asJson({ lastConnectResult: connectResult });

  const config = await prisma.channelConfig.upsert({
    where: {
      tenantId_channelType: {
        tenantId: auth.tenantId,
        channelType: WHATSAPP_QR_CHANNEL,
      },
    },
    update: {
      provider: "evolution",
      providerInstanceName: instanceName,
      providerInstanceId: instanceName,
      webhookSecret,
      connectionStatus,
      qrCode,
      qrUpdatedAt: qrCode ? new Date() : existing?.qrUpdatedAt,
      isActive: true,
      voiceReplyMode: existing?.voiceReplyMode || "voice",
      groupReplyRule: existing?.groupReplyRule || "mention_keyword",
      providerMetadata,
    },
    create: {
      tenantId: auth.tenantId,
      channelType: WHATSAPP_QR_CHANNEL,
      provider: "evolution",
      providerInstanceName: instanceName,
      providerInstanceId: instanceName,
      webhookSecret,
      connectionStatus,
      qrCode,
      qrUpdatedAt: qrCode ? new Date() : undefined,
      isActive: true,
      voiceReplyMode: "voice",
      groupReplyRule: "mention_keyword",
      providerMetadata,
    },
  });

  return Response.json({
    ok: true,
    instanceName,
    status: config.connectionStatus,
    qrCode: config.qrCode,
    qrUpdatedAt: config.qrUpdatedAt,
  });
}
