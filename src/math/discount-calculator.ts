export interface DiscountResult {
  /** Price before any discount */
  originalPrice: number;
  /** Price after every discount has been applied */
  finalPrice: number;
  /** Money saved in total */
  savings: number;
  /** Combined discount as a percentage of the original price */
  effectivePercent: number;
  /** Money taken off by the first discount */
  firstDiscountAmount: number;
  /** Price after the first discount, before the second one */
  priceAfterFirst: number;
  /** Money taken off by the second (stacked) discount */
  secondDiscountAmount: number;
  valid: boolean;
}

export interface PercentOffResult {
  discountPercent: number;
  savings: number;
  valid: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}

/**
 * Sale price, discount amount, and savings for an original price and a percentage off.
 * An optional second percentage is stacked on the already-reduced price, which is how
 * "extra 20% off sale items" coupons actually behave.
 */
export function calculateDiscount(
  originalPrice: number,
  discountPercent: number,
  secondPercent = 0,
): DiscountResult {
  const empty: DiscountResult = {
    originalPrice: 0,
    finalPrice: 0,
    savings: 0,
    effectivePercent: 0,
    firstDiscountAmount: 0,
    priceAfterFirst: 0,
    secondDiscountAmount: 0,
    valid: false,
  };

  if (!Number.isFinite(originalPrice) || originalPrice <= 0) return empty;

  const first = clampPercent(discountPercent);
  const second = clampPercent(secondPercent);

  const firstDiscountAmount = (originalPrice * first) / 100;
  const priceAfterFirst = originalPrice - firstDiscountAmount;
  const secondDiscountAmount = (priceAfterFirst * second) / 100;
  const finalPrice = priceAfterFirst - secondDiscountAmount;
  const savings = originalPrice - finalPrice;

  return {
    originalPrice: round2(originalPrice),
    finalPrice: round2(finalPrice),
    savings: round2(savings),
    effectivePercent: round2((savings / originalPrice) * 100),
    firstDiscountAmount: round2(firstDiscountAmount),
    priceAfterFirst: round2(priceAfterFirst),
    secondDiscountAmount: round2(secondDiscountAmount),
    valid: true,
  };
}

/**
 * Reverse lookup: the shop shows an old price and a new price — what is the actual percentage off?
 */
export function calculatePercentOff(originalPrice: number, salePrice: number): PercentOffResult {
  const validOriginal = Number.isFinite(originalPrice) && originalPrice > 0;
  const validSale = Number.isFinite(salePrice) && salePrice >= 0;

  if (!validOriginal || !validSale || salePrice > originalPrice) {
    return { discountPercent: 0, savings: 0, valid: false };
  }

  const savings = originalPrice - salePrice;

  return {
    discountPercent: round2((savings / originalPrice) * 100),
    savings: round2(savings),
    valid: true,
  };
}
