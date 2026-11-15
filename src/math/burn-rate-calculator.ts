export interface RunwayMonth {
  /** 1-based month index, month 1 is the month starting today */
  month: number;
  /** Cash in during the month */
  revenue: number;
  /** Cash out during the month */
  spend: number;
  /** spend − revenue. Negative once the month is cash-flow positive. */
  netBurn: number;
  /** Cash left at the end of the month */
  cash: number;
}

export interface BurnRateResult {
  /** Total monthly cash out, ignoring revenue */
  grossBurn: number;
  /** First-month spend − revenue. Negative when the month is cash-flow positive. */
  netBurn: number;
  /** Months until the balance hits zero. Infinity when it never does inside the horizon. */
  runwayMonths: number;
  /** True when the balance reaches zero inside the horizon */
  outOfCash: boolean;
  /** First month where revenue covers spend, or null if it never happens */
  breakEvenMonth: number | null;
  /** Break-even arrives and the balance never hits zero on the way there */
  defaultAlive: boolean;
  /** Month-by-month projection, ending with the month the cash runs out */
  schedule: RunwayMonth[];
  /** Months simulated. 0 signals invalid or empty input. */
  months: number;
}

/** Five years. Past that a runway number stops meaning anything. */
export const MAX_MONTHS = 60;

const EMPTY: BurnRateResult = {
  grossBurn: 0,
  netBurn: 0,
  runwayMonths: 0,
  outOfCash: false,
  breakEvenMonth: null,
  defaultAlive: false,
  schedule: [],
  months: 0,
};

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Project cash runway from a balance, monthly revenue and monthly spend.
 *
 * Revenue and spend are compounded month over month by their own growth rates,
 * so a plan that grows 8 % a month while costs grow 3 % bends the way a real one
 * does instead of running in a straight line. The balance is carried forward
 * month by month; runway is the point where it crosses zero, interpolated inside
 * the final month so the answer is not rounded to a whole month.
 *
 * @param cash            Cash in the bank today.
 * @param monthlyRevenue  Cash collected in month 1 (MRR for a subscription business).
 * @param monthlySpend    Total cash out in month 1 — payroll, rent, tools, taxes.
 * @param revenueGrowthPct Month-over-month revenue growth in percent. Negative = shrinking.
 * @param spendGrowthPct   Month-over-month spend growth in percent. Negative = cutting costs.
 */
export function calculateRunway(
  cash: number,
  monthlyRevenue: number,
  monthlySpend: number,
  revenueGrowthPct = 0,
  spendGrowthPct = 0,
): BurnRateResult {
  if (
    !Number.isFinite(cash) ||
    !Number.isFinite(monthlyRevenue) ||
    !Number.isFinite(monthlySpend) ||
    !Number.isFinite(revenueGrowthPct) ||
    !Number.isFinite(spendGrowthPct) ||
    cash < 0 ||
    monthlyRevenue < 0 ||
    monthlySpend < 0 ||
    revenueGrowthPct <= -100 ||
    spendGrowthPct <= -100 ||
    (monthlyRevenue === 0 && monthlySpend === 0)
  ) {
    return EMPTY;
  }

  const revenueFactor = 1 + revenueGrowthPct / 100;
  const spendFactor = 1 + spendGrowthPct / 100;

  const schedule: RunwayMonth[] = [];
  let balance = cash;
  let runwayMonths = Number.POSITIVE_INFINITY;
  let breakEvenMonth: number | null = null;
  let outOfCash = false;

  for (let month = 1; month <= MAX_MONTHS; month++) {
    const revenue = monthlyRevenue * revenueFactor ** (month - 1);
    const spend = monthlySpend * spendFactor ** (month - 1);
    const netBurn = spend - revenue;
    const opening = balance;

    if (breakEvenMonth === null && netBurn <= 0) breakEvenMonth = month;

    balance -= netBurn;

    schedule.push({
      month,
      revenue: roundCents(revenue),
      spend: roundCents(spend),
      netBurn: roundCents(netBurn),
      cash: roundCents(Math.max(balance, 0)),
    });

    if (balance <= 0) {
      outOfCash = true;
      // Interpolate inside the month: how much of it the opening balance paid for.
      runwayMonths = netBurn > 0 ? month - 1 + Math.max(opening, 0) / netBurn : month - 1;
      break;
    }
  }

  return {
    grossBurn: roundCents(monthlySpend),
    netBurn: roundCents(monthlySpend - monthlyRevenue),
    runwayMonths: outOfCash ? Math.round(runwayMonths * 10) / 10 : Number.POSITIVE_INFINITY,
    outOfCash,
    breakEvenMonth,
    defaultAlive: breakEvenMonth !== null && !outOfCash,
    schedule,
    months: schedule.length,
  };
}
