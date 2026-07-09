"use client";

import Link from "next/link";
import { ArrowLeft, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TenantConfigPanel } from "@/components/dashboard/TenantConfigPanel";

export default function ChannelSettingsPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <header className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-300">
              <Settings className="h-4 w-4" />
              Channel Settings
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Configure tenant channels</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Manage credentials, webhook URLs, and channel activation away from the live operator workspace.
            </p>
          </div>
          <Button
            asChild
            variant="outline"
            className="border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white"
          >
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
              Back to workspace
            </Link>
          </Button>
        </header>

        <TenantConfigPanel />
      </div>
    </div>
  );
}
