import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireTenantSession } from "@/lib/tenant-auth";
import {
  connectEvolutionInstance,
  extractEvolutionQr,
  extractEvolutionStatus,
  getEvolutionConnectionState,
} from "@/lib/evolution";
import { WHATSAPP_QR_CHANNEL } from "@/lib/whatsapp-qr";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireTenantSession();
  if ("error" in auth) return auth.error;

  const config = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channelType: {
        tenantId: auth.tenantId,
        channelType: WHATSAPP_QR_CHANNEL,
      },
    },
  });

  if (!config?.providerInstanceName) {
    return Response.json({
      connected: false,
      status: "not_configured",
      voiceReplyMode: "voice",
      groupReplyRule: "mention_keyword",
      groupKeywords: [],
      groups: [],
    });
  }

  let connectionState: any = null;
  let status = config.connectionStatus || "unknown";
  let qrCode = config.qrCode;
  let qrUpdatedAt = config.qrUpdatedAt;

  try {
    connectionState = await getEvolutionConnectionState(config.providerInstanceName);
    status = extractEvolutionStatus(connectionState);
    const nextQr = extractEvolutionQr(connectionState);
    if (nextQr) {
      qrCode = nextQr;
      qrUpdatedAt = new Date();
    }

    if (!qrCode && !["open", "connected", "ready"].includes(String(status).toLowerCase())) {
      const reconnectResult = await connectEvolutionInstance(config.providerInstanceName);
      const reconnectQr = extractEvolutionQr(reconnectResult);
      if (reconnectQr) {
        qrCode = reconnectQr;
        qrUpdatedAt = new Date();
      }
      connectionState = {
        connectionState,
        reconnectResult,
      };
      status = extractEvolutionStatus(reconnectResult) || status;
    }

    const previousMetadata =
      typeof config.providerMetadata === "object" && config.providerMetadata && !Array.isArray(config.providerMetadata)
        ? (config.providerMetadata as Record<string, unknown>)
        : {};

    await prisma.channelConfig.update({
      where: { id: config.id },
      data: {
        connectionStatus: status,
        qrCode,
        qrUpdatedAt,
        providerMetadata: {
          ...previousMetadata,
          lastConnectionState: connectionState,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    status = config.connectionStatus || "unknown";
  }

  const groups = await prisma.whatsAppGroupSetting.findMany({
    where: {
      tenantId: auth.tenantId,
      channelType: "whatsapp_qr",
    },
    orderBy: [{ isEnabled: "desc" }, { updatedAt: "desc" }],
  });

  return Response.json({
    connected: ["open", "connected", "ready"].includes(String(status).toLowerCase()),
    status,
    instanceName: config.providerInstanceName,
    qrCode,
    qrUpdatedAt,
    voiceReplyMode: config.voiceReplyMode,
    groupReplyRule: config.groupReplyRule,
    groupKeywords: config.groupKeywords || [],
    groups: groups.map((group) => ({
      id: group.id,
      groupJid: group.groupJid,
      groupName: group.groupName,
      isEnabled: group.isEnabled,
      replyRule: group.replyRule,
      keywords: group.keywords || [],
    })),
  });
}
