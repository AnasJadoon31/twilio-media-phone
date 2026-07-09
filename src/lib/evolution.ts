const DEFAULT_TIMEOUT_MS = 30_000;

export type EvolutionConnectionState = {
  instance?: {
    instanceName?: string;
    state?: string;
    status?: string;
    owner?: string;
    profileName?: string;
  };
  state?: string;
  status?: string;
  qrcode?: {
    code?: string;
    base64?: string;
  };
  base64?: string;
  code?: string;
  [key: string]: unknown;
};

export type EvolutionSendTextPayload = {
  number: string;
  text: string;
  delay?: number;
  quoted?: Record<string, unknown>;
};

export type EvolutionSendMediaPayload = {
  number: string;
  mediatype: "image" | "video" | "document" | "audio";
  mimetype: string;
  media: string;
  fileName?: string;
  caption?: string;
  delay?: number;
};

function evolutionBaseUrl() {
  const baseUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("EVOLUTION_API_URL is not configured.");
  }
  return baseUrl;
}

function evolutionApiKey() {
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiKey) {
    throw new Error("EVOLUTION_API_KEY is not configured.");
  }
  return apiKey;
}

async function evolutionRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${evolutionBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: evolutionApiKey(),
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message =
        typeof data?.message === "string"
          ? data.message
          : typeof data?.error === "string"
            ? data.error
            : `Evolution API returned HTTP ${response.status}`;
      throw new Error(message);
    }

    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function qrInstanceName(tenantId: string) {
  return `tenant_${tenantId.replace(/[^a-zA-Z0-9]/g, "")}_whatsapp_qr`;
}

export function normalizeWhatsAppNumber(chatId: string) {
  if (chatId.endsWith("@s.whatsapp.net")) return chatId.replace("@s.whatsapp.net", "");
  if (chatId.endsWith("@c.us")) return chatId.replace("@c.us", "");
  return chatId;
}

export function extractEvolutionQr(data: any) {
  return (
    data?.qrcode?.base64 ||
    data?.qrcode?.code ||
    data?.base64 ||
    data?.code ||
    data?.qr ||
    data?.data?.qrcode?.base64 ||
    data?.data?.base64 ||
    null
  );
}

export function extractEvolutionStatus(data: any) {
  return (
    data?.instance?.state ||
    data?.instance?.status ||
    data?.state ||
    data?.status ||
    data?.connection ||
    data?.data?.state ||
    "unknown"
  );
}

export async function createEvolutionInstance(instanceName: string) {
  return evolutionRequest<any>("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      rejectCall: false,
      msgCall: "Calls are not supported by this assistant.",
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    }),
  });
}

export async function connectEvolutionInstance(instanceName: string) {
  return evolutionRequest<EvolutionConnectionState>(`/instance/connect/${encodeURIComponent(instanceName)}`, {
    method: "GET",
  });
}

export async function getEvolutionConnectionState(instanceName: string) {
  return evolutionRequest<EvolutionConnectionState>(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
    method: "GET",
  });
}

export async function deleteEvolutionInstance(instanceName: string) {
  return evolutionRequest<any>(`/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: "DELETE",
  });
}

export async function setEvolutionWebhook(instanceName: string, webhookUrl: string) {
  return evolutionRequest<any>(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: {},
        byEvents: false,
        base64: true,
        events: [
          "QRCODE_UPDATED",
          "CONNECTION_UPDATE",
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "MESSAGES_DELETE",
          "SEND_MESSAGE",
          "GROUPS_UPSERT",
          "GROUPS_UPDATE",
        ],
      },
    }),
  });
}

export async function sendEvolutionText(instanceName: string, payload: EvolutionSendTextPayload) {
  return evolutionRequest<any>(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendEvolutionMedia(instanceName: string, payload: EvolutionSendMediaPayload) {
  return evolutionRequest<any>(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendEvolutionAudio(instanceName: string, payload: EvolutionSendMediaPayload) {
  try {
    return await evolutionRequest<any>(`/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        number: payload.number,
        audio: payload.media,
        delay: payload.delay,
      }),
    });
  } catch {
    return sendEvolutionMedia(instanceName, payload);
  }
}
