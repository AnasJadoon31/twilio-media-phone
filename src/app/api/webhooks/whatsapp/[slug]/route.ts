import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const searchParams = req.nextUrl.searchParams;
  
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      include: { channelConfigs: { where: { channelType: "whatsapp" } } }
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
      include: { channelConfigs: { where: { channelType: "whatsapp" } } }
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
    const receiverId = value.metadata?.display_phone_number;
    const messageText = message.text?.body;
    const externalMessageId = message.id;

    if (!messageText) {
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // Save inbound message
    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        channelType: "whatsapp",
        direction: "inbound",
        content: messageText,
        senderId,
        receiverId,
        externalMessageId
      }
    });

    // Send to AI Core
    const aiResponse = await fetch("https://api.operaios.qzz.io/api/v1/call/interact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": "dev-secret" // Keeping system hardcoded key for AI Core communication as seen in metrics
      },
      body: JSON.stringify({
        company_slug: slug,
        call_sid: `wa-${externalMessageId}`,
        text: messageText,
        channel: "whatsapp"
      })
    });

    let aiReplyText = "I'm sorry, I couldn't process that request right now.";
    if (aiResponse.ok) {
      const data = await aiResponse.json();
      aiReplyText = data.reply || data.response_text || data.text || aiReplyText;
    }

    // Save outbound message
    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        channelType: "whatsapp",
        direction: "outbound",
        content: aiReplyText,
        senderId: receiverId,
        receiverId: senderId
      }
    });

    // Send reply back via WhatsApp API
    if (config.accessToken && config.phoneId) {
      await fetch(`https://graph.facebook.com/v17.0/${config.phoneId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: senderId,
          text: { body: aiReplyText }
        })
      });
    }

    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("WhatsApp Webhook Error:", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
