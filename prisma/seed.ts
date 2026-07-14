import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = 'admin@example.com';
  const password = 'password123';
  const hashedPassword = await bcrypt.hash(password, 10);
  const defaultAiCoreUrl = (process.env.AI_CORE_URL || process.env.NEXT_PUBLIC_AI_CORE_URL || 'https://api.operaios.qzz.io').replace(/\/+$/, '');
  const defaultAiCoreApiKey = process.env.AI_CORE_API_KEY || 'dev-secret';

  const coreAiApi = await prisma.coreAiApi.upsert({
    where: { baseUrl: defaultAiCoreUrl },
    update: {
      name: 'Default AI Core',
      apiKey: defaultAiCoreApiKey,
      isActive: true,
    },
    create: {
      name: 'Default AI Core',
      baseUrl: defaultAiCoreUrl,
      apiKey: defaultAiCoreApiKey,
      isActive: true,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { email },
    update: {
      coreAiApiId: coreAiApi.id,
    },
    create: {
      email,
      name: 'Admin Company',
      slug: 'admin-company',
      passwordHash: hashedPassword,
      coreAiApiId: coreAiApi.id,
    },
  });

  console.log(`Default tenant created/verified:`);
  console.log(`Email: ${tenant.email}`);
  console.log(`Password: ${password}`);
  console.log(`Slug: ${tenant.slug}`);
  console.log(`AI Core: ${coreAiApi.baseUrl}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
