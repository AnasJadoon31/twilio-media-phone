import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if ((session.user as any).role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { tenantId } = await params;
  const body = await req.json();
  const coreAiApiId = body.coreAiApiId ? String(body.coreAiApiId) : null;

  if (coreAiApiId) {
    const server = await prisma.coreAiApi.findUnique({
      where: { id: coreAiApiId },
      select: { id: true },
    });
    if (!server) {
      return NextResponse.json({ error: "AI server not found" }, { status: 404 });
    }
  }

  try {
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { coreAiApiId },
      select: {
        id: true,
        coreAiApiId: true,
        coreAiApi: {
          select: { id: true, name: true, baseUrl: true, isActive: true },
        },
      },
    });

    return NextResponse.json(tenant);
  } catch (error) {
    console.error("Failed to update tenant AI server:", error);
    return NextResponse.json({ error: "Failed to update tenant AI server" }, { status: 500 });
  }
}
