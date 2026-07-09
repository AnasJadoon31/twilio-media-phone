import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const AI_CORE_URL = process.env.AI_CORE_URL?.replace(/\/$/, "") || process.env.NEXT_PUBLIC_AI_CORE_URL?.replace(/\/$/, "");
const AI_CORE_API_KEY = process.env.AI_CORE_API_KEY || "dev-secret";
const VOICE_AGENT_URL = process.env.VOICE_AGENT_URL?.replace(/\/$/, "");
const POLL_INTERVAL_MS = Number(process.env.WHATSAPP_OUTBOX_POLL_INTERVAL_MS || 2500);
const JOB_BATCH_SIZE = Number(process.env.WHATSAPP_OUTBOX_BATCH_SIZE || 5);
const FALLBACK_REPLY = process.env.WHATSAPP_FALLBACK_REPLY || "We will contact you back soon.";
const DEFER_RETRY_MS = Number(process.env.WHATSAPP_DEFER_RETRY_MS || 60_000);

if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!EVOLUTION_API_URL) throw new Error("EVOLUTION_API_URL is required.");
if (!EVOLUTION_API_KEY) throw new Error("EVOLUTION_API_KEY is required.");

const pool = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeNumber(chatId) {
  if (chatId.endsWith("@s.whatsapp.net")) return chatId.replace("@s.whatsapp.net", "");
  if (chatId.endsWith("@c.us")) return chatId.replace("@c.us", "");
  return chatId;
}

function stripDataUri(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/, "");
}

function extractReply(data) {
  for (const key of ["reply", "response_text", "response", "text"]) {
    if (typeof data?.[key] === "string" && data[key].trim()) return data[key].trim();
  }

  if (typeof data?.latest_turn_diagnostic?.response_text === "string") {
    return data.latest_turn_diagnostic.response_text.trim();
  }

  const history = data?.response_history;
  if (Array.isArray(history) && typeof history.at(-1)?.text === "string") {
    return history.at(-1).text.trim();
  }

  return "";
}

function extractProviderMessageId(data) {
  return (
    data?.key?.id ||
    data?.message?.key?.id ||
    data?.id ||
    data?.messageId ||
    data?.data?.key?.id ||
    null
  );
}

async function evolutionRequest(path, init = {}) {
  const response = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...init,
    headers: {
      apikey: EVOLUTION_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Evolution API returned HTTP ${response.status}`);
  }

  return data;
}

async function sendText(instanceName, chatId, text) {
  return evolutionRequest(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({
      number: normalizeNumber(chatId),
      text,
    }),
  });
}

async function sendAudio(instanceName, chatId, audioBase64, audioMime) {
  try {
    return await evolutionRequest(`/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number: normalizeNumber(chatId),
        audio: stripDataUri(audioBase64),
      }),
    });
  } catch {
    return evolutionRequest(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number: normalizeNumber(chatId),
        mediatype: "audio",
        mimetype: audioMime || "audio/ogg; codecs=opus",
        media: stripDataUri(audioBase64),
        fileName: "reply.ogg",
      }),
    });
  }
}

