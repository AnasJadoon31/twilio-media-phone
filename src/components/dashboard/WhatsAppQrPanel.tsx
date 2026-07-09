"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle, Power, QrCode, RefreshCw, Settings2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type QrGroup = {
  id: string;
  groupJid: string;
  groupName: string | null;
  isEnabled: boolean;
  replyRule: string;
  keywords: string[];
};

type QrStatus = {
  connected: boolean;
  status: string;
  instanceName?: string;
  qrCode?: string | null;
  qrUpdatedAt?: string | null;
  voiceReplyMode: "voice" | "text" | "both";
  groupKeywords: string[];
  groups: QrGroup[];
};

type QrSettingsPatch = {
  voiceReplyMode?: QrStatus["voiceReplyMode"];
  groupKeywords?: string[];
  groupJid?: string;
  groupName?: string | null;
  isEnabled?: boolean;
  keywords?: string[];
};

function qrImageSrc(qrCode?: string | null) {
  if (!qrCode) return null;
  if (qrCode.startsWith("data:image")) return qrCode;
  if (qrCode.startsWith("http")) return qrCode;
  return `data:image/png;base64,${qrCode}`;
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (["open", "connected", "ready"].includes(normalized)) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (["qr", "connecting"].includes(normalized)) return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-neutral-700 bg-neutral-950 text-neutral-300";
}

export function WhatsAppQrPanel() {
  const [status, setStatus] = useState<QrStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState("");
  const imageSrc = useMemo(() => qrImageSrc(status?.qrCode), [status?.qrCode]);

  async function loadStatus() {
    setError(null);
    try {
      const response = await fetch("/api/whatsapp-qr/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to load QR status.");
      setStatus(data);
      setKeywords(Array.isArray(data.groupKeywords) ? data.groupKeywords.join(", ") : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QR status.");
    } finally {
      setLoading(false);
    }
  }

  async function postJson(url: string, body?: unknown) {
    setError(null);
    const response = await fetch(url, {
      method: url.endsWith("/settings") ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Request failed.");
    return data;
  }

  async function connect() {
    setWorking("connect");
    try {
      const data = await postJson("/api/whatsapp-qr/connect");
      setStatus((current) => ({ ...(current || data), ...data }));
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start QR connection.");
    } finally {
      setWorking(null);
    }
  }

  async function disconnect() {
    setWorking("disconnect");
    try {
      await postJson("/api/whatsapp-qr/disconnect");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect QR account.");
    } finally {
      setWorking(null);
    }
  }

  async function updateSettings(next: QrSettingsPatch) {
    setWorking("settings");
    try {
      await postJson("/api/whatsapp-qr/settings", next);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save QR settings.");
    } finally {
      setWorking(null);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/60 p-4 text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading WhatsApp QR settings...
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-neutral-900/60 p-5">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-lime-300">
            <MessageCircle className="h-4 w-4" />
            WhatsApp QR
          </div>
          <h2 className="text-xl font-semibold text-white">Connect WhatsApp with QR</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Primary WhatsApp rail powered by Evolution. The official Cloud API remains available below as fallback.
          </p>
        </div>
        <Badge variant="outline" className={statusClass(status?.status || "not_configured")}>
          {status?.status || "not configured"}
        </Badge>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-lg border border-white/10 bg-neutral-950 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <QrCode className="h-4 w-4 text-lime-300" />
              QR pairing
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={loadStatus}
              className="border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-neutral-800 bg-white p-3">
            {imageSrc ? (
              <img src={imageSrc} alt="WhatsApp QR code" className="h-full w-full object-contain" />
            ) : (
              <div className="px-3 text-center text-sm text-neutral-500">
                Start or reconnect to generate a QR code.
              </div>
            )}
          </div>

          {status?.qrUpdatedAt ? (
            <div className="mt-2 text-xs text-neutral-500">
              Updated {new Date(status.qrUpdatedAt).toLocaleString()}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            <Button
              type="button"
              onClick={connect}
              disabled={working === "connect"}
              className="bg-lime-600 text-white hover:bg-lime-500"
            >
              {working === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Connect / Reconnect
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={disconnect}
              disabled={working === "disconnect"}
              className="border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-white"
            >
              {working === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              Disconnect
            </Button>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-white/10 bg-neutral-950 p-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Settings2 className="h-4 w-4 text-lime-300" />
              Automation settings
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Voice note reply mode</Label>
                <Select
                  value={status?.voiceReplyMode || "voice"}
                  onValueChange={(value) => updateSettings({ voiceReplyMode: value as QrStatus["voiceReplyMode"] })}
                >
                  <SelectTrigger className="w-full border-neutral-800 bg-neutral-900 text-neutral-100">
                    <SelectValue placeholder="Voice" />
                  </SelectTrigger>
                  <SelectContent className="border-neutral-800 bg-neutral-950 text-neutral-100">
                    <SelectItem value="voice">Voice note</SelectItem>
                    <SelectItem value="text">Text only</SelectItem>
                    <SelectItem value="both">Text and voice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Group trigger keywords</Label>
                <div className="flex gap-2">
                  <Input
                    value={keywords}
                    onChange={(event) => setKeywords(event.target.value)}
                    placeholder="support, agent, help"
                    className="border-neutral-800 bg-neutral-900 text-neutral-100"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updateSettings({ groupKeywords: keywords.split(",").map((item) => item.trim()).filter(Boolean) })}
                    className="border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-neutral-950 p-4">
            <div className="mb-3">
              <div className="text-sm font-semibold text-white">Groups</div>
              <p className="text-xs text-neutral-500">
                Groups are ingested by default. Replies are sent only when a group is enabled and the message mentions, quotes, or matches a keyword.
              </p>
            </div>
            {!status?.groups?.length ? (
              <div className="rounded-md border border-dashed border-neutral-800 px-3 py-8 text-center text-sm text-neutral-500">
                No groups observed yet.
              </div>
            ) : (
              <div className="space-y-2">
                {status.groups.map((group) => (
                  <div key={group.groupJid} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-neutral-900 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-neutral-100">
                        {group.groupName || group.groupJid}
                      </div>
                      <div className="truncate font-mono text-xs text-neutral-500">{group.groupJid}</div>
                    </div>
                    <Switch
                      checked={group.isEnabled}
                      onCheckedChange={(checked) =>
                        updateSettings({
                          groupJid: group.groupJid,
                          groupName: group.groupName,
                          isEnabled: checked,
                          keywords: group.keywords?.length ? group.keywords : keywords.split(",").map((item) => item.trim()).filter(Boolean),
                        })
                      }
                      className="data-[state=checked]:bg-lime-600"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
