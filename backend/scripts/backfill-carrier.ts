import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROYAL_CARRIER_ID = '9b7c4f1e-69e8-4d58-b7a4-887a70f48b72';

async function main() {
  console.log('🚛 Backfill carrier_id → Royal Carriers Inc');
  console.log(`   ID: ${ROYAL_CARRIER_ID}\n`);

  // Verify carrier exists before doing anything
  const carrier = await prisma.carrier.findUnique({ where: { id: ROYAL_CARRIER_ID } });
  if (!carrier) {
    throw new Error(`Carrier ${ROYAL_CARRIER_ID} not found. Did you run seed-carrier.ts?`);
  }
  console.log(`✓ Verified carrier: ${carrier.name}\n`);

  await prisma.$transaction(async (tx) => {

    // ── PascalCase models (carrierId) ──────────────────────────────────────

    const fleetCount = await tx.fleet.count({ where: { carrierId: null } });
    console.log(`Fleet:              ${fleetCount} rows to update`);
    const fleetUpdated = await tx.fleet.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${fleetUpdated.count}`);

    const driverCount = await tx.driver.count({ where: { carrierId: null } });
    console.log(`Driver:             ${driverCount} rows to update`);
    const driverUpdated = await tx.driver.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${driverUpdated.count}`);

    const expenseCount = await tx.expense.count({ where: { carrierId: null } });
    console.log(`Expense:            ${expenseCount} rows to update`);
    const expenseUpdated = await tx.expense.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${expenseUpdated.count}`);

    const fleetLoadCount = await tx.fleetLoad.count({ where: { carrierId: null } });
    console.log(`FleetLoad:          ${fleetLoadCount} rows to update`);
    const fleetLoadUpdated = await tx.fleetLoad.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${fleetLoadUpdated.count}`);

    const truckCount = await tx.truck.count({ where: { carrierId: null } });
    console.log(`Truck:              ${truckCount} rows to update`);
    const truckUpdated = await tx.truck.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${truckUpdated.count}`);

    const trailerCount = await tx.trailer.count({ where: { carrierId: null } });
    console.log(`Trailer:            ${trailerCount} rows to update`);
    const trailerUpdated = await tx.trailer.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${trailerUpdated.count}`);

    const complianceCount = await tx.complianceData.count({ where: { carrierId: null } });
    console.log(`ComplianceData:     ${complianceCount} rows to update`);
    const complianceUpdated = await tx.complianceData.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${complianceUpdated.count}`);

    const brokerStatsCount = await tx.brokerStats.count({ where: { carrierId: null } });
    console.log(`BrokerStats:        ${brokerStatsCount} rows to update`);
    const brokerStatsUpdated = await tx.brokerStats.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${brokerStatsUpdated.count}`);

    const outreachDraftCount = await tx.outreachDraft.count({ where: { carrierId: null } });
    console.log(`OutreachDraft:      ${outreachDraftCount} rows to update`);
    const outreachDraftUpdated = await tx.outreachDraft.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${outreachDraftUpdated.count}`);

    const brokerConvCount = await tx.brokerConversation.count({ where: { carrierId: null } });
    console.log(`BrokerConversation: ${brokerConvCount} rows to update`);
    const brokerConvUpdated = await tx.brokerConversation.updateMany({
      where: { carrierId: null },
      data: { carrierId: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${brokerConvUpdated.count}`);

    // ── DAT models (carrierId) ─────────────────────────────────────────────

    const datKeyCount = await tx.dATIntegrationKey.count({ where: { carrierId: ROYAL_CARRIER_ID } });
    console.log(`DATIntegrationKey:  (${datKeyCount} rows already scoped to carrier — non-nullable, skipping)`);

    const datBatchCount = await tx.dATIngestBatch.count({});
    console.log(`DATIngestBatch:     (${datBatchCount} rows — non-nullable carrierId, skipping)`);

    const datSnapshotCount = await tx.dATLoadSnapshot.count({});
    console.log(`DATLoadSnapshot:    (${datSnapshotCount} rows — non-nullable carrierId, skipping)`);

    const loadRecCount = await tx.loadRecommendation.count({});
    console.log(`LoadRecommendation: (${loadRecCount} rows — non-nullable carrierId, skipping)`);

    // ── snake_case models (carrier_id via $executeRaw) ─────────────────────
    // Prisma updateMany on snake_case models uses the Prisma field name (carrier_id maps to carrierId in Prisma)

    const loadsCount = await tx.loads.count({ where: { carrier_id: null } });
    console.log(`loads:              ${loadsCount} rows to update`);
    const loadsUpdated = await tx.loads.updateMany({
      where: { carrier_id: null },
      data: { carrier_id: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${loadsUpdated.count}`);

    const driversLegacyCount = await tx.drivers.count({ where: { carrier_id: null } });
    console.log(`drivers (legacy):   ${driversLegacyCount} rows to update`);
    const driversLegacyUpdated = await tx.drivers.updateMany({
      where: { carrier_id: null },
      data: { carrier_id: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${driversLegacyUpdated.count}`);

    const expensesLegacyCount = await tx.expenses.count({ where: { carrier_id: null } });
    console.log(`expenses (legacy):  ${expensesLegacyCount} rows to update`);
    const expensesLegacyUpdated = await tx.expenses.updateMany({
      where: { carrier_id: null },
      data: { carrier_id: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${expensesLegacyUpdated.count}`);

    const dispatchCount = await tx.dispatch_plans.count({ where: { carrier_id: null } });
    console.log(`dispatch_plans:     ${dispatchCount} rows to update`);
    const dispatchUpdated = await tx.dispatch_plans.updateMany({
      where: { carrier_id: null },
      data: { carrier_id: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${dispatchUpdated.count}`);

    const outreachEmailCount = await tx.outreach_emails.count({ where: { carrier_id: null } });
    console.log(`outreach_emails:    ${outreachEmailCount} rows to update`);
    const outreachEmailUpdated = await tx.outreach_emails.updateMany({
      where: { carrier_id: null },
      data: { carrier_id: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${outreachEmailUpdated.count}`);

    const loadCandCount = await tx.load_candidates.count({ where: { carrier_id: null } });
    console.log(`load_candidates:    ${loadCandCount} rows to update`);
    const loadCandUpdated = await tx.load_candidates.updateMany({
      where: { carrier_id: null },
      data: { carrier_id: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${loadCandUpdated.count}`);

    const laneRecCount = await tx.lane_recommendations.count({ where: { carrier_id: null } });
    console.log(`lane_recommendations: ${laneRecCount} rows to update`);
    const laneRecUpdated = await tx.lane_recommendations.updateMany({
      where: { carrier_id: null },
      data: { carrier_id: ROYAL_CARRIER_ID },
    });
    console.log(`  ✓ Updated: ${laneRecUpdated.count}`);

  }, {
    timeout: 30000,
  });

  console.log('\n✅ Backfill complete — all existing data linked to Royal Carriers Inc');
}

main()
  .catch((err) => {
    console.error('\n❌ Backfill failed — transaction rolled back');
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
