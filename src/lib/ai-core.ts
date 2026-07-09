const DEFAULT_AI_CORE_URL = "https://api.operaios.qzz.io";

export function aiCoreBaseUrl() {
  return (process.env.AI_CORE_URL || process.env.NEXT_PUBLIC_AI_CORE_URL || DEFAULT_AI_CORE_URL).replace(/\/$/, "");
}

export function aiCoreApiKey() {
  return process.env.AI_CORE_API_KEY || "dev-secret";
}

export async function fetchAiCore(path: string, init: RequestInit = {}) {
  return fetch(`${aiCoreBaseUrl()}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "x-internal-api-key": aiCoreApiKey(),
      ...(init.headers || {}),
    },
  });
}

export async function readAiCoreJson(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}
