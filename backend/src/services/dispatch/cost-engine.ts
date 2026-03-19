import {
  Driver,
  MonthlyExpenses,
  VariableCosts,
  CostMetrics,
} from '../../types/constraint.types';

/**
 * Calculate fixed cost per mile from monthly operating expenses.
 * These are costs that don't change with mileage (truck payment, insurance, etc.)
 */
export function calculateFixedCPM(
  expenses: MonthlyExpenses,
  avgMonthlyMiles: number
): number {
  if (avgMonthlyMiles <= 0) {
    throw new Error('avgMonthlyMiles must be greater than 0');
  }

  const totalMonthlyExpenses =
    expenses.truckPayment +
    expenses.trailerPayment +
    expenses.insurance +
    expenses.prepass +
    expenses.compliance +
    expenses.depreciation +
    (expenses.fixedOverhead ?? 0);

  return totalMonthlyExpenses / avgMonthlyMiles;
}

/**
 * Calculate variable cost per mile from per-mile operating costs.
 * These are costs that scale directly with miles driven.
 */
export function calculateVariableCPM(variableCosts: VariableCosts): number {
  return (
    variableCosts.driverPayPerMile +
    variableCosts.fuelCostPerMile +
    variableCosts.repairReservePerMile +
    (variableCosts.iftaCostPerMile ?? 0) +
    (variableCosts.tollCostPerMile ?? 0)
  );
}

/**
 * Calculate true total cost per mile.
 * This is the all-in cost to operate the truck for one mile.
 */
export function calculateTrueCPM(
  fixedCPM: number,
  variableCPM: number
): number {
  return fixedCPM + variableCPM;
}

/**
 * Calculate survival RPM floor — HARD REJECT threshold.
 * The absolute minimum RPM before a load is losing money.
 *
 * Formula: trueCPM / (1 - survivalMargin)
 * Example: $1.50 trueCPM @ 5% survival margin → $1.58/mile floor
 *
 * Loads below this are REJECTED by the constraint engine.
 */
export function calculateSurvivalRPMFloor(
  trueCPM: number,
  survivalMarginPercent: number = 0.05
): number {
  if (survivalMarginPercent < 0 || survivalMarginPercent >= 1) {
    throw new Error('survivalMarginPercent must be between 0 and 1');
  }

  return trueCPM / (1 - survivalMarginPercent);
}

/**
 * Calculate target RPM floor — SCORING PENALTY threshold.
 * The ideal minimum RPM to hit the driver's target profit margin.
 *
 * Formula: trueCPM / (1 - targetMargin)
 * Example: $1.50 trueCPM @ 15% target margin → $1.76/mile target
 *
 * Loads below this are PENALIZED in scoring, not rejected.
 * A load at $1.70/mile into a strong market may still win on cycle profit.
 */
export function calculateTargetRPMFloor(
  trueCPM: number,
  targetMarginPercent: number = 0.15
): number {
  if (targetMarginPercent <= 0 || targetMarginPercent >= 1) {
    throw new Error('targetMarginPercent must be between 0 and 1');
  }

  return trueCPM / (1 - targetMarginPercent);
}

/**
 * Calculate total monthly revenue needed to hit the target margin.
 */
export function calculateMonthlyRevenueTarget(
  trueCPM: number,
  avgMonthlyMiles: number,
  targetMarginPercent: number
): number {
  const monthlyExpenses = trueCPM * avgMonthlyMiles;
  return monthlyExpenses / (1 - targetMarginPercent);
}

/**
 * Calculate minimum daily revenue to stay on track for monthly target.
 */
export function calculateDailyRevenueFloor(
  monthlyRevenueTarget: number,
  drivingDaysPerMonth: number
): number {
  if (drivingDaysPerMonth <= 0) {
    throw new Error('drivingDaysPerMonth must be greater than 0');
  }

  return monthlyRevenueTarget / drivingDaysPerMonth;
}

/**
 * Calculate all cost metrics for a driver.
 * Main entry point used by the constraint engine and decision engine.
 *
 * Returns both hard constraints (survivalRPMFloor) and
 * scoring targets (targetRPMFloor) derived from the driver's
 * actual operating expenses and margin requirements.
 */
export function calculateCostMetrics(driver: Driver): CostMetrics {
  const fixedCPM = calculateFixedCPM(
    driver.operatingExpenses,
    driver.avgMonthlyMiles
  );

  const variableCPM = calculateVariableCPM(driver.variableCosts);

  const trueCPM = calculateTrueCPM(fixedCPM, variableCPM);

  const survivalRPMFloor = calculateSurvivalRPMFloor(
    trueCPM,
    driver.survivalMarginPercent ?? 0.05
  );

  const targetRPMFloor = calculateTargetRPMFloor(
    trueCPM,
    driver.targetMarginPercent ?? 0.15
  );

  const monthlyRevenueTarget = calculateMonthlyRevenueTarget(
    trueCPM,
    driver.avgMonthlyMiles,
    driver.targetMarginPercent ?? 0.15
  );

  // Driving days per month derived from the driver's OTR cycle ratio
  const cycleDuration = driver.cycleDays + driver.daysOff;
  const drivingDaysPerMonth = (driver.cycleDays / cycleDuration) * 30;

  const dailyRevenueFloor = calculateDailyRevenueFloor(
    monthlyRevenueTarget,
    drivingDaysPerMonth
  );

  return {
    fixedCPM,
    variableCPM,
    trueCPM,
    survivalRPMFloor,
    targetRPMFloor,
    monthlyRevenueTarget,
    dailyRevenueFloor,
  };
}
