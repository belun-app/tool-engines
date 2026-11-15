export interface AmortizationEntry {
  /** 1-based payment number */
  period: number;
  /** Payment made this period */
  payment: number;
  /** Portion of the payment that went to principal */
  principal: number;
  /** Portion of the payment that went to interest */
  interest: number;
  /** Remaining balance after this payment */
  balance: number;
}

export interface LoanResult {
  monthlyPayment: number;
  totalPayment: number;
  totalInterest: number;
  /** Number of monthly payments */
  months: number;
  schedule: AmortizationEntry[];
  /**
   * Set when nothing could be calculated; every number is then 0 and the schedule empty.
   * Absent on success.
   * - `invalid-principal`: not a finite number above 0.
   * - `invalid-rate`: not a finite number, or below 0.
   * - `invalid-term`: not a finite number, or shorter than half a month (rounds to 0 payments).
   */
  error?: LoanErrorCode;
}

export type LoanErrorCode = "invalid-principal" | "invalid-rate" | "invalid-term";

const fail = (error: LoanErrorCode): LoanResult => ({
  monthlyPayment: 0,
  totalPayment: 0,
  totalInterest: 0,
  months: 0,
  schedule: [],
  error,
});

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate a fixed-rate amortizing loan.
 *
 * @param principal     Loan amount (the borrowed sum).
 * @param annualRatePct Annual interest rate as a percentage (e.g. 5.5 for 5.5%).
 * @param years         Loan term in years. May be fractional.
 */
export function calculateLoan(principal: number, annualRatePct: number, years: number): LoanResult {
  if (typeof principal !== "number" || !Number.isFinite(principal) || principal <= 0) {
    return fail("invalid-principal");
  }
  if (typeof annualRatePct !== "number" || !Number.isFinite(annualRatePct) || annualRatePct < 0) {
    return fail("invalid-rate");
  }
  if (typeof years !== "number" || !Number.isFinite(years) || years <= 0) {
    return fail("invalid-term");
  }

  const months = Math.round(years * 12);
  if (months <= 0) return fail("invalid-term");

  const monthlyRate = annualRatePct / 100 / 12;

  let rawPayment: number;
  if (monthlyRate === 0) {
    rawPayment = principal / months;
  } else {
    const factor = (1 + monthlyRate) ** months;
    rawPayment = (principal * monthlyRate * factor) / (factor - 1);
  }

  const payment = roundCents(rawPayment);

  const schedule: AmortizationEntry[] = [];
  let balance = principal;
  let totalInterest = 0;
  let totalPayment = 0;

  for (let period = 1; period <= months; period++) {
    const interest = roundCents(balance * monthlyRate);
    let principalPart = roundCents(payment - interest);
    let thisPayment = payment;

    // On the final period (or whenever rounding would overshoot), settle the
    // remaining balance exactly so the schedule ends at zero.
    if (period === months || principalPart >= balance) {
      principalPart = roundCents(balance);
      thisPayment = roundCents(principalPart + interest);
      balance = 0;
    } else {
      balance = roundCents(balance - principalPart);
    }

    totalInterest = roundCents(totalInterest + interest);
    totalPayment = roundCents(totalPayment + thisPayment);

    schedule.push({
      period,
      payment: thisPayment,
      principal: principalPart,
      interest,
      balance,
    });
  }

  return {
    monthlyPayment: payment,
    totalPayment,
    totalInterest,
    months,
    schedule,
  };
}
