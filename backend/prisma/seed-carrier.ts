import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const carrier = await prisma.carrier.create({
    data: {
      name: 'Royal Carriers Inc',
      mcNumber: '048737',
      contactEmail: 'royalcarrier3@gmail.com',
      contactPhone: '469-394-7061'
    }
  });

  console.log('✓ Created carrier:', carrier.id);
  console.log('  Name:', carrier.name);
  console.log('  MC:', carrier.mcNumber);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
