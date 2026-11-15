/**
 * Fixed-rate mortgage payment from home price, down payment, rate and term, with property
 * tax, insurance, PMI and HOA, and the full amortization schedule.
 */

export interface MortgageAmortizationEntry {
  /** 1-based payment number */
  period: number;
  /** Principal + interest payment made this period */
  payment: number;
  /** Portion of the payment that went to principal */
  principal: number;
  /** Portion of the payment that went to interest */
  interest: number;
  /** Remaining loan balance after this payment */
  balance: number;
}

export interface MortgageInput {
  /** Purchase price of the home */
  homePrice: number;
  /** Down payment, in the same currency as homePrice (not a percentage) */
  downPayment: number;
  /** Annual mortgage interest rate as a percentage (e.g. 6.5 for 6.5%) */
  annualRatePct: number;
  /** Loan term in years */
  years: number;
  /** Annual property tax, in currency (0 if unknown) */
  annualPropertyTax?: number;
  /** Annual homeowners insurance, in currency (0 if unknown) */
  annualHomeInsurance?: number;
  /** Monthly HOA / condo fees, in currency (0 if none) */
  monthlyHoa?: number;
  /** Annual private mortgage insurance rate, as a percentage of the loan amount; only applied when the down payment is below 20% */
  pmiAnnualRatePct?: number;
}

export interface MortgageResult {
  loanAmount: number;
  downPaymentPercent: number;
  monthlyPrincipalInterest: number;
  monthlyPropertyTax: number;
  monthlyHomeInsurance: number;
  monthlyPmi: number;
  monthlyHoa: number;
  monthlyTotal: number;
  totalInterest: number;
  totalPrincipalInterest: number;
  months: number;
  schedule: MortgageAmortizationEntry[];
}

const EMPTY: MortgageResult = {
  loanAmount: 0,
  downPaymentPercent: 0,
  monthlyPrincipalInterest: 0,
  monthlyPropertyTax: 0,
  monthlyHomeInsurance: 0,
  monthlyPmi: 0,
  monthlyHoa: 0,
  monthlyTotal: 0,
  totalInterest: 0,
  totalPrincipalInterest: 0,
  months: 0,
  schedule: [],
};

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateMortgage(input: MortgageInput): MortgageResult {
  const {
    homePrice,
    downPayment,
    annualRatePct,
    years,
    annualPropertyTax = 0,
    annualHomeInsurance = 0,
    monthlyHoa = 0,
    pmiAnnualRatePct = 0,
  } = input;

  if (
    !Number.isFinite(homePrice) ||
    !Number.isFinite(downPayment) ||
    !Number.isFinite(annualRatePct) ||
    !Number.isFinite(years) ||
    homePrice <= 0 ||
    downPayment < 0 ||
    downPayment >= homePrice ||
    years <= 0 ||
    annualRatePct < 0
  ) {
    return EMPTY;
  }

  const loanAmount = roundCents(homePrice - downPayment);
  const months = Math.round(years * 12);
  if (months <= 0 || loanAmount <= 0) return EMPTY;

  const monthlyRate = annualRatePct / 100 / 12;

  let rawPayment: number;
  if (monthlyRate === 0) {
    rawPayment = loanAmount / months;
  } else {
    const factor = (1 + monthlyRate) ** months;
    rawPayment = (loanAmount * monthlyRate * factor) / (factor - 1);
  }

  const monthlyPrincipalInterest = roundCents(rawPayment);

  const schedule: MortgageAmortizationEntry[] = [];
  let balance = loanAmount;
  let totalInterest = 0;
  let totalPrincipalInterest = 0;

  for (let period = 1; period <= months; period++) {
    const interest = roundCents(balance * monthlyRate);
    let principalPart = roundCents(monthlyPrincipalInterest - interest);
    let thisPayment = monthlyPrincipalInterest;

    if (period === months || principalPart >= balance) {
      principalPart = roundCents(balance);
      thisPayment = roundCents(principalPart + interest);
      balance = 0;
    } else {
      balance = roundCents(balance - principalPart);
    }

    totalInterest = roundCents(totalInterest + interest);
    totalPrincipalInterest = roundCents(totalPrincipalInterest + thisPayment);

    schedule.push({ period, payment: thisPayment, principal: principalPart, interest, balance });
  }

  const downPaymentPercent = Math.round((downPayment / homePrice) * 1000) / 10;
  const monthlyPropertyTax = roundCents(annualPropertyTax / 12);
  const monthlyHomeInsurance = roundCents(annualHomeInsurance / 12);
  const monthlyPmi =
    downPaymentPercent < 20 && pmiAnnualRatePct > 0
      ? roundCents((loanAmount * (pmiAnnualRatePct / 100)) / 12)
      : 0;
  const monthlyTotal = roundCents(
    monthlyPrincipalInterest +
      monthlyPropertyTax +
      monthlyHomeInsurance +
      monthlyPmi +
      Math.max(0, monthlyHoa),
  );

  return {
    loanAmount,
    downPaymentPercent,
    monthlyPrincipalInterest,
    monthlyPropertyTax,
    monthlyHomeInsurance,
    monthlyPmi,
    monthlyHoa: roundCents(Math.max(0, monthlyHoa)),
    monthlyTotal,
    totalInterest,
    totalPrincipalInterest,
    months,
    schedule,
  };
}
