"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import {
  AlertCircle,
  Bell,
  Check,
  ChevronRight,
  Clock3,
  Inbox,
  Instagram,
  Loader2,
  LogOut,
  Merge,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Split,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaPhone } from "@/components/units/MediaPhone";

type ChannelId = "all" | "voice" | "whatsapp_qr" | "whatsapp" | "instagram" | "messenger" | "twilio_sms";

type ChannelSummary = {
  id: ChannelId;
  label: string;
  shortLabel: string;
  configured: boolean;
  isActive: boolean;
  unreadCount: number;
  status: "ready" | "missing" | "paused" | "needs_setup";
};

type ContactIdentity = {
  id: string;
  channelType: ChannelId;
  externalId: string;
  displayName: string | null;
  lastReadAt: string | null;
  createdAt: string | null;
};

type ConversationMessage = {
  id: string;
  contactId: string | null;
  channelType: ChannelId;
  direction: "inbound" | "outbound";
  content: string;
  senderId: string | null;
  receiverId: string | null;
  externalMessageId: string | null;
  createdAt: string | null;
  contactExternalId: string | null;
};

type ContactProfile = {
  id: string;
  displayName: string;
  notes: string | null;
  channels: ChannelId[];
  unreadCount: number;
  lastActivityAt: string | null;
  lastMessageSnippet: string;
  contacts: ContactIdentity[];
  messages: ConversationMessage[];
};

type NotificationItem = {
  id: string;
  type: string;
  channelType: ChannelId | null;
  title: string;
  body: string;
  severity: string;
  readAt: string | null;
  createdAt: string | null;
  profileId: string | null;
  contactId: string | null;
  profile: { id: string; displayName: string | null } | null;
  contact: { id: string; channelType: ChannelId; externalId: string; displayName: string | null } | null;
};

type Overview = {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  channels: ChannelSummary[];
  profiles: ContactProfile[];
  notifications: NotificationItem[];
};

type VoiceCall = {
  session_id: string;
  call_id: string;
  state: string;
  created_at: string;
  updated_at: string;
  tenant_slug: string;
};

const CHANNEL_META: Record<ChannelId, { label: string; short: string; className: string; icon: typeof MessageCircle }> = {
  all: {
    label: "All",
    short: "All",
    className: "border-neutral-700 bg-neutral-900 text-neutral-200",
    icon: Inbox,
  },
  voice: {
    label: "Voice",
    short: "Voice",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    icon: Phone,
  },
  whatsapp: {
    label: "WhatsApp Cloud",
    short: "WA Cloud",
    className: "border-green-500/30 bg-green-500/10 text-green-300",
    icon: MessageCircle,
  },
  whatsapp_qr: {
    label: "WhatsApp QR",
    short: "WA QR",
    className: "border-lime-500/30 bg-lime-500/10 text-lime-300",
    icon: MessageCircle,
  },
  instagram: {
    label: "Instagram",
    short: "IG",
    className: "border-pink-500/30 bg-pink-500/10 text-pink-300",
    icon: Instagram,
  },
  messenger: {
    label: "Messenger",
    short: "MSG",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    icon: MessageCircle,
  },
  twilio_sms: {
    label: "Twilio SMS",
    short: "SMS",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    icon: Smartphone,
  },
};

const aiCoreUrl = (process.env.NEXT_PUBLIC_AI_CORE_URL || "https://api.operaios.qzz.io").replace(/\/$/, "");
const apiKey = "dev-secret";

function formatTime(value: string | null) {
  if (!value) return "No activity";
  return new Date(value).toLocaleString();
}

function trimMiddle(value: string, max = 28) {
  if (value.length <= max) return value;
  const left = Math.ceil((max - 3) / 2);
  const right = Math.floor((max - 3) / 2);
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function channelBadge(channelType: ChannelId) {
  const meta = CHANNEL_META[channelType] || CHANNEL_META.all;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>
      {meta.short}
    </span>
  );
}

function statusLabel(status: ChannelSummary["status"]) {
  if (status === "ready") return "Ready";
  if (status === "paused") return "Paused";
  if (status === "needs_setup") return "Needs setup";
  return "Missing";
}

