"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Building2, KeyRound, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ClientTenant = {
  id: string;
  name: string;
  slug: string;
  email: string;
  createdAt: string;
  channelCount?: number;
  messageCount?: number;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const generatePassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const values = new Uint32Array(18);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
};

export function ClientManager() {
  const [clients, setClients] = useState<ClientTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    name: "",
    slug: "",
    email: "",
    password: "",
  });

  const voiceBaseUrl = (process.env.NEXT_PUBLIC_VOICE_AGENT_URL || "https://voice-agent.anas31.qzz.io").replace(/\/$/, "");
  const suggestedSlug = useMemo(() => slugify(form.name), [form.name]);

  const fetchClients = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/tenants", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load clients");
      }
      setClients(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "name" && !prev.slug ? { slug: slugify(value) } : {}),
    }));
  };

  const handleGeneratePassword = () => {
    setForm((prev) => ({
      ...prev,
      password: generatePassword(),
    }));
  };

  const createClient = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const initialPassword = form.password;
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          slug: form.slug || suggestedSlug,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create client");
      }
      setForm({ name: "", slug: "", email: "", password: "" });
      setSuccess(`Created ${data.name}. Initial password: ${initialPassword}. Use slug "${data.slug}" in webhook URLs.`);
      await fetchClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-neutral-900/50 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div className="flex items-center gap-3">
          <Building2 className="text-cyan-400" />
          <div>
            <h2 className="text-2xl font-bold">Clients</h2>
            <p className="text-sm text-neutral-400">
              Each client is a tenant with its own login, slug, and channel webhook URLs.
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={fetchClients}
          disabled={loading}
          className="bg-neutral-800 text-neutral-100 hover:bg-neutral-700 border border-white/10"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {success}
        </div>
      ) : null}

      <form onSubmit={createClient} className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="space-y-2 lg:col-span-1">
          <Label htmlFor="client-name">Client Name</Label>
          <Input
            id="client-name"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="bg-neutral-950 border-neutral-800 text-neutral-100"
            placeholder="Acme Corp"
            required
          />
        </div>
        <div className="space-y-2 lg:col-span-1">
          <Label htmlFor="client-slug">Slug</Label>
          <Input
            id="client-slug"
            value={form.slug}
            onChange={(event) => updateField("slug", slugify(event.target.value))}
            className="bg-neutral-950 border-neutral-800 text-neutral-100 font-mono"
            placeholder={suggestedSlug || "acme-corp"}
            required
          />
        </div>
        <div className="space-y-2 lg:col-span-1">
          <Label htmlFor="client-email">Login Email</Label>
          <Input
            id="client-email"
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            className="bg-neutral-950 border-neutral-800 text-neutral-100"
            placeholder="ops@acme.com"
            required
          />
        </div>
        <div className="space-y-2 lg:col-span-1">
          <Label htmlFor="client-password">Initial Password</Label>
          <div className="flex gap-2">
            <Input
              id="client-password"
              type="text"
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              className="bg-neutral-950 border-neutral-800 text-neutral-100 font-mono"
              minLength={8}
              required
            />
            <Button
              type="button"
              onClick={handleGeneratePassword}
              className="bg-neutral-800 text-neutral-100 hover:bg-neutral-700 border border-white/10"
              title="Generate password"
            >
              <KeyRound className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={saving}
            className="w-full bg-cyan-600 text-white hover:bg-cyan-500"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add Client
          </Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-12 gap-3 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            <div className="col-span-3">Client</div>
            <div className="col-span-2">Slug</div>
            <div className="col-span-3">Email</div>
            <div className="col-span-3">Voice Webhook</div>
            <div className="col-span-1 text-right">Channels</div>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading clients...
            </div>
          ) : clients.length === 0 ? (
            <div className="px-4 py-6 text-neutral-500">No clients yet.</div>
          ) : (
            clients.map((client) => (
              <div
                key={client.id}
                className="grid grid-cols-12 gap-3 border-t border-white/5 px-4 py-3 text-sm text-neutral-300 hover:bg-white/[0.03]"
              >
                <div className="col-span-3 font-medium text-white truncate">{client.name}</div>
                <div className="col-span-2 font-mono text-cyan-300 truncate">{client.slug}</div>
                <div className="col-span-3 truncate">{client.email}</div>
                <div className="col-span-3 font-mono text-xs text-neutral-400 truncate">
                  {voiceBaseUrl}/voice/{client.slug}
                </div>
                <div className="col-span-1 text-right">{client.channelCount ?? 0}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
