import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

type TestResult = {
  ok: boolean;
  status: "connected" | "warning" | "failed";
  message: string;
  details?: Record<string, unknown>;
};

type ChannelConfigInput = {
  channelType?: string;
  verifyToken?: string;
  accessToken?: string;
  phoneId?: string;
  businessAccountId?: string;
  pageId?: string;
};

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v23.0";

const graphUrl = (path: string) =>
  `https://graph.facebook.com/${GRAPH_API_VERSION}/${path.replace(/^\//, "")}`;

async function graphGet(path: string, accessToken: string) {
  const response = await fetch(graphUrl(path), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const missing = (fields: string[]): TestResult => ({
  ok: false,
  status: "failed",
  message: `Missing required field${fields.length > 1 ? "s" : ""}: ${fields.join(", ")}`,
});

async function testWhatsApp(config: Required<Pick<ChannelConfigInput, "accessToken" | "phoneId">> & ChannelConfigInput): Promise<TestResult> {
  if (config.businessAccountId) {
    const { response, body } = await graphGet(
      `${config.businessAccountId}/phone_numbers?fields=id,display_phone_number,verified_name`,
      config.accessToken
    );

    if (!response.ok) {
      return {
        ok: false,
        status: "failed",
        message: body?.error?.message || "Could not read WhatsApp Business Account phone numbers.",
        details: { code: body?.error?.code, type: body?.error?.type },
      };
    }

    const numbers = Array.isArray(body?.data) ? body.data : [];
    const matchedNumber = numbers.find((number: { id?: string }) => number.id === config.phoneId);

    if (!matchedNumber) {
      return {
        ok: false,
        status: "failed",
        message: "Access token can read the WABA, but the Phone Number ID was not found under it.",
        details: { businessAccountId: config.businessAccountId, phoneId: config.phoneId },
      };
    }

    return {
      ok: true,
      status: "connected",
      message: "WhatsApp token, WABA, and Phone Number ID match.",
      details: matchedNumber,
    };
  }

  const { response, body } = await graphGet(
    `${config.phoneId}?fields=id,display_phone_number,verified_name`,
    config.accessToken
  );

  if (!response.ok) {
    return {
      ok: false,
      status: "failed",
      message: body?.error?.message || "Could not read WhatsApp Phone Number ID.",
      details: { code: body?.error?.code, type: body?.error?.type },
    };
  }

  return {
    ok: true,
    status: "warning",
    message: "Phone Number ID is readable. Add WABA ID to also confirm it belongs to the right WhatsApp Business Account.",
    details: body,
  };
}

async function testMessenger(config: Required<Pick<ChannelConfigInput, "accessToken" | "pageId">>): Promise<TestResult> {
  const { response, body } = await graphGet(`${config.pageId}?fields=id,name`, config.accessToken);

  if (!response.ok) {
    return {
      ok: false,
      status: "failed",
      message: body?.error?.message || "Could not read Facebook Page with this access token.",
      details: { code: body?.error?.code, type: body?.error?.type },
    };
  }

  return {
    ok: true,
    status: "connected",
    message: "Messenger Page ID and access token are readable.",
    details: body,
  };
}

async function testInstagram(config: Required<Pick<ChannelConfigInput, "accessToken" | "pageId">>): Promise<TestResult> {
  const { response, body } = await graphGet(
    `${config.pageId}?fields=id,name,instagram_business_account{id,username}`,
    config.accessToken
  );

  if (!response.ok) {
    return {
      ok: false,
      status: "failed",
      message: body?.error?.message || "Could not read Page/Instagram connection with this access token.",
      details: { code: body?.error?.code, type: body?.error?.type },
    };
  }

  if (!body?.instagram_business_account?.id) {
    return {
      ok: false,
      status: "failed",
      message: "Page is readable, but no Instagram professional account is linked to it.",
      details: body,
    };
  }

  return {
    ok: true,
    status: "connected",
    message: "Instagram professional account is linked and readable.",
    details: body.instagram_business_account,
  };
}

function testTwilioSms(config: ChannelConfigInput): TestResult {
  const missingFields = [
    !config.phoneId ? "Twilio Phone Number" : "",
    !config.verifyToken ? "Webhook Verify Token" : "",
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return missing(missingFields);
  }

  return {
    ok: true,
    status: "warning",
    message: "Twilio SMS config is complete locally. Confirm the SMS webhook URL is saved on the number in Twilio Console.",
    details: { phoneNumber: config.phoneId },
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((session.user as any).role !== "tenant") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const tenantId = (session.user as { id?: string }).id;
    const body = (await req.json()) as ChannelConfigInput;
    const channelType = body.channelType;

    if (!tenantId || !channelType) {
      return NextResponse.json({ error: "Channel type is required" }, { status: 400 });
    }

    const savedConfig = await prisma.channelConfig.findUnique({
      where: {
        tenantId_channelType: {
          tenantId,
          channelType,
        },
      },
    });

    const config = {
      channelType,
      verifyToken: body.verifyToken ?? savedConfig?.verifyToken ?? "",
      accessToken: body.accessToken ?? savedConfig?.accessToken ?? "",
      phoneId: body.phoneId ?? savedConfig?.phoneId ?? "",
      businessAccountId: body.businessAccountId ?? savedConfig?.businessAccountId ?? "",
      pageId: body.pageId ?? savedConfig?.pageId ?? "",
    };

    let result: TestResult;

    if (channelType === "whatsapp") {
      const missingFields = [
        !config.accessToken ? "Access Token" : "",
        !config.phoneId ? "Phone Number ID" : "",
      ].filter(Boolean);
      result = missingFields.length > 0 ? missing(missingFields) : await testWhatsApp(config as Required<Pick<ChannelConfigInput, "accessToken" | "phoneId">> & ChannelConfigInput);
    } else if (channelType === "messenger") {
      const missingFields = [
        !config.accessToken ? "Page Access Token" : "",
        !config.pageId ? "Page ID" : "",
      ].filter(Boolean);
      result = missingFields.length > 0 ? missing(missingFields) : await testMessenger(config as Required<Pick<ChannelConfigInput, "accessToken" | "pageId">>);
    } else if (channelType === "instagram") {
      const missingFields = [
        !config.accessToken ? "Page Access Token" : "",
        !config.pageId ? "Facebook Page ID" : "",
      ].filter(Boolean);
      result = missingFields.length > 0 ? missing(missingFields) : await testInstagram(config as Required<Pick<ChannelConfigInput, "accessToken" | "pageId">>);
    } else if (channelType === "twilio_sms") {
      result = testTwilioSms(config);
    } else {
      return NextResponse.json({ error: "Unsupported channel type" }, { status: 400 });
    }

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error("Channel connection test failed:", error);
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        message: "Connection test failed before completion.",
      },
      { status: 500 }
    );
  }
}
