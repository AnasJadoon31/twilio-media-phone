import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createMessageWithContact } from "@/lib/operator";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      include: { channelConfigs: { where: { channelType: "twilio_sms" } } }
    });

    if (!tenant) {
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { status: 404, headers: { 'Content-Type': 'text/xml' } }
      );
    }
    
    const config = tenant.channelConfigs[0];
    if (!config || !config.isActive) {
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { status: 503, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Twilio sends application/x-www-form-urlencoded
    const textData = await req.text();
    const urlParams = new URLSearchParams(textData);
    
    const messageText = urlParams.get("Body");
    const senderId = urlParams.get("From");
    const receiverId = urlParams.get("To");
    const externalMessageId = urlParams.get("MessageSid");

    if (!messageText || !senderId || !receiverId) {
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { status: 400, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    await createMessageWithContact({
      tenantId: tenant.id,
      channelType: "twilio_sms",
      direction: "inbound",
      content: messageText,
      senderId,
      receiverId,
      externalMessageId: externalMessageId || undefined
    });

    const aiResponse = await fetch("https://api.operaios.qzz.io/api/v1/call/interact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": "dev-secret"
      },
      body: JSON.stringify({
        company_slug: slug,
        call_sid: `sms-${externalMessageId}`,
        text: messageText,
        channel: "twilio_sms"
      })
    });

    let aiReplyText = "I'm sorry, I couldn't process that request right now.";
    if (aiResponse.ok) {
      const data = await aiResponse.json();
      aiReplyText = data.reply || data.response_text || data.text || aiReplyText;
    }

    await createMessageWithContact({
      tenantId: tenant.id,
      channelType: "twilio_sms",
      direction: "outbound",
      content: aiReplyText,
      senderId: receiverId,
      receiverId: senderId
    });

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${aiReplyText}</Message></Response>`;
    
    return new NextResponse(twiml, { 
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
    });

  } catch (error) {
    console.error("Twilio SMS Webhook Error:", error);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { status: 500, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}
