"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Settings, Save, Loader2, Link as LinkIcon, EyeOff, Eye, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type ChannelConfig = {
  id?: string;
  channelType: string;
  verifyToken: string;
  accessToken: string;
  phoneId: string;
  businessAccountId: string;
  pageId: string;
  isActive: boolean;
};

type ConnectionTestResult = {
  ok: boolean;
  status: "connected" | "warning" | "failed";
  message: string;
  details?: Record<string, unknown>;
};

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp Cloud" },
  { id: "instagram", label: "Instagram" },
  { id: "messenger", label: "Messenger" },
  { id: "twilio_sms", label: "Twilio SMS" },
];

export function TenantConfigPanel() {
  const { data: session } = useSession();
  const [configs, setConfigs] = useState<Record<string, ChannelConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      const res = await fetch("/api/channel-configs");
      if (res.ok) {
        const data: ChannelConfig[] = await res.json();
        const configMap = data.reduce((acc, config) => {
          acc[config.channelType] = config;
          return acc;
        }, {} as Record<string, ChannelConfig>);
        setConfigs(configMap);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (channel: string, field: keyof ChannelConfig, value: string | boolean) => {
    setConfigs((prev) => ({
      ...prev,
      [channel]: {
        ...prev[channel],
        channelType: channel,
        [field]: value,
      } as ChannelConfig,
    }));
  };

  const handleSave = async (channel: string) => {
    setSaving(channel);
    try {
      const config = configs[channel] || { channelType: channel, isActive: true };
      const res = await fetch("/api/channel-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save config");
      }
      setConfigs((prev) => ({ ...prev, [channel]: data }));
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (channel: string) => {
    setTesting(channel);
    try {
      const config = configs[channel] || { channelType: channel, isActive: true };
      const res = await fetch("/api/channel-configs/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [channel]: {
          ok: Boolean(data?.ok),
          status: data?.status || (res.ok ? "connected" : "failed"),
          message: data?.message || (res.ok ? "Connection looks good." : "Connection test failed."),
          details: data?.details,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [channel]: {
          ok: false,
          status: "failed",
          message: err instanceof Error ? err.message : "Connection test failed.",
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const toggleShow = (channel: string) => {
    setShowToken(prev => ({ ...prev, [channel]: !prev[channel] }));
  };

  if (loading) {
    return <div className="text-neutral-400 flex items-center gap-2"><Loader2 className="animate-spin" /> Loading configurations...</div>;
  }

  const slug = (session?.user as any)?.slug || "unknown";
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://yourdomain.com';

  const resultStyle = (result?: ConnectionTestResult) => {
    if (!result) return "border-neutral-800 bg-neutral-950/70 text-neutral-400";
    if (result.status === "connected") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    if (result.status === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    return "border-red-500/30 bg-red-500/10 text-red-300";
  };

  const ResultIcon = ({ result }: { result?: ConnectionTestResult }) => {
    if (!result) return <AlertTriangle size={16} />;
    if (result.status === "connected") return <CheckCircle2 size={16} />;
    if (result.status === "warning") return <AlertTriangle size={16} />;
    return <XCircle size={16} />;
  };

  return (
    <div className="bg-neutral-900/50 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="text-purple-400" />
        <h2 className="text-2xl font-bold">Channel Configurations</h2>
      </div>

      <div className="space-y-8">
        {CHANNELS.map((channel) => (
          <div key={channel.id} className="border border-white/5 bg-black/20 rounded-xl p-5 space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-white">{channel.label}</h3>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <Switch
                    checked={configs[channel.id]?.isActive ?? true}
                    onCheckedChange={(checked) => handleChange(channel.id, "isActive", checked)}
                    className="data-[state=checked]:bg-purple-600"
                  />
                  Active
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2 text-xs font-mono bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 text-neutral-300">
                <LinkIcon size={14} className="text-purple-400 shrink-0" />
                <span className="truncate">{baseUrl}/api/webhooks/{channel.id.replace('_', '-')}/{slug}</span>
              </div>
            </div>

            <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${resultStyle(testResults[channel.id])}`}>
              <ResultIcon result={testResults[channel.id]} />
              <span>
                {testResults[channel.id]?.message || "Not tested yet. Enter credentials, then test the platform connection."}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Verify Token (For Webhook setup)</Label>
                <Input
                  value={configs[channel.id]?.verifyToken || ""}
                  onChange={(e) => handleChange(channel.id, "verifyToken", e.target.value)}
                  className="bg-neutral-950 border-neutral-800 font-mono text-sm"
                  placeholder="e.g. my_custom_verify_token"
                />
              </div>

              <div className="space-y-2">
                <Label>Access Token / API Key</Label>
                <div className="relative">
                  <Input
                    type={showToken[channel.id] ? "text" : "password"}
                    value={configs[channel.id]?.accessToken || ""}
                    onChange={(e) => handleChange(channel.id, "accessToken", e.target.value)}
                    className="bg-neutral-950 border-neutral-800 font-mono text-sm pr-10"
                    placeholder="e.g. EAAGm0Pv..."
                  />
                  <button 
                    onClick={() => toggleShow(channel.id)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                  >
                    {showToken[channel.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {(channel.id === "whatsapp" || channel.id === "twilio_sms") && (
                <div className="space-y-2">
                  <Label>{channel.id === "whatsapp" ? "Phone Number ID" : "Twilio Phone Number"}</Label>
                  <Input
                    value={configs[channel.id]?.phoneId || ""}
                    onChange={(e) => handleChange(channel.id, "phoneId", e.target.value)}
                    className="bg-neutral-950 border-neutral-800 font-mono text-sm"
                  />
                </div>
              )}

              {channel.id === "whatsapp" ? (
                <div className="space-y-2">
                  <Label>WhatsApp Business Account ID</Label>
                  <Input
                    value={configs[channel.id]?.businessAccountId || ""}
                    onChange={(e) => handleChange(channel.id, "businessAccountId", e.target.value)}
                    className="bg-neutral-950 border-neutral-800 font-mono text-sm"
                    placeholder="Optional, but recommended for verification"
                  />
                  <p className="text-xs text-neutral-500">
                    Used to verify the Phone Number ID belongs to the expected WABA.
                  </p>
                </div>
              ) : null}

              {channel.id === "messenger" || channel.id === "instagram" ? (
                <div className="space-y-2">
                  <Label>Page ID</Label>
                  <Input
                    value={configs[channel.id]?.pageId || ""}
                    onChange={(e) => handleChange(channel.id, "pageId", e.target.value)}
                    className="bg-neutral-950 border-neutral-800 font-mono text-sm"
                  />
                </div>
              ): null}
            </div>

            <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                onClick={() => handleTest(channel.id)}
                disabled={testing === channel.id}
                className="bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-white/10"
              >
                {testing === channel.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Test Connection
              </Button>
              <Button 
                onClick={() => handleSave(channel.id)} 
                disabled={saving === channel.id}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saving === channel.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Config
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
