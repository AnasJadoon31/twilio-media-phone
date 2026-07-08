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
      include: { channelConfigs: { where: { channelType: "messenger" } } }
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
      include: { channelConfigs: { where: { channelType: "messenger" } } }
    });

    if (!tenant) return new NextResponse("Not Found", { status: 404 });
    const config = tenant.channelConfigs[0];
    if (!config || !config.isActive) return new NextResponse("Service Unavailable", { status: 503 });

    const body = await req.json();

    if (body.object !== "page") {
      return new NextResponse("Not a page event", { status: 400 });
    }

    const entry = body.entry?.[0];
    const messagingEvent = entry?.messaging?.[0];
    
    if (!messagingEvent || !messagingEvent.message) {
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    const senderId = messagingEvent.sender.id;
    const receiverId = messagingEvent.recipient.id;
    const messageText = messagingEvent.message.text;
    const externalMessageId = messagingEvent.message.mid;

    if (!messageText) {
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        channelType: "messenger",
        direction: "inbound",
        content: messageText,
        senderId,
        receiverId,
        externalMessageId
      }
    });

    const aiResponse = await fetch("https://api.operaios.qzz.io/api/v1/call/interact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": "dev-secret"
      },
      body: JSON.stringify({
        company_slug: slug,
        call_sid: `msgr-${externalMessageId}`,
        text: messageText,
        channel: "messenger"
      })
    });

    let aiReplyText = "I'm sorry, I couldn't process that request right now.";
    if (aiResponse.ok) {
      const data = await aiResponse.json();
      aiReplyText = data.reply || data.response_text || data.text || aiReplyText;
    }

    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        channelType: "messenger",
        direction: "outbound",
        content: aiReplyText,
        senderId: receiverId,
        receiverId: senderId
      }
    });

    if (config.accessToken && config.pageId) {
      await fetch(`https://graph.facebook.com/v17.0/${config.pageId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: { text: aiReplyText }
        })
      });
    }

    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("Messenger Webhook Error:", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
