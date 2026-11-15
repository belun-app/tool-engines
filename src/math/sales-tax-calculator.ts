/**
 * Sales tax both ways: the tax and total from a pre-tax price and rate, or the pre-tax price
 * and tax contained in a total.
 */

export type SalesTaxMode = "add" | "remove";

export interface SalesTaxResult {
  /** Price before tax. */
  netAmount: number;
  /** Tax charged on the net amount. */
  taxAmount: number;
  /** What the customer actually pays. */
  grossAmount: number;
  /** Combined rate used for the calculation. */
  ratePercent: number;
  valid: boolean;
}

export interface TaxRateFromPricesResult {
  ratePercent: number;
  taxAmount: number;
  valid: boolean;
}

const EMPTY: SalesTaxResult = {
  netAmount: 0,
  taxAmount: 0,
  grossAmount: 0,
  ratePercent: 0,
  valid: false,
};

/**
 * Rounds half-up to `places` decimals as decimal arithmetic would. Scaling first and
 * trimming the float noise with toPrecision(12) turns 2.175 × 100 = 217.49999999999997
 * back into 217.5, so $30 at 7.25% is 2.18, not 2.17. Adding Number.EPSILON does not
 * help: it is far smaller than the error once the value is above 1.
 */
function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(Number((n * factor).toPrecision(12))) / factor;
}

export function round2(n: number): number {
  return roundTo(n, 2);
}

/** Rates carry three decimals in the wild (New York City is 8.875%), so keep four. */
function round4(n: number): number {
  return roundTo(n, 4);
}

/** Largest amount the calculator accepts: beyond this a double cannot hold the cents. */
export const MAX_AMOUNT = 1e15;

function cleanRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.min(rate, 1000);
}

function cleanAmount(amount: number): number | null {
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) return null;
  return amount;
}

/** A rate a person could mean: 0–100%. Anything else should be flagged, not clamped. */
export function isPlausibleRate(ratePercent: number): boolean {
  return Number.isFinite(ratePercent) && ratePercent >= 0 && ratePercent <= 100;
}

/**
 * US sales tax stacks: state rate, then county, then city, then any special
 * transit or stadium district. They add together, they do not compound.
 */
export function combineTaxRates(...rates: number[]): number {
  let total = 0;
  for (const rate of rates) {
    total += cleanRate(rate);
  }
  return round4(Math.min(total, 1000));
}

/** Forward calculation: a shelf price plus tax. */
export function addSalesTax(netAmount: number, ratePercent: number): SalesTaxResult {
  const net = cleanAmount(netAmount);
  if (net === null) return EMPTY;

  const rate = cleanRate(ratePercent);
  const netRounded = round2(net);
  const taxAmount = round2((net * rate) / 100);
  // Total = the two figures shown, so net + tax always equals the total on screen.
  const grossAmount = round2(netRounded + taxAmount);
  if (!Number.isFinite(grossAmount)) return EMPTY;

  return {
    netAmount: netRounded,
    taxAmount,
    grossAmount,
    ratePercent: rate,
    valid: true,
  };
}

/**
 * Reverse (tax-inclusive) calculation: a receipt total back to the pre-tax price.
 * Dividing by 1 + rate is the part people get wrong — subtracting the rate from
 * the gross gives a different, smaller number.
 */
export function removeSalesTax(grossAmount: number, ratePercent: number): SalesTaxResult {
  const gross = cleanAmount(grossAmount);
  if (gross === null) return EMPTY;

  const rate = cleanRate(ratePercent);
  const grossRounded = round2(gross);
  const netAmount = round2(gross / (1 + rate / 100));

  return {
    netAmount,
    // The tax is what is left of the total once the net is taken out, so the three
    // figures always add up.
    taxAmount: round2(grossRounded - netAmount),
    grossAmount: grossRounded,
    ratePercent: rate,
    valid: true,
  };
}

export function calculateSalesTax(
  amount: number,
  ratePercent: number,
  mode: SalesTaxMode = "add",
): SalesTaxResult {
  return mode === "remove" ? removeSalesTax(amount, ratePercent) : addSalesTax(amount, ratePercent);
}

/** Works the rate back out of a receipt that shows both a subtotal and a total. */
export function taxRateFromPrices(netAmount: number, grossAmount: number): TaxRateFromPricesResult {
  const net = cleanAmount(netAmount);
  const gross = cleanAmount(grossAmount);

  if (net === null || gross === null || net === 0 || gross < net) {
    return { ratePercent: 0, taxAmount: 0, valid: false };
  }

  const taxAmount = gross - net;
  return {
    ratePercent: round4((taxAmount / net) * 100),
    taxAmount: round2(taxAmount),
    valid: true,
  };
}

/**
 * Splits the tax across the jurisdictions that levy it, so a $107.25 receipt can
 * show how much went to the state and how much to the city. The last entry absorbs
 * the rounding remainder, which is how the cents stay consistent with the total.
 * Pass `totalTax` — the tax actually shown — so the parts add up to it in reverse
 * mode too, where the net is itself a rounded result.
 */
export function splitTaxAmount(netAmount: number, rates: number[], totalTax?: number): number[] {
  const net = cleanAmount(netAmount);
  const cleaned = (rates ?? []).map(cleanRate);
  if (net === null || cleaned.length === 0) return cleaned.map(() => 0);

  const total =
    totalTax !== undefined && Number.isFinite(totalTax)
      ? round2(totalTax)
      : addSalesTax(net, combineTaxRates(...cleaned)).taxAmount;
  const parts = cleaned.map((rate) => round2((net * rate) / 100));
  const sum = parts.reduce((a, b) => a + b, 0);

  const lastIndex = parts.length - 1;
  parts[lastIndex] = round2(parts[lastIndex] + (total - sum));
  return parts;
}
