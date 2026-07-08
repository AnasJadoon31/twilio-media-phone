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

  const tenant = await prisma.tenant.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Admin Company',
      slug: 'admin-company',
      passwordHash: hashedPassword,
    },
  });

  console.log(`Default tenant created/verified:`);
  console.log(`Email: ${tenant.email}`);
  console.log(`Password: ${password}`);
  console.log(`Slug: ${tenant.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
