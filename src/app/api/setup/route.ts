import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcrypt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const tenantCount = await prisma.tenant.count();
    
    if (tenantCount > 0) {
      return NextResponse.json({ error: "Setup already completed. Tenants exist." }, { status: 403 });
    }

    const email = "admin@example.com";
    const password = "password123";
    const hashedPassword = await bcrypt.hash(password, 10);

    const tenant = await prisma.tenant.create({
      data: {
        email,
        name: "Admin Company",
        slug: "admin-company",
        passwordHash: hashedPassword,
      },
    });

    return NextResponse.json({
      message: "Successfully initialized the database with a default admin tenant.",
      credentials: {
        email,
        password,
        slug: tenant.slug
      },
      nextSteps: "Please login at /login and change your password immediately."
    });
  } catch (err) {
    console.error("Setup error:", err);
    return NextResponse.json({ error: "Failed to run setup" }, { status: 500 });
  }
}
