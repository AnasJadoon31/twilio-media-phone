"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MessageSquare, Loader2, ArrowDownLeft, ArrowUpRight, AlertTriangle, CheckCircle2 } from "lucide-react";

type Message = {
  id: string;
  channelType: string;
  direction: string;
  content: string;
  senderId: string | null;
  receiverId: string | null;
  externalMessageId: string | null;
  createdAt: string;
};

type Conversation = {
  key: string;
  channelType: string;
  participantId: string;
  messages: Message[];
  lastMessageAt: string;
};

const channelClass = (channelType: string) => {
  if (channelType === "whatsapp") return "bg-green-500/20 text-green-400";
  if (channelType === "instagram") return "bg-pink-500/20 text-pink-400";
  if (channelType === "messenger") return "bg-blue-500/20 text-blue-400";
  if (channelType === "twilio_sms") return "bg-orange-500/20 text-orange-400";
  return "bg-neutral-500/20 text-neutral-300";
};

const channelLabel = (channelType: string) => {
  if (channelType === "twilio_sms") return "Twilio SMS";
  if (channelType === "messenger") return "Facebook Messenger";
  return channelType.replace("_", " ");
};

function participantForMessage(message: Message) {
  return message.direction === "inbound"
    ? message.senderId || "unknown"
    : message.receiverId || "unknown";
}

function getOutboundStatus(message: Message) {
  if (message.direction !== "outbound") return null;

  if (message.externalMessageId?.startsWith("failed:")) {
    const [, code, ...messageParts] = message.externalMessageId.split(":");
    return {
      label: "Send failed",
      detail: messageParts.join(":") || code || "WhatsApp rejected the send request.",
      className: "text-red-400",
      icon: AlertTriangle,
    };
  }

  if (message.externalMessageId) {
    return {
      label: "Sent",
      detail: `Meta ID: ${message.externalMessageId}`,
      className: "text-emerald-400",
      icon: CheckCircle2,
    };
  }

  return {
    label: "Status unknown",
    detail: "This message was saved before send status tracking was added.",
    className: "text-amber-400",
    icon: AlertTriangle,
  };
}

export function ChatHistory() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMessages();
  }, []);

  const fetchMessages = async () => {
    try {
      const res = await fetch("/api/messages");
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const conversations = useMemo(() => {
    const grouped = new Map<string, Conversation>();

    for (const message of messages) {
      const participantId = participantForMessage(message);
      const key = `${message.channelType}:${participantId}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.messages.push(message);
        if (new Date(message.createdAt) > new Date(existing.lastMessageAt)) {
          existing.lastMessageAt = message.createdAt;
        }
      } else {
        grouped.set(key, {
          key,
          channelType: message.channelType,
          participantId,
          messages: [message],
          lastMessageAt: message.createdAt,
        });
      }
    }

    return Array.from(grouped.values())
      .map((conversation) => ({
        ...conversation,
        messages: [...conversation.messages].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ),
      }))
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }, [messages]);

  if (loading) {
    return <div className="text-neutral-400 flex items-center gap-2"><Loader2 className="animate-spin" /> Loading chat history...</div>;
  }

  return (
    <div className="bg-neutral-900/50 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MessageSquare className="text-cyan-400" />
          <h2 className="text-2xl font-bold">Message Threads</h2>
        </div>
        <div className="text-sm text-neutral-400">
          {conversations.length} thread{conversations.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-4 max-h-[760px] overflow-y-auto pr-2">
        {conversations.length === 0 ? (
          <div className="text-center text-neutral-500 py-8">
            No messages yet. Configure your channels to start receiving messages.
          </div>
        ) : (
          conversations.map((conversation) => (
            <div key={conversation.key} className="border border-white/5 bg-black/20 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-white/[0.03] px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${channelClass(conversation.channelType)}`}>
                      {channelLabel(conversation.channelType)}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {conversation.messages.length} message{conversation.messages.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="font-mono text-sm text-neutral-200 truncate">
                    {conversation.participantId}
                  </div>
                </div>
                <div className="text-xs text-neutral-500 whitespace-nowrap">
                  {new Date(conversation.lastMessageAt).toLocaleString()}
                </div>
              </div>

              <div className="space-y-3 p-4">
                {conversation.messages.map((message) => {
                  const outboundStatus = getOutboundStatus(message);
                  const StatusIcon = outboundStatus?.icon;
                  const isInbound = message.direction === "inbound";

                  return (
                    <div
                      key={message.id}
                      className={`rounded-lg border p-3 ${
                        outboundStatus?.label === "Send failed"
                          ? "border-red-500/20 bg-red-950/10"
                          : isInbound
                            ? "border-blue-500/10 bg-blue-500/5"
                            : "border-purple-500/10 bg-purple-500/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-1 text-xs">
                          {isInbound ? (
                            <span className="text-blue-400 flex items-center gap-1"><ArrowDownLeft size={14} /> Inbound</span>
                          ) : outboundStatus ? (
                            <span className={`${outboundStatus.className} flex items-center gap-1`}>
                              {StatusIcon ? <StatusIcon size={14} /> : <ArrowUpRight size={14} />}
                              {outboundStatus.label}
                            </span>
                          ) : (
                            <span className="text-purple-400 flex items-center gap-1"><ArrowUpRight size={14} /> Outbound</span>
                          )}
                        </div>
                        <span className="text-xs text-neutral-500">
                          {new Date(message.createdAt).toLocaleString()}
                        </span>
                      </div>

                      <p className="text-white text-sm whitespace-pre-wrap">{message.content}</p>

                      {outboundStatus?.detail ? (
                        <div className={`mt-2 text-xs ${outboundStatus.className}`}>
                          {outboundStatus.detail}
                        </div>
                      ) : null}

                      <div className="mt-2 text-xs text-neutral-500 flex flex-wrap gap-x-4 gap-y-1">
                        <span>From: {message.senderId || "Unknown"}</span>
                        <span>To: {message.receiverId || "Unknown"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
