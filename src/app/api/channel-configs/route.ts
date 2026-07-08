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
    const configs = await prisma.channelConfig.findMany({
      where: { tenantId }
    });
    
    return Response.json(configs);
  } catch (err) {
    return Response.json({ error: "Failed to fetch configs" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const tenantId = (session.user as any).id;
  
  try {
    const body = await req.json();
    const { channelType, verifyToken, accessToken, phoneId, pageId, isActive } = body;
    
    if (!channelType) {
      return Response.json({ error: "Channel type is required" }, { status: 400 });
    }
    
    const config = await prisma.channelConfig.upsert({
      where: {
        tenantId_channelType: {
          tenantId,
          channelType
        }
      },
      update: {
        verifyToken,
        accessToken,
        phoneId,
        pageId,
        isActive
      },
      create: {
        tenantId,
        channelType,
        verifyToken,
        accessToken,
        phoneId,
        pageId,
        isActive: isActive ?? true
      }
    });
    
    return Response.json(config);
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Failed to update config" }, { status: 500 });
  }
}
