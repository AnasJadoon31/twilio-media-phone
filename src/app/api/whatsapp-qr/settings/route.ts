import prisma from "@/lib/prisma";
import { requireTenantSession } from "@/lib/tenant-auth";
import { WHATSAPP_QR_CHANNEL } from "@/lib/whatsapp-qr";

export const dynamic = "force-dynamic";

const VOICE_REPLY_MODES = new Set(["voice", "text", "both"]);

function normalizeKeywords(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 25);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 25);
  }

  return [];
}

export async function PATCH(req: Request) {
  const auth = await requireTenantSession();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const voiceReplyMode = typeof body.voiceReplyMode === "string" ? body.voiceReplyMode : undefined;
  const groupKeywords = body.groupKeywords !== undefined ? normalizeKeywords(body.groupKeywords) : undefined;

  if (voiceReplyMode && !VOICE_REPLY_MODES.has(voiceReplyMode)) {
    return Response.json({ error: "voiceReplyMode must be voice, text, or both." }, { status: 400 });
  }

  const config = await prisma.channelConfig.upsert({
    where: {
      tenantId_channelType: {
        tenantId: auth.tenantId,
        channelType: WHATSAPP_QR_CHANNEL,
      },
    },
    update: {
      ...(voiceReplyMode ? { voiceReplyMode } : {}),
      ...(groupKeywords !== undefined ? { groupKeywords } : {}),
      groupReplyRule: "mention_keyword",
    },
    create: {
      tenantId: auth.tenantId,
      channelType: WHATSAPP_QR_CHANNEL,
      provider: "evolution",
      isActive: true,
      voiceReplyMode: voiceReplyMode || "voice",
      groupReplyRule: "mention_keyword",
      groupKeywords: groupKeywords || [],
    },
  });

  if (typeof body.groupJid === "string" && body.groupJid.trim()) {
    await prisma.whatsAppGroupSetting.upsert({
      where: {
        tenantId_channelType_groupJid: {
          tenantId: auth.tenantId,
          channelType: WHATSAPP_QR_CHANNEL,
          groupJid: body.groupJid.trim(),
        },
      },
      update: {
        groupName: typeof body.groupName === "string" ? body.groupName : undefined,
        isEnabled: Boolean(body.isEnabled),
        replyRule: "mention_keyword",
        keywords: normalizeKeywords(body.keywords ?? body.groupKeywords),
      },
      create: {
        tenantId: auth.tenantId,
        channelType: WHATSAPP_QR_CHANNEL,
        groupJid: body.groupJid.trim(),
        groupName: typeof body.groupName === "string" ? body.groupName : undefined,
        isEnabled: Boolean(body.isEnabled),
        replyRule: "mention_keyword",
        keywords: normalizeKeywords(body.keywords ?? body.groupKeywords),
      },
    });
  }

  return Response.json({
    ok: true,
    voiceReplyMode: config.voiceReplyMode,
    groupReplyRule: config.groupReplyRule,
    groupKeywords: config.groupKeywords || [],
  });
}
