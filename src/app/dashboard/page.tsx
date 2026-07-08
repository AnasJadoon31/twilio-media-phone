"use client";

import { signOut, useSession } from "next-auth/react";
import { Loader2, LogOut, MessageSquare, PhoneCall, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MediaPhone } from "@/components/units/MediaPhone";
import { TenantConfigPanel } from "@/components/dashboard/TenantConfigPanel";
import { ChatHistory } from "@/components/dashboard/ChatHistory";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const tenantSlug = ((session?.user as any)?.slug || "").trim();

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30 overscroll-none">
      <div className="max-w-7xl mx-auto p-6 md:p-8 space-y-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 text-purple-300 text-sm uppercase tracking-wider font-semibold mb-2">
              <Badge className="bg-purple-500/15 text-purple-200 border border-purple-500/20">
                {tenantSlug || "tenant"}
              </Badge>
              Tenant Console
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight">
              {session?.user?.name || "Tenant Workspace"}
            </h1>
            <p className="text-neutral-400 mt-2">
              Twilio calls and social messages are scoped to this tenant only.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full md:w-auto border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-white"
          >
            <LogOut size={16} className="mr-2" />
            Sign Out
          </Button>
        </header>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-neutral-300">
            <PhoneCall className="h-5 w-5 text-emerald-400" />
            <h2 className="text-xl font-semibold">Twilio Call Panel</h2>
          </div>
          <MediaPhone tenantSlug={tenantSlug} embedded />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-8 items-start">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-neutral-300">
              <Settings className="h-5 w-5 text-purple-400" />
              <h2 className="text-xl font-semibold">Tenant Channels</h2>
            </div>
            <TenantConfigPanel />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-neutral-300">
              <MessageSquare className="h-5 w-5 text-cyan-400" />
              <h2 className="text-xl font-semibold">Customer Message Threads</h2>
            </div>
            <ChatHistory />
          </div>
        </section>
      </div>
    </div>
  );
}