export function OperatorWorkspace() {
  const { data: session } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<ChannelId>("all");
  const [query, setQuery] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [voiceCalls, setVoiceCalls] = useState<VoiceCall[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const tenantSlug = overview?.tenant.slug || ((session?.user as any)?.slug as string | undefined) || "";

  const loadOverview = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") setLoading(true);
    setRefreshing(true);
    setError(null);

    try {
      const response = await fetch("/api/operator/overview", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to load dashboard.");
      }

      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadVoiceCalls = useCallback(async () => {
    if (!tenantSlug) return;

    setLoadingCalls(true);
    try {
      const response = await fetch(`${aiCoreUrl}/api/v1/calls?limit=50&offset=0`, {
        headers: {
          accept: "application/json",
          "x-internal-api-key": apiKey,
        },
      });

      if (!response.ok) return;

      const data = await response.json();
      const calls = Array.isArray(data) ? data : [];
      setVoiceCalls(calls.filter((call) => call.tenant_slug === tenantSlug));
    } catch (err) {
      console.error("Failed to fetch voice calls", err);
    } finally {
      setLoadingCalls(false);
    }
  }, [tenantSlug]);

  useEffect(() => {
    loadOverview("initial");
  }, [loadOverview]);

  useEffect(() => {
    loadVoiceCalls();
  }, [loadVoiceCalls]);

  useEffect(() => {
    if (!overview?.profiles.length) return;
    if (selectedProfileId && overview.profiles.some((profile) => profile.id === selectedProfileId)) return;
    setSelectedProfileId(overview.profiles[0].id);
  }, [overview, selectedProfileId]);

  const selectedProfile = useMemo(
    () => overview?.profiles.find((profile) => profile.id === selectedProfileId) || null,
    [overview, selectedProfileId]
  );

  const selectedCall = useMemo(
    () => voiceCalls.find((call) => call.call_id === selectedCallId) || null,
    [voiceCalls, selectedCallId]
  );

  const visibleProfiles = useMemo(() => {
    if (!overview) return [];
    const normalizedQuery = query.trim().toLowerCase();

    return overview.profiles.filter((profile) => {
      const matchesChannel =
        activeChannel === "all" ||
        (activeChannel !== "voice" && profile.channels.includes(activeChannel));

      if (!matchesChannel) return false;
      if (!normalizedQuery) return true;

      return (
        profile.displayName.toLowerCase().includes(normalizedQuery) ||
        profile.contacts.some((contact) => contact.externalId.toLowerCase().includes(normalizedQuery)) ||
        profile.lastMessageSnippet.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [activeChannel, overview, query]);

  const visibleCalls = useMemo(() => {
    if (activeChannel !== "all" && activeChannel !== "voice") return [];
    const normalizedQuery = query.trim().toLowerCase();

    return voiceCalls.filter((call) => {
      if (!normalizedQuery) return true;
      return (
        call.call_id.toLowerCase().includes(normalizedQuery) ||
        call.session_id.toLowerCase().includes(normalizedQuery) ||
        call.state.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [activeChannel, query, voiceCalls]);

  const visibleMessages = useMemo(() => {
    if (!selectedProfile) return [];
    if (activeChannel === "all" || activeChannel === "voice") return selectedProfile.messages;
    return selectedProfile.messages.filter((message) => message.channelType === activeChannel);
  }, [activeChannel, selectedProfile]);

  const unreadNotifications = overview?.notifications.filter((notification) => !notification.readAt) || [];

  function handleChannelSelect(channelId: ChannelId) {
    setActiveChannel(channelId);

    if (channelId === "voice") {
      setSelectedProfileId(null);
      loadVoiceCalls();
      return;
    }

    setSelectedCallId(null);
  }

  async function markProfileRead(profileId: string) {
    await fetch(`/api/operator/profiles/${profileId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelType: activeChannel === "voice" ? "all" : activeChannel }),
    });
    await loadOverview();
  }

  async function handleSelectProfile(profile: ContactProfile) {
    setSelectedProfileId(profile.id);
    setSelectedCallId(null);
    if (profile.unreadCount > 0) {
      await markProfileRead(profile.id);
    }
  }

  function toggleProfileSelection(profileId: string) {
    setSelectedProfileIds((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  async function mergeSelectedProfiles() {
    const profileIds = Array.from(selectedProfileIds);
    if (profileIds.length < 2) return;

    const response = await fetch("/api/operator/contacts/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileIds }),
    });

    if (response.ok) {
      const data = await response.json();
      setSelectedProfileIds(new Set());
      setSelectedProfileId(data.profileId);
      await loadOverview();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error || "Unable to merge contacts.");
    }
  }

  async function unmergeContact(contactId: string) {
    const response = await fetch("/api/operator/contacts/unmerge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId }),
    });

    if (response.ok) {
      const data = await response.json();
      setSelectedProfileId(data.profileId);
      await loadOverview();
    } else {
      const data = await response.json().catch(() => null);
      setError(data?.error || "Unable to unmerge contact.");
    }
  }

  async function updateNotifications(action: "read" | "dismiss" | "read_all", ids: string[] = []) {
    const response = await fetch("/api/operator/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids }),
    });

    if (response.ok) {
      await loadOverview();
    }
  }

  function handleNotificationSelect(notification: NotificationItem) {
    if (!notification.profileId || !overview) return;

    const profile = overview.profiles.find((item) => item.id === notification.profileId);
    if (profile) {
      setNotificationsOpen(false);
      handleSelectProfile(profile);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-300" />
        Loading operator workspace...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="border-b border-white/10 bg-neutral-950/95 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-emerald-200">
                {tenantSlug || "tenant"}
              </Badge>
              Operator Workspace
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight text-white">
              {overview?.tenant.name || session?.user?.name || "Tenant Workspace"}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setNotificationsOpen((open) => !open)}
                className="relative border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white"
                aria-label="Open notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifications.length ? (
                  <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unreadNotifications.length}
                  </span>
                ) : null}
              </Button>

              {notificationsOpen ? (
                <div className="absolute right-0 top-11 z-50 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-white/10 bg-neutral-950 shadow-2xl">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 p-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Notifications</div>
                      <div className="text-xs text-neutral-500">
                        {unreadNotifications.length} unread item{unreadNotifications.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => updateNotifications("read_all")}
                      disabled={!unreadNotifications.length}
                      className="border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                    >
                      Mark all
                    </Button>
                  </div>

                  <div className="max-h-[420px] overflow-y-auto p-2">
                    {!overview?.notifications.length ? (
                      <div className="rounded-md border border-dashed border-neutral-800 px-3 py-8 text-center text-sm text-neutral-500">
                        No notifications.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {overview.notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={`rounded-md border p-3 ${
                              notification.readAt
                                ? "border-white/10 bg-neutral-900 text-neutral-400"
                                : "border-emerald-500/30 bg-emerald-500/10 text-neutral-100"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => handleNotificationSelect(notification)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="mb-1 flex items-center gap-2">
                                  {notification.channelType ? channelBadge(notification.channelType) : null}
                                  <span className="truncate text-sm font-medium">{notification.title}</span>
                                </div>
                                <div className="line-clamp-2 text-xs text-neutral-400">{notification.body}</div>
                                <div className="mt-2 flex items-center gap-1 text-[11px] text-neutral-600">
                                  <Clock3 className="h-3 w-3" />
                                  {formatTime(notification.createdAt)}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => updateNotifications("dismiss", [notification.id])}
                                className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-white"
                                aria-label="Dismiss notification"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                loadOverview();
                loadVoiceCalls();
              }}
              className="border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-neutral-800 bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white"
            >
              <Link href="/dashboard/channels">
                <Settings className="h-4 w-4" />
                Channels
              </Link>
            </Button>
            <Button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-4 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 md:mx-6">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      <main className="grid flex-1 gap-4 p-4 md:p-6 xl:min-h-0 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <aside className="flex min-h-[520px] flex-col rounded-lg border border-white/10 bg-neutral-900/60">
          <div className="border-b border-white/10 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Activity</div>
                <div className="text-xs text-neutral-500">Contacts, chats, and calls</div>
              </div>
              {selectedProfileIds.size ? (
                <Button
                  size="sm"
                  onClick={mergeSelectedProfiles}
                  disabled={selectedProfileIds.size < 2}
                  className="bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  <Merge className="h-4 w-4" />
                  Merge
                </Button>
              ) : null}
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search contacts, messages, calls"
                className="h-9 border-neutral-800 bg-neutral-950 pl-9 text-neutral-100 placeholder:text-neutral-600"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(overview?.channels || []).map((channel) => {
                const Icon = CHANNEL_META[channel.id]?.icon || MessageCircle;
                const active = activeChannel === channel.id;

                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => handleChannelSelect(channel.id)}
                    className={`flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition ${
                      active
                        ? "border-emerald-400 bg-emerald-500/15 text-emerald-100"
                        : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{channel.shortLabel}</span>
                    {channel.id === "voice" && voiceCalls.length ? (
                      <span className="rounded-full bg-neutral-700 px-1.5 text-[10px] text-neutral-100">{voiceCalls.length}</span>
                    ) : channel.unreadCount ? (
                      <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] text-white">{channel.unreadCount}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loadingCalls && (activeChannel === "all" || activeChannel === "voice") ? (
              <div className="mb-2 flex items-center gap-2 px-2 py-1 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading voice calls
              </div>
            ) : null}

            {visibleCalls.length ? (
              <div className="mb-3">
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Voice calls
                </div>
                <div className="space-y-1">
                  {visibleCalls.map((call) => {
                    const selected = selectedCallId === call.call_id;
                    return (
                      <button
                        key={call.call_id}
                        type="button"
                        onClick={() => {
                          setSelectedCallId(call.call_id);
                          setSelectedProfileId(null);
                        }}
                        className={`w-full rounded-md border px-3 py-2 text-left transition ${
                          selected
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium text-neutral-100">
                              <Phone className="h-4 w-4 text-emerald-300" />
                              <span className="truncate">{trimMiddle(call.call_id, 24)}</span>
                            </div>
                            <div className="mt-1 text-xs text-neutral-500">{formatTime(call.created_at)}</div>
                          </div>
                          <Badge variant="outline" className="border-neutral-700 bg-neutral-950 text-neutral-400">
                            {call.state}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Conversations
            </div>
            <div className="space-y-1">
              {visibleProfiles.length === 0 ? (
                <div className="rounded-md border border-dashed border-neutral-800 px-3 py-8 text-center text-sm text-neutral-500">
                  No contacts match this view.
                </div>
              ) : (
                visibleProfiles.map((profile) => {
                  const selected = selectedProfileId === profile.id;
                  const checked = selectedProfileIds.has(profile.id);

                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => handleSelectProfile(profile)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition ${
                        selected
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          role="checkbox"
                          aria-checked={checked}
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleProfileSelection(profile.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleProfileSelection(profile.id);
                            }
                          }}
                          className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked ? "border-emerald-400 bg-emerald-500 text-white" : "border-neutral-700 bg-neutral-950"
                          }`}
                        >
                          {checked ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-medium text-white">{profile.displayName}</div>
                            {profile.unreadCount ? (
                              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                                {profile.unreadCount}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {profile.channels.map((channel) => (
                              <span key={channel}>{channelBadge(channel)}</span>
                            ))}
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs text-neutral-500">
                            {profile.lastMessageSnippet || profile.contacts[0]?.externalId || "No messages yet"}
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-600">{formatTime(profile.lastActivityAt)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="min-h-[680px] rounded-lg border border-white/10 bg-neutral-900/60">
            {selectedCall || activeChannel === "voice" ? (
              <div className="flex h-full min-h-[680px] flex-col">
                <div className="border-b border-white/10 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-300">
                        <Phone className="h-4 w-4" />
                        Voice activity
                      </div>
                      <h2 className="truncate text-xl font-semibold text-white">
                        {selectedCall ? selectedCall.call_id : "Live voice panel"}
                      </h2>
                      <p className="mt-1 text-sm text-neutral-500">
                        {selectedCall ? `Session ${selectedCall.session_id}` : "Connect, test, and monitor voice conversations."}
                      </p>
                    </div>
                    {selectedCall ? (
                      <Badge variant="outline" className="border-neutral-700 bg-neutral-950 text-neutral-300">
                        {selectedCall.state}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                        Voice
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <MediaPhone tenantSlug={tenantSlug} embedded compact />
                  {selectedCall ? (
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-md border border-white/10 bg-neutral-950 p-3">
                        <div className="text-xs uppercase tracking-wide text-neutral-500">Started</div>
                        <div className="mt-1 text-neutral-200">{formatTime(selectedCall.created_at)}</div>
                      </div>
                      <div className="rounded-md border border-white/10 bg-neutral-950 p-3">
                        <div className="text-xs uppercase tracking-wide text-neutral-500">Last update</div>
                        <div className="mt-1 text-neutral-200">{formatTime(selectedCall.updated_at)}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : selectedProfile ? (
              <div className="flex h-full min-h-[680px] flex-col">
                <div className="border-b border-white/10 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <UserRound className="h-4 w-4 text-neutral-400" />
                      {selectedProfile.channels.map((channel) => (
                        <span key={channel}>{channelBadge(channel)}</span>
                      ))}
                    </div>
                    <h2 className="truncate text-xl font-semibold text-white">{selectedProfile.displayName}</h2>
                    <div className="mt-1 text-sm text-neutral-500">{formatTime(selectedProfile.lastActivityAt)}</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => markProfileRead(selectedProfile.id)}
                    className="border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-800 hover:text-white"
                  >
                    <Check className="h-4 w-4" />
                    Mark read
                  </Button>
                </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {visibleMessages.length === 0 ? (
                    <div className="flex min-h-[280px] flex-col items-center justify-center text-center text-neutral-500">
                      <MessageCircle className="mb-3 h-10 w-10 text-neutral-700" />
                      <div className="text-sm">No messages in this channel view.</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {visibleMessages.map((message) => {
                        const inbound = message.direction === "inbound";

                        return (
                          <div key={message.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                            <div
                              className={`max-w-[82%] rounded-lg border px-4 py-3 ${
                                inbound
                                  ? "border-blue-500/20 bg-blue-500/10 text-blue-50"
                                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-50"
                              }`}
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                                {channelBadge(message.channelType)}
                                <span>{inbound ? "Inbound" : "Outbound"}</span>
                                <span>{formatTime(message.createdAt)}</span>
                              </div>
                              <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                              <div className="mt-2 text-[11px] text-neutral-500">
                                {trimMiddle(message.contactExternalId || message.senderId || message.receiverId || "unknown", 36)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[680px] flex-col items-center justify-center p-8 text-center text-neutral-500">
                <Inbox className="mb-3 h-10 w-10 text-neutral-700" />
                <div className="text-sm">Select a contact or call to inspect the history.</div>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          {selectedProfile ? (
            <section className="rounded-lg border border-white/10 bg-neutral-900/60 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Contact profile</div>
                  <div className="text-xs text-neutral-500">Merged identities and channels</div>
                </div>
                {selectedProfile.contacts.length > 1 ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                    Merged
                  </Badge>
                ) : null}
              </div>
              <div className="space-y-2">
                {selectedProfile.contacts.map((contact) => (
                  <div key={contact.id} className="rounded-md border border-white/10 bg-neutral-950 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      {channelBadge(contact.channelType)}
                      {selectedProfile.contacts.length > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => unmergeContact(contact.id)}
                          className="h-7 px-2 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                        >
                          <Split className="h-3.5 w-3.5" />
                          Unmerge
                        </Button>
                      ) : null}
                    </div>
                    <div className="font-mono text-xs text-neutral-300">{contact.externalId}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-white/10 bg-neutral-900/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Wifi className="h-4 w-4 text-emerald-300" />
                  Channel health
                </div>
                <div className="text-xs text-neutral-500">Setup status and active channels</div>
              </div>
              <Link href="/dashboard/channels" className="text-xs font-medium text-emerald-300 hover:text-emerald-200">
                Settings
              </Link>
            </div>
            <div className="space-y-2">
              {(overview?.channels || [])
                .filter((channel) => channel.id !== "all")
                .map((channel) => (
                  <div key={channel.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-neutral-950 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {channelBadge(channel.id)}
                      <span className="truncate text-sm text-neutral-300">{channel.label}</span>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        channel.status === "ready"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : channel.status === "paused"
                            ? "bg-neutral-700 text-neutral-300"
                            : "bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      <ChevronRight className="h-3 w-3" />
                      {statusLabel(channel.status)}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
