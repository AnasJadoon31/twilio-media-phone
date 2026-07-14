import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { callTenantAiCoreInteract, extractAiCoreReply } from "@/lib/ai-core";
import { createMessageWithContact } from "@/lib/operator";

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v23.0";
const WHATSAPP_TEXT_LIMIT = 4096;

type WhatsAppSendResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string; code?: string; status?: number };

function outboundFailureId(result: Extract<WhatsAppSendResult, { ok: false }>) {
  const code = result.code || result.status || "send_error";
  return `failed:${code}:${result.error}`.slice(0, 500);
}

async function sendWhatsAppTextMessage({
  accessToken,
  phoneId,
  to,
  body,
}: {
  accessToken?: string | null;
  phoneId?: string | null;
  to?: string | null;
  body: string;
}): Promise<WhatsAppSendResult> {
  if (!accessToken) {
    return { ok: false, error: "WhatsApp access token is missing.", code: "missing_access_token" };
  }

  if (!phoneId) {
    return { ok: false, error: "WhatsApp Phone Number ID is missing.", code: "missing_phone_number_id" };
  }

  if (!to) {
    return { ok: false, error: "Recipient phone number is missing.", code: "missing_recipient" };
  }

  const recipient = to.replace(/^\+/, "").trim();
  const text = body.length > WHATSAPP_TEXT_LIMIT ? `${body.slice(0, WHATSAPP_TEXT_LIMIT - 3)}...` : body;
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: {
        preview_url: false,
        body: text,
      },
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.error) {
    return {
      ok: false,
      status: response.status,
      code: data?.error?.code ? String(data.error.code) : undefined,
      error: data?.error?.message || `WhatsApp API returned HTTP ${response.status}.`,
    };
  }

  return {
    ok: true,
    messageId: data?.messages?.[0]?.id,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const searchParams = req.nextUrl.searchParams;
  
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      include: {
        coreAiApi: true,
        channelConfigs: { where: { channelType: "whatsapp" } },
      }
    });

    if (tenant && tenant.channelConfigs[0]?.verifyToken === token) {
      return new NextResponse(challenge, { status: 200 });
    } else {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return new NextResponse("Bad Request", { status: 400 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      include: {
        coreAiApi: true,
        channelConfigs: { where: { channelType: "whatsapp" } },
      }
    });

    if (!tenant) return new NextResponse("Not Found", { status: 404 });
    const config = tenant.channelConfigs[0];
    if (!config || !config.isActive) return new NextResponse("Service Unavailable", { status: 503 });

    const body = await req.json();
    
    // WhatsApp payload parsing
    if (body.object !== "whatsapp_business_account") {
      return new NextResponse("Not a WhatsApp event", { status: 400 });
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];
    
    if (!message) {
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    const senderId = message.from; // User's phone number
    const receiverId = value.metadata?.display_phone_number || config.phoneId;
    const messageText = message.text?.body;
    const externalMessageId = message.id;

    if (!messageText) {
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // Save inbound message
    await createMessageWithContact({
      tenantId: tenant.id,
      channelType: "whatsapp",
      direction: "inbound",
      content: messageText,
      senderId,
      receiverId,
      externalMessageId
    });

    let aiReplyText = "I'm sorry, I couldn't process that request right now.";

    try {
      const aiResponse = await callTenantAiCoreInteract(tenant, {
        company_slug: slug,
        call_sid: `wa-${externalMessageId}`,
        text: messageText,
        channel: "whatsapp",
      });

      if (aiResponse.ok) {
        const data = await aiResponse.json();
        aiReplyText = extractAiCoreReply(data, aiReplyText);
      } else {
        console.error(`[WhatsApp:${slug}] AI Core returned HTTP ${aiResponse.status}`);
      }
    } catch (error) {
      console.error(`[WhatsApp:${slug}] AI Core request failed:`, error);
    }

    const sendResult = await sendWhatsAppTextMessage({
      accessToken: config.accessToken,
      phoneId: config.phoneId,
      to: senderId,
      body: aiReplyText,
    });

    if (!sendResult.ok) {
      console.error(`[WhatsApp:${slug}] Outbound send failed:`, sendResult);
    }

    // Save outbound message after the Meta API attempt so the dashboard reflects the real send status.
    await createMessageWithContact({
      tenantId: tenant.id,
      channelType: "whatsapp",
      direction: "outbound",
      content: aiReplyText,
      senderId: receiverId,
      receiverId: senderId,
      externalMessageId: sendResult.ok ? sendResult.messageId || "sent:accepted" : outboundFailureId(sendResult)
    });

    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("WhatsApp Webhook Error:", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
