import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const tenantId = (session.user as any).id;
  
  try {
    const messages = await prisma.message.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    
    return Response.json(messages);
  } catch (err) {
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
