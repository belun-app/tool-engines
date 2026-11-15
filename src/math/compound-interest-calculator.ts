export interface YearlyGrowthEntry {
  /** 1-based year number */
  year: number;
  /** Money deposited during this year (initial principal counts toward year 1) */
  deposits: number;
  /** Interest earned during this year */
  interest: number;
  /** Balance at the end of this year */
  balance: number;
}

/** Why there is no result; the page shows a message for each code. */
export type CompoundInterestError =
  /** A required field is empty or not a number, or there is nothing to grow. */
  | "invalid"
  /** The term rounds to less than one month. */
  | "term-too-short"
  /** More than MAX_YEARS: a 100 000-year table would freeze the tab. */
  | "term-too-long"
  /** −100 % or lower: the balance would go below zero. */
  | "rate-too-low"
  /** The result does not fit in a number. */
  | "overflow";

/** Longest term the calculator accepts, in years. */
export const MAX_YEARS = 100;

/** How often contributions are made, in months: monthly, quarterly, twice a year, yearly. */
export type ContributionEvery = 1 | 3 | 6 | 12;

export interface CompoundInterestOptions {
  /** Months between contributions. Default 1 (monthly). */
  contributionEvery?: ContributionEvery;
  /** "end" (default): added at the end of the period; "start": at its start, so it earns that period too. */
  contributionTiming?: "start" | "end";
}

export interface CompoundInterestResult {
  /** Null when there is a result. */
  error: CompoundInterestError | null;
  finalAmount: number;
  /** Initial principal plus all periodic contributions */
  totalDeposits: number;
  totalInterest: number;
  /** Number of months simulated */
  months: number;
  /** Effective annual rate (APY) in percent for the chosen compounding. */
  effectiveRate: number;
  schedule: YearlyGrowthEntry[];
}

function empty(error: CompoundInterestError): CompoundInterestResult {
  return {
    error,
    finalAmount: 0,
    totalDeposits: 0,
    totalInterest: 0,
    months: 0,
    effectiveRate: 0,
    schedule: [],
  };
}

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate compound growth of an investment or savings balance.
 *
 * Interest accrues monthly at the effective rate implied by the nominal
 * annual rate and the compounding frequency, so the principal grows exactly
 * as P × (1 + r/n)^(n·t). Contributions are added at the end of each month.
 *
 * @param principal           Starting amount. May be 0 when contributing monthly.
 * @param annualRatePct       Nominal annual interest rate as a percentage (e.g. 7 for 7%).
 * @param years               Investment term in years. May be fractional.
 * @param compoundsPerYear    Compounding frequency (1, 2, 4, 12, 52, or 365).
 * @param contribution        Amount added every `options.contributionEvery` months
 *                            (monthly by default). Defaults to 0.
 *
 * The term is counted in whole months (1.04 years is 12 months, 2.5 years is 30).
 * A negative rate (fees, a currency losing value) is allowed above −100 %.
 */
