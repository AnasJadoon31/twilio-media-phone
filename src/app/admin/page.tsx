"use client";

import { FormEvent, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Loader2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { ClientManager } from "@/components/dashboard/ClientManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isAdmin = (session?.user as any)?.role === "admin";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await signIn("credentials", {
        redirect: false,
        email,
        password,
        admin: "true",
      });

      if (response?.error) {
        setError("Invalid super-admin credentials");
      }
    } catch {
      setError("Could not sign in");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
        <div className="max-w-7xl mx-auto p-8 space-y-8">
          <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between pb-6 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 text-cyan-300 text-sm uppercase tracking-wider font-semibold mb-2">
                <ShieldCheck className="h-4 w-4" />
                Super Admin
              </div>
              <h1 className="text-4xl font-extrabold tracking-tight">Tenant Administration</h1>
              <p className="text-neutral-400 mt-2">Create tenants and generate their initial passwords.</p>
            </div>
            <Button
              type="button"
              onClick={() => signOut({ callbackUrl: "/admin" })}
              className="border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-white"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </header>

          <ClientManager />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-neutral-900/50 p-8 rounded-2xl border border-white/10 backdrop-blur-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20">
            <LockKeyhole className="h-6 w-6 text-cyan-300" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Admin Login</h1>
          <p className="text-neutral-400">Sign in as super admin to manage tenants</p>
        </div>

        {error ? (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg mb-6 text-sm text-center">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="bg-neutral-950 border-neutral-800"
              placeholder="superadmin@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="bg-neutral-950 border-neutral-800"
            />
          </div>

          <Button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
