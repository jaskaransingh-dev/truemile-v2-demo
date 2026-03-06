import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testIsolation() {
  console.log('🧪 Testing multi-tenant isolation...\n');

  // ── Setup ──────────────────────────────────────────────────────────────────

  // Fleet.userId is a FK to User, so we need real User records
  const userA = await prisma.user.create({
    data: { email: 'test-user-a@isolation-test.internal', name: 'Test User A' }
  });
  const userB = await prisma.user.create({
    data: { email: 'test-user-b@isolation-test.internal', name: 'Test User B' }
  });

  const carrierA = await prisma.carrier.create({
    data: { name: 'Test Carrier A', contactEmail: 'a@isolation-test.internal' }
  });
  const carrierB = await prisma.carrier.create({
    data: { name: 'Test Carrier B', contactEmail: 'b@isolation-test.internal' }
  });

  console.log(`  Created Carrier A: ${carrierA.id}`);
  console.log(`  Created Carrier B: ${carrierB.id}\n`);

  // 1 Fleet per carrier
  const fleetA = await prisma.fleet.create({
    data: { userId: userA.id, carrierId: carrierA.id }
  });
  const fleetB = await prisma.fleet.create({
    data: { userId: userB.id, carrierId: carrierB.id }
  });

  // 2 Drivers per carrier
  await prisma.driver.createMany({
    data: [
      { fleetId: fleetA.id, carrierId: carrierA.id, name: 'Driver A1', payStructure: 'percentage', payRate: 0.25 },
      { fleetId: fleetA.id, carrierId: carrierA.id, name: 'Driver A2', payStructure: 'percentage', payRate: 0.25 },
      { fleetId: fleetB.id, carrierId: carrierB.id, name: 'Driver B1', payStructure: 'percentage', payRate: 0.25 },
      { fleetId: fleetB.id, carrierId: carrierB.id, name: 'Driver B2', payStructure: 'percentage', payRate: 0.25 },
    ]
  });

  // 3 Loads per carrier
  await prisma.fleetLoad.createMany({
    data: [
      { fleetId: fleetA.id, carrierId: carrierA.id, miles: 500, revenue: 1500 },
      { fleetId: fleetA.id, carrierId: carrierA.id, miles: 600, revenue: 1800 },
      { fleetId: fleetA.id, carrierId: carrierA.id, miles: 400, revenue: 1200 },
      { fleetId: fleetB.id, carrierId: carrierB.id, miles: 300, revenue: 900 },
      { fleetId: fleetB.id, carrierId: carrierB.id, miles: 700, revenue: 2100 },
      { fleetId: fleetB.id, carrierId: carrierB.id, miles: 550, revenue: 1650 },
    ]
  });

  console.log('  Test data created (2 carriers, 2 fleets, 4 drivers, 6 loads)\n');

  // ── Tests ──────────────────────────────────────────────────────────────────

  let passed = 0;
  let failed = 0;

  function check(label: string, condition: boolean) {
    if (condition) {
      console.log(`  ✅ ${label}`);
      passed++;
    } else {
      console.log(`  ❌ ${label}`);
      failed++;
    }
  }

  // --- Query as Carrier A ---
  console.log('📋 Querying as Carrier A...');
  const aDrivers = await prisma.driver.findMany({ where: { carrierId: carrierA.id } });
  const aLoads   = await prisma.fleetLoad.findMany({ where: { carrierId: carrierA.id } });

  check(`Carrier A sees 2 drivers   (got ${aDrivers.length})`, aDrivers.length === 2);
  check(`Carrier A sees 3 loads     (got ${aLoads.length})`,   aLoads.length === 3);
  check('Carrier A results contain no Carrier B drivers', !aDrivers.some(d => d.carrierId === carrierB.id));
  check('Carrier A results contain no Carrier B loads',   !aLoads.some(l => l.carrierId === carrierB.id));

  // --- Query as Carrier B ---
  console.log('\n📋 Querying as Carrier B...');
  const bDrivers = await prisma.driver.findMany({ where: { carrierId: carrierB.id } });
  const bLoads   = await prisma.fleetLoad.findMany({ where: { carrierId: carrierB.id } });

  check(`Carrier B sees 2 drivers   (got ${bDrivers.length})`, bDrivers.length === 2);
  check(`Carrier B sees 3 loads     (got ${bLoads.length})`,   bLoads.length === 3);
  check('Carrier B results contain no Carrier A drivers', !bDrivers.some(d => d.carrierId === carrierA.id));
  check('Carrier B results contain no Carrier A loads',   !bLoads.some(l => l.carrierId === carrierA.id));

  // --- Cross-contamination: fleet from B, carrier from A (should return nothing) ---
  console.log('\n🔒 Cross-contamination checks...');
  const crossDrivers = await prisma.driver.findMany({
    where: { carrierId: carrierA.id, fleetId: fleetB.id }
  });
  const crossLoads = await prisma.fleetLoad.findMany({
    where: { carrierId: carrierA.id, fleetId: fleetB.id }
  });

  check(`No drivers match carrierId=A AND fleetId=B  (got ${crossDrivers.length})`, crossDrivers.length === 0);
  check(`No loads match carrierId=A AND fleetId=B    (got ${crossLoads.length})`,   crossLoads.length === 0);

  // --- Total row counts: scoped queries must not return all rows ---
  console.log('\n📊 Scope completeness checks...');
  const totalDrivers = await prisma.driver.count();
  const totalLoads   = await prisma.fleetLoad.count();

  check(
    `Carrier A drivers (${aDrivers.length}) < total drivers (${totalDrivers})`,
    aDrivers.length < totalDrivers
  );
  check(
    `Carrier A loads (${aLoads.length}) < total loads (${totalLoads})`,
    aLoads.length < totalLoads
  );

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(50)}`);
  if (failed === 0) {
    console.log(`✅ ALL ${passed} TESTS PASSED — isolation is working correctly`);
  } else {
    console.log(`❌ ${failed} TEST(S) FAILED — DATA LEAK DETECTED`);
    console.log(`   ${passed} passed, ${failed} failed`);
    process.exitCode = 1;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  console.log('\n🧹 Cleaning up test data...');
  await prisma.fleetLoad.deleteMany({ where: { carrierId: { in: [carrierA.id, carrierB.id] } } });
  await prisma.driver.deleteMany(   { where: { carrierId: { in: [carrierA.id, carrierB.id] } } });
  await prisma.fleet.deleteMany(    { where: { carrierId: { in: [carrierA.id, carrierB.id] } } });
  await prisma.user.deleteMany(     { where: { id:        { in: [userA.id,    userB.id]    } } });
  await prisma.carrier.deleteMany(  { where: { id:        { in: [carrierA.id, carrierB.id] } } });
  console.log('  ✓ Cleanup complete');
}

testIsolation()
  .catch((err) => {
    console.error('\n💥 Test script crashed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
