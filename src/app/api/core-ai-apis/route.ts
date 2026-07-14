import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ((session.user as any).role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const servers = await prisma.coreAiApi.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        baseUrl: true,
        apiKey: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: { tenants: true },
        },
      },
    });

    return NextResponse.json(
      servers.map((server) => ({
        ...server,
        hasApiKey: Boolean(server.apiKey),
        apiKey: server.apiKey ? "********" : "",
        tenantCount: server._count.tenants,
        _count: undefined,
      }))
    );
  } catch (error) {
    console.error("Failed to fetch AI servers:", error);
    return NextResponse.json({ error: "Failed to fetch AI servers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const baseUrl = normalizeBaseUrl(String(body.baseUrl || ""));
    const apiKey = String(body.apiKey || "").trim() || null;
    const isActive = body.isActive ?? true;

    if (!name) {
      return NextResponse.json({ error: "AI server name is required" }, { status: 400 });
    }

    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json({ error: "A valid AI server base URL is required" }, { status: 400 });
    }

    const server = await prisma.coreAiApi.upsert({
      where: { baseUrl },
      update: { name, apiKey, isActive },
      create: { name, baseUrl, apiKey, isActive },
      select: {
        id: true,
        name: true,
        baseUrl: true,
        apiKey: true,
        isActive: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      ...server,
      hasApiKey: Boolean(server.apiKey),
      apiKey: server.apiKey ? "********" : "",
      tenantCount: 0,
    });
  } catch (error) {
    console.error("Failed to save AI server:", error);
    return NextResponse.json({ error: "Failed to save AI server" }, { status: 500 });
  }
}