async function callCoreAI({ tenant, text, sourceMessageId, metadata }) {
  if (!AI_CORE_URL) throw new Error("AI_CORE_URL is required for text processing.");

  const response = await fetch(`${AI_CORE_URL}/api/v1/call/interact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-key": AI_CORE_API_KEY,
    },
    body: JSON.stringify({
      company_slug: tenant.slug,
      call_sid: `waqr-${sourceMessageId}`,
      text,
      channel: "whatsapp_qr",
      metadata,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.detail || `AI Core returned HTTP ${response.status}`);

  return {
    replyText: extractReply(data),
    raw: data,
  };
}

async function loadAudioPayload(payload) {
  if (payload.mediaBase64) {
    return Buffer.from(stripDataUri(payload.mediaBase64), "base64");
  }

  if (!payload.mediaUrl) {
    throw new Error("Voice job has no mediaBase64 or mediaUrl.");
  }

  const response = await fetch(payload.mediaUrl, {
    headers: {
      apikey: EVOLUTION_API_KEY,
    },
  });
  if (!response.ok) throw new Error(`Failed to download voice media: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function callVoiceAgent({ tenant, payload, sourceMessageId }) {
  if (!VOICE_AGENT_URL) throw new Error("VOICE_AGENT_URL is required for voice-note processing.");

  const audio = await loadAudioPayload(payload);
  const form = new FormData();
  form.append("audio", new Blob([audio], { type: payload.mimetype || "audio/ogg" }), payload.fileName || "voice.ogg");
  form.append("company_slug", tenant.slug);
  form.append("message_id", sourceMessageId);
  form.append("reply_mode", payload.voiceReplyMode || "voice");
  form.append("chat_id", payload.chatId || "");
  form.append("group_id", payload.groupId || "");
  form.append("participant_id", payload.participantId || "");

  const response = await fetch(`${VOICE_AGENT_URL}/whatsapp/voice-note`, {
    method: "POST",
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.error || `Voice agent returned HTTP ${response.status}`);

  return {
    status: data.status || "ok",
    transcript: data.transcript || "",
    replyText: data.response_text || "",
    audioBase64: data.audio_base64 || "",
    audioMime: data.audio_mime || "audio/ogg; codecs=opus",
    raw: data,
  };
}

async function createOutboundMessage({ job, sourceMessage, payload, replyText, providerMessageId, mediaType }) {
  return prisma.message.create({
    data: {
      tenantId: job.tenantId,
      contactId: job.contactId,
      channelType: "whatsapp_qr",
      direction: "outbound",
      content: replyText || (mediaType ? `[${mediaType}]` : ""),
      senderId: "bot",
      receiverId: sourceMessage?.senderId || payload.participantId || payload.chatId,
      externalMessageId: providerMessageId,
      provider: "evolution",
      chatId: payload.chatId,
      groupId: payload.groupId,
      participantId: payload.participantId,
      mediaType,
      processingStatus: "sent",
      providerPayload: {
        sourceJobId: job.id,
      },
    },
  });
}

async function resolveReplyJid(instanceName, payload) {
  const local = [payload.replyJid, payload.chatId].find(
    (jid) => typeof jid === "string" && jid.endsWith("@lid")
  );
  if (local) return local;

  // Webhook payloads may carry only the phone-number JID even for LID-mode
  // contacts, and WhatsApp rejects sends addressed that way. Evolution's own
  // message store keeps the original @lid JID — look it up by message id.
  if (payload.messageId && instanceName) {
    try {
      const data = await evolutionRequest(`/chat/findMessages/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: JSON.stringify({ where: { key: { id: payload.messageId } }, limit: 1 }),
      });
      const key = data?.messages?.records?.[0]?.key || {};
      const found = [key.remoteJid, key.remoteJidAlt].find(
        (jid) => typeof jid === "string" && jid.endsWith("@lid")
      );
      if (found) {
        console.log(`[whatsapp-worker] resolved reply JID ${found} for msg=${payload.messageId}`);
        return found;
      }
    } catch (error) {
      console.warn(`[whatsapp-worker] reply JID lookup failed msg=${payload.messageId}: ${error?.message || error}`);
    }
  }

  return payload.replyJid || payload.chatId;
}

function isServiceUnavailable(error) {
  const code = error?.cause?.code || error?.code || "";
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|is required for|returned HTTP 502|returned HTTP 503|returned HTTP 504/i.test(message);
}

async function deferJob(job, error) {
  const payload = job.payload || {};

  if (!payload.fallbackSent && payload.instanceName && payload.chatId) {
    try {
      const target = await resolveReplyJid(payload.instanceName, payload);
      await sendText(payload.instanceName, target, FALLBACK_REPLY);
      payload.fallbackSent = true;
      console.log(`[whatsapp-worker] sent fallback reply job=${job.id}`);
    } catch (sendError) {
      console.error(`[whatsapp-worker] fallback send failed job=${job.id}`, sendError);
    }
  }

  await prisma.outboundMessageJob.update({
    where: { id: job.id },
    data: {
      status: "retry",
      lockedAt: null,
      nextRunAt: new Date(Date.now() + DEFER_RETRY_MS),
      lastError: `deferred (upstream unavailable): ${error instanceof Error ? error.message : String(error)}`,
      payload,
    },
  });

  if (job.messageId) {
    await prisma.message.update({
      where: { id: job.messageId },
      data: { processingStatus: "deferred" },
    });
  }
}

async function markRetry(job, error) {
  const attempts = job.attempts + 1;
  const dead = attempts >= job.maxAttempts;
  const delayMs = Math.min(15 * 60_000, 2 ** attempts * 10_000);

  await prisma.outboundMessageJob.update({
    where: { id: job.id },
    data: {
      status: dead ? "dead" : "retry",
      attempts,
      lockedAt: null,
      nextRunAt: new Date(Date.now() + delayMs),
      lastError: error instanceof Error ? error.message : String(error),
    },
  });

  if (job.messageId) {
    await prisma.message.update({
      where: { id: job.messageId },
      data: { processingStatus: dead ? "dead" : "retry" },
    });
  }
}

async function processJob(job) {
  const tenant = job.tenant;
  const payload = job.payload || {};
  const config = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channelType: {
        tenantId: job.tenantId,
        channelType: "whatsapp_qr",
      },
    },
  });

  const instanceName = payload.instanceName || config?.providerInstanceName;
  if (!instanceName) throw new Error("WhatsApp QR instance name is missing.");
  if (!payload.chatId) throw new Error("WhatsApp chat id is missing.");
  const replyJid = await resolveReplyJid(instanceName, payload);

  const sourceMessage = job.message;
  let replyText = "";
  let transcript = "";
  let providerMessageId = null;
  let finalProcessingStatus = "replied";

  if (job.jobType === "whatsapp_qr_text_reply") {
    const result = await callCoreAI({
      tenant,
      text: payload.text || sourceMessage?.content || "",
      sourceMessageId: payload.messageId || sourceMessage?.externalMessageId || job.id,
      metadata: {
        chatId: payload.chatId,
        groupId: payload.groupId,
        participantId: payload.participantId,
      },
    });
    replyText = result.replyText;
    if (!replyText) throw new Error("AI Core returned no reply text.");

    const sendResult = await sendText(instanceName, replyJid, replyText);
    providerMessageId = extractProviderMessageId(sendResult);
    await createOutboundMessage({ job, sourceMessage, payload, replyText, providerMessageId, mediaType: null });
  } else if (job.jobType === "whatsapp_qr_voice_reply") {
    const result = await callVoiceAgent({
      tenant,
      payload,
      sourceMessageId: payload.messageId || sourceMessage?.externalMessageId || job.id,
    });
    transcript = result.transcript;
    replyText = result.replyText;

    const mode = payload.voiceReplyMode || config?.voiceReplyMode || "voice";
    if (result.status === "no_speech") {
      finalProcessingStatus = "no_speech";
    } else if ((mode === "text" || mode === "both") && replyText) {
      const sendResult = await sendText(instanceName, replyJid, replyText);
      providerMessageId = extractProviderMessageId(sendResult) || providerMessageId;
      await createOutboundMessage({ job, sourceMessage, payload, replyText, providerMessageId, mediaType: null });
    }

    if (result.status !== "no_speech" && (mode === "voice" || mode === "both") && result.audioBase64) {
      const sendResult = await sendAudio(instanceName, replyJid, result.audioBase64, result.audioMime);
      providerMessageId = extractProviderMessageId(sendResult) || providerMessageId;
      await createOutboundMessage({
        job,
        sourceMessage,
        payload,
        replyText,
        providerMessageId,
        mediaType: "voice",
      });
    }

    if (result.status !== "no_speech" && !replyText && !result.audioBase64) {
      throw new Error("Voice agent returned no reply.");
    }
  } else {
    throw new Error(`Unsupported job type: ${job.jobType}`);
  }

  await prisma.outboundMessageJob.update({
    where: { id: job.id },
    data: {
      status: "sent",
      attempts: job.attempts + 1,
      sentAt: new Date(),
      lockedAt: null,
      lastError: null,
    },
  });

  if (job.messageId) {
    await prisma.message.update({
      where: { id: job.messageId },
      data: {
        transcript: transcript || undefined,
        processingStatus: finalProcessingStatus,
      },
    });
  }
}

async function claimJobs() {
  const jobs = await prisma.outboundMessageJob.findMany({
    where: {
      channelType: "whatsapp_qr",
      status: { in: ["pending", "retry"] },
      attempts: { lt: 5 },
      nextRunAt: { lte: new Date() },
    },
    include: {
      tenant: true,
      message: true,
    },
    orderBy: { createdAt: "asc" },
    take: JOB_BATCH_SIZE,
  });

  const claimed = [];
  for (const job of jobs) {
    const updated = await prisma.outboundMessageJob.updateMany({
      where: {
        id: job.id,
        status: { in: ["pending", "retry"] },
      },
      data: {
        status: "processing",
        lockedAt: new Date(),
      },
    });
    if (updated.count > 0) claimed.push({ ...job, status: "processing" });
  }
  return claimed;
}

async function tick() {
  const jobs = await claimJobs();
  for (const job of jobs) {
    try {
      await processJob(job);
      console.log(`[whatsapp-worker] sent job=${job.id}`);
    } catch (error) {
      if (isServiceUnavailable(error)) {
        console.warn(`[whatsapp-worker] deferred job=${job.id} (upstream unavailable): ${error?.message || error}`);
        await deferJob(job, error);
      } else {
        console.error(`[whatsapp-worker] failed job=${job.id}`, error);
        await markRetry(job, error);
      }
    }
  }
}

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

console.log("[whatsapp-worker] started");
while (!stopping) {
  await tick();
  await sleep(POLL_INTERVAL_MS);
}

await prisma.$disconnect();
await pool.end();
console.log("[whatsapp-worker] stopped");
