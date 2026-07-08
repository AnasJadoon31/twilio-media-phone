import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import bcrypt from "bcrypt";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

const normalizeSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

type TenantListItem = {
  id: string;
  name: string;
  slug: string;
  email: string;
  createdAt: Date;
  _count: {
    channelConfigs: number;
    messages: number;
  };
};

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        createdAt: true,
        _count: {
          select: {
            channelConfigs: true,
            messages: true,
          },
        },
      },
    });

    return NextResponse.json(
      tenants.map((tenant: TenantListItem) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        createdAt: tenant.createdAt,
        channelCount: tenant._count.channelConfigs,
        messageCount: tenant._count.messages,
      }))
    );
  } catch (error) {
    console.error("Failed to fetch tenants:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const slug = normalizeSlug(String(body.slug || name));

    if (!name) {
      return NextResponse.json({ error: "Client name is required" }, { status: 400 });
    }

    if (!slug) {
      return NextResponse.json({ error: "Client slug is required" }, { status: 400 });
    }

    if (!isEmail(email)) {
      return NextResponse.json({ error: "A valid login email is required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        email,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        createdAt: true,
      },
    });

    return NextResponse.json(tenant, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A client with that email or slug already exists" },
        { status: 409 }
      );
    }

    console.error("Failed to create tenant:", error);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
