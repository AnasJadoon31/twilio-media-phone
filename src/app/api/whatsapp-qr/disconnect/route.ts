import prisma from "@/lib/prisma";
import { deleteEvolutionInstance } from "@/lib/evolution";
import { requireTenantSession } from "@/lib/tenant-auth";
import { WHATSAPP_QR_CHANNEL } from "@/lib/whatsapp-qr";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireTenantSession();
  if ("error" in auth) return auth.error;

  const config = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channelType: {
        tenantId: auth.tenantId,
        channelType: WHATSAPP_QR_CHANNEL,
      },
    },
  });

  if (!config) {
    return Response.json({ ok: true, status: "not_configured" });
  }

  if (config.providerInstanceName) {
    try {
      await deleteEvolutionInstance(config.providerInstanceName);
    } catch (error) {
      console.error("Evolution disconnect failed", error);
    }
  }

  await prisma.channelConfig.update({
    where: { id: config.id },
    data: {
      connectionStatus: "disconnected",
      qrCode: null,
      qrUpdatedAt: null,
      providerMetadata: {
        disconnectedAt: new Date().toISOString(),
      },
    },
  });

  return Response.json({ ok: true, status: "disconnected" });
}
