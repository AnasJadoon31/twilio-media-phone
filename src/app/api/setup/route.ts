import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Public setup is disabled.",
      nextStep: "Sign in at /admin as super admin to create tenants and generate passwords.",
    },
    { status: 410 }
  );
}
