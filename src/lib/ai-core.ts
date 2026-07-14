const DEFAULT_AI_CORE_URL = "https://api.operaios.qzz.io";

type TenantAiSelection = {
  coreAiApi: {
    name: string;
    baseUrl: string;
    apiKey?: string | null;
    isActive: boolean;
  } | null;
};

export function aiCoreBaseUrl() {
  return (process.env.AI_CORE_URL || process.env.NEXT_PUBLIC_AI_CORE_URL || DEFAULT_AI_CORE_URL).replace(/\/$/, "");
}

export function aiCoreApiKey() {
  return process.env.AI_CORE_API_KEY || "dev-secret";
}

export function aiCoreTargetForTenant(tenant?: Partial<TenantAiSelection> | null) {
  const selected = tenant?.coreAiApi?.isActive ? tenant.coreAiApi : null;
  return {
    name: selected?.name || "Default AI Core",
    baseUrl: (selected?.baseUrl || aiCoreBaseUrl()).replace(/\/$/, ""),
    apiKey: selected?.apiKey || aiCoreApiKey(),
    source: selected ? "tenant" : "default",
  };
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

export async function fetchTenantAiCore(tenant: Partial<TenantAiSelection>, path: string, init: RequestInit = {}) {
  const target = aiCoreTargetForTenant(tenant);
  return fetch(`${target.baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "x-internal-api-key": target.apiKey,
      ...(init.headers || {}),
    },
  });
}

export async function callTenantAiCoreInteract(
  tenant: Partial<TenantAiSelection>,
  payload: Record<string, unknown>
) {
  return fetchTenantAiCore(tenant, "/api/v1/call/interact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function extractAiCoreReply(data: any, fallback = "") {
  return data?.reply || data?.response_text || data?.response || data?.text || fallback;
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
