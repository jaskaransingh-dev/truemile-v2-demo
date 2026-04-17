import { prisma } from '../lib/prisma';

async function importFleetData() {
  console.log('🚀 Starting fleet data import...');

  // Get or create fleet
  let fleet = await prisma.fleet.findUnique({
    where: { userId: 'demo-user' }
  });

  if (!fleet) {
    fleet = await prisma.fleet.create({
      data: { userId: 'demo-user' }
    });
    console.log('✅ Created fleet');
  }

  // Import drivers from existing drivers table
  const drivers = await prisma.$queryRaw<any[]>`
    SELECT id, name, truck_id, pay_rate
    FROM drivers 
    WHERE name IS NOT NULL
    ORDER BY id
  `;

  console.log(`\n👥 Found ${drivers.length} drivers`);
  
  // First create trucks based on driver truck_ids
  console.log('\n🚛 Creating trucks from driver assignments');
  const truckMap = new Map();
  
  for (const driver of drivers) {
    if (driver.truck_id && !truckMap.has(driver.truck_id)) {
      try {
        const truck = await prisma.truck.upsert({
          where: { id: `${fleet.id}-truck-${driver.truck_id}` },
          create: {
            id: `${fleet.id}-truck-${driver.truck_id}`,
            fleetId: fleet.id,
            year: 2019,
            make: 'Freightliner',
            model: `Cascadia #${driver.truck_id}`,
            miles: 450000,
            purchasePrice: 85000,
            status: 'active'
          },
          update: {}
        });
        truckMap.set(driver.truck_id, truck);
        console.log(`  ✅ Created truck #${driver.truck_id}`);
      } catch (error: any) {
        console.error(`  ❌ Failed to create truck ${driver.truck_id}:`, error.message);
      }
    }
  }
  
  // Now import drivers
  for (const row of drivers) {
    try {
      const payRate = parseFloat(row.pay_rate) * 100; // Convert 0.5 to 50%
      
      await prisma.driver.upsert({
        where: { 
          id: `${fleet.id}-driver-${row.id}`
        },
        create: {
          id: `${fleet.id}-driver-${row.id}`,
          fleetId: fleet.id,
          name: row.name,
          payStructure: 'percentage',
          payRate: payRate,
          status: 'active',
          notes: `Truck #${row.truck_id}`
        },
        update: {
          name: row.name,
          payRate: payRate,
          notes: `Truck #${row.truck_id}`
        }
      });
      console.log(`  ✅ Imported driver: ${row.name} (Truck #${row.truck_id}, ${payRate}% pay)`);
    } catch (error: any) {
      console.error(`  ❌ Failed to import driver ${row.name}:`, error.message);
    }
  }

  // Create 3 default trailers (2 reefers, 1 dry van)
  console.log('\n🚚 Creating trailers');
  const trailerTypes = [
    { num: '301', type: 'Reefer', hasReefer: true, make: 'Utility' },
    { num: '302', type: 'Reefer', hasReefer: true, make: 'Great Dane' },
    { num: '303', type: 'Dry Van', hasReefer: false, make: 'Wabash' }
  ];
  
  for (const trailer of trailerTypes) {
    await prisma.trailer.upsert({
      where: { id: `${fleet.id}-trailer-${trailer.num}` },
      create: {
        id: `${fleet.id}-trailer-${trailer.num}`,
        fleetId: fleet.id,
        year: 2018,
        make: trailer.make,
        type: trailer.type,
        length: 53,
        purchasePrice: trailer.hasReefer ? 35000 : 28000,
        hasReefer: trailer.hasReefer,
        status: 'active'
      },
      update: {}
    });
    console.log(`  ✅ Created trailer #${trailer.num}: 2018 ${trailer.make} ${trailer.type}`);
  }

  console.log('\n✅ Fleet data import complete!\n');
  console.log('Summary:');
  console.log(`  👥 ${drivers.length} drivers imported`);
  console.log(`  🚛 ${truckMap.size} trucks created`);
  console.log(`  🚚 ${trailerTypes.length} trailers created`);
  
  process.exit(0);
}

importFleetData().catch((error) => {
  console.error('❌ Import failed:', error);
  process.exit(1);
});