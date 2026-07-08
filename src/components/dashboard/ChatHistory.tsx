"use client";

import React, { useState, useEffect } from "react";
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

  if (loading) {
    return <div className="text-neutral-400 flex items-center gap-2"><Loader2 className="animate-spin" /> Loading chat history...</div>;
  }

  return (
    <div className="bg-neutral-900/50 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MessageSquare className="text-purple-400" />
          <h2 className="text-2xl font-bold">Recent Messages</h2>
        </div>
        <div className="text-sm text-neutral-400">{messages.length} total</div>
      </div>

      <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
        {messages.length === 0 ? (
          <div className="text-center text-neutral-500 py-8">No messages yet. Configure your channels to start receiving messages.</div>
        ) : (
          messages.map((msg) => {
            const outboundStatus = getOutboundStatus(msg);
            const StatusIcon = outboundStatus?.icon;

            return (
              <div
                key={msg.id}
                className={`border rounded-xl p-4 ${
                  outboundStatus?.label === "Send failed"
                    ? "border-red-500/20 bg-red-950/10"
                    : "border-white/5 bg-black/20"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                      msg.channelType === 'whatsapp' ? 'bg-green-500/20 text-green-400' :
                      msg.channelType === 'instagram' ? 'bg-pink-500/20 text-pink-400' :
                      msg.channelType === 'messenger' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-orange-500/20 text-orange-400'
                    }`}>
                      {msg.channelType.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {new Date(msg.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    {msg.direction === 'inbound' ? (
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
                </div>
                <p className="text-white text-sm whitespace-pre-wrap">{msg.content}</p>
                {outboundStatus?.detail ? (
                  <div className={`mt-2 text-xs ${outboundStatus.className}`}>
                    {outboundStatus.detail}
                  </div>
                ) : null}
                <div className="mt-2 text-xs text-neutral-500 flex gap-4">
                  <span>From: {msg.senderId || 'Unknown'}</span>
                  <span>To: {msg.receiverId || 'Unknown'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