export function calculateCompoundInterest(
  principal: number,
  annualRatePct: number,
  years: number,
  compoundsPerYear: number,
  contribution = 0,
  options: CompoundInterestOptions = {},
): CompoundInterestResult {
  const every = options.contributionEvery ?? 1;
  const atStart = options.contributionTiming === "start";
  if (
    !Number.isFinite(principal) ||
    !Number.isFinite(annualRatePct) ||
    !Number.isFinite(years) ||
    !Number.isFinite(compoundsPerYear) ||
    !Number.isFinite(contribution) ||
    principal < 0 ||
    years <= 0 ||
    compoundsPerYear < 1 ||
    contribution < 0 ||
    ![1, 3, 6, 12].includes(every) ||
    (principal === 0 && contribution === 0)
  ) {
    return empty("invalid");
  }
  if (annualRatePct <= -100) return empty("rate-too-low");
  if (years > MAX_YEARS) return empty("term-too-long");

  const months = Math.round(years * 12);
  if (months <= 0) return empty("term-too-short");

  const rate = annualRatePct / 100;
  const monthlyRate = (1 + rate / compoundsPerYear) ** (compoundsPerYear / 12) - 1;

  const schedule: YearlyGrowthEntry[] = [];
  let balance = principal;
  let yearDeposits = principal;
  let yearInterest = 0;
  let deposited = principal;

  for (let month = 1; month <= months; month++) {
    // A contribution falls in this month when the period (every N months) starts
    // (timing "start") or ends (timing "end") here.
    const due = atStart ? (month - 1) % every === 0 : month % every === 0;
    const before = atStart && due ? contribution : 0;
    const after = !atStart && due ? contribution : 0;
    balance += before;
    const interest = balance * monthlyRate;
    balance += interest + after;
    yearInterest += interest;
    yearDeposits += before + after;
    deposited += before + after;

    if (month % 12 === 0 || month === months) {
      schedule.push({
        year: Math.ceil(month / 12),
        deposits: roundCents(yearDeposits),
        interest: roundCents(yearInterest),
        balance: roundCents(balance),
      });
      yearDeposits = 0;
      yearInterest = 0;
    }
  }

  if (!Number.isFinite(balance) || Math.abs(balance) > Number.MAX_SAFE_INTEGER) {
    return empty("overflow");
  }

  const finalAmount = roundCents(balance);
  const totalDeposits = roundCents(deposited);

  return {
    error: null,
    finalAmount,
    totalDeposits,
    totalInterest: roundCents(finalAmount - totalDeposits),
    months,
    effectiveRate: ((1 + rate / compoundsPerYear) ** compoundsPerYear - 1) * 100,
    schedule,
  };
}

export interface DepositTaxYear {
  year: number;
  interest: number;
  /** Interest above the tax-free allowance. */
  taxable: number;
  tax: number;
}

export interface DepositTaxResult {
  /** Tax-free interest per year: 1 000 000 ₽ × the highest key rate of the year. */
  allowance: number;
  totalTax: number;
  /** Interest left after tax. */
  netInterest: number;
  byYear: DepositTaxYear[];
}

/** Russian personal income tax (NDFL) on deposit interest, 2025 rules. */
export const RU_DEPOSIT_TAX = {
  /** The allowance is this amount times the key rate. */
  allowanceBase: 1_000_000,
  /** 13 % up to this much taxable income a year, 15 % above it. */
  bracket: 2_400_000,
  lowRate: 0.13,
  highRate: 0.15,
} as const;

/**
 * NDFL on deposit interest, year by year: interest above 1 000 000 ₽ × key rate
 * is taxed at 13 % (15 % on the part above 2.4 million ₽). Treats each row of the
 * schedule as one calendar year and ignores interest from other deposits, so it
 * is an estimate for a single deposit.
 */
export function depositTax(schedule: YearlyGrowthEntry[], keyRatePct: number): DepositTaxResult {
  const key = Number.isFinite(keyRatePct) && keyRatePct > 0 ? keyRatePct : 0;
  const allowance = roundCents((RU_DEPOSIT_TAX.allowanceBase * key) / 100);
  const byYear = schedule.map((row) => {
    const interest = Math.max(0, row.interest);
    const taxable = Math.max(0, interest - allowance);
    const low = Math.min(taxable, RU_DEPOSIT_TAX.bracket);
    const high = Math.max(0, taxable - RU_DEPOSIT_TAX.bracket);
    const tax = roundCents(low * RU_DEPOSIT_TAX.lowRate + high * RU_DEPOSIT_TAX.highRate);
    return { year: row.year, interest: row.interest, taxable: roundCents(taxable), tax };
  });
  const totalTax = roundCents(byYear.reduce((sum, y) => sum + y.tax, 0));
  const totalInterest = schedule.reduce((sum, y) => sum + y.interest, 0);
  return { allowance, totalTax, netInterest: roundCents(totalInterest - totalTax), byYear };
}
