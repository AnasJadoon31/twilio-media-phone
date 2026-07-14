import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const internalApiKey = () => process.env.AI_CORE_API_KEY || "dev-secret";
const defaultBaseUrl = () =>
  (process.env.AI_CORE_URL || process.env.NEXT_PUBLIC_AI_CORE_URL || "https://api.operaios.qzz.io").replace(/\/+$/, "");

function isAuthorized(req: NextRequest) {
  return req.headers.get("x-internal-api-key") === internalApiKey();
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      slug: true,
      coreAiApi: {
        select: {
          name: true,
          baseUrl: true,
          apiKey: true,
          isActive: true,
        },
      },
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const selected = tenant.coreAiApi?.isActive ? tenant.coreAiApi : null;
  const baseUrl = (selected?.baseUrl || defaultBaseUrl()).replace(/\/+$/, "");
  const apiKey = selected?.apiKey || internalApiKey();

  return NextResponse.json({
    tenantSlug: tenant.slug,
    name: selected?.name || "Default AI Core",
    baseUrl,
    endpoint: `${baseUrl}/api/v1/call/interact`,
    apiKey,
    source: selected ? "tenant" : "default",
  });
}
