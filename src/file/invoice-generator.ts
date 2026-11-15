/**
 * Invoice math + PDF plumbing for the client-side invoice generator.
 *
 * The totals are pure arithmetic here; the actual document is drawn onto a canvas in the
 * mount (so any script or currency symbol renders exactly as the browser draws it) and
 * packed into a PDF by the shared image-PDF writer from the Word-to-PDF engine.
 */

export {
  buildImagePdf,
  formatFileSize,
  type PageSetup,
  type RenderedPage,
} from "../pdf/word-to-pdf.js";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceLineTotal extends InvoiceLineItem {
  /** quantity × unitPrice, rounded to cents. */
  amount: number;
}

export interface InvoiceTotals {
  lines: InvoiceLineTotal[];
  subtotal: number;
  /** Discount applied to the subtotal, as an amount. */
  discountAmount: number;
  /** Tax computed on the discounted subtotal, as an amount. */
  taxAmount: number;
  total: number;
}

/**
 * Round to cents, half up. n * 100 in binary floating point turns 1.005 into
 * 100.49999999999999, so the decimal exponent is shifted instead (1.005e2 is exactly 100.5).
 */
const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return n;
  const shift = (value: number, exp: number) => {
    const [mantissa, exponent] = String(value).split("e");
    return Number(`${mantissa}e${Number(exponent ?? 0) + exp}`);
  };
  return shift(Math.round(shift(n, 2)), -2);
};

const safeNumber = (n: number): number => (Number.isFinite(n) && n >= 0 ? n : 0);

/**
 * Compute per-line amounts and document totals. Invalid or negative numbers are
 * treated as zero, and lines with an empty description still count if they have
 * an amount — people leave descriptions for last.
 */
export function computeInvoice(
  items: InvoiceLineItem[],
  taxRatePercent: number,
  discountPercent = 0,
): InvoiceTotals {
  const lines: InvoiceLineTotal[] = (items ?? []).map((item) => {
    const quantity = safeNumber(item?.quantity ?? 0);
    const unitPrice = safeNumber(item?.unitPrice ?? 0);
    return {
      description: item?.description ?? "",
      quantity,
      unitPrice,
      amount: round2(quantity * unitPrice),
    };
  });

  const subtotal = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  const discountRate = Math.min(100, safeNumber(discountPercent)) / 100;
  const discountAmount = round2(subtotal * discountRate);
  const taxable = round2(subtotal - discountAmount);
  const taxAmount = round2(taxable * (safeNumber(taxRatePercent) / 100));
  const total = round2(taxable + taxAmount);

  return { lines, subtotal, discountAmount, taxAmount, total };
}

/** Currencies offered in the picker; symbol goes before or after per local convention. */
export interface CurrencyOption {
  code: string;
  symbol: string;
  /** true → "1 234,56 ₽", false → "$1,234.56" */
  after: boolean;
  /** Digits after the decimal point; 0 for currencies without a minor unit (yen). Default 2. */
  decimals?: number;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: "USD", symbol: "$", after: false },
  { code: "EUR", symbol: "€", after: true },
  { code: "GBP", symbol: "£", after: false },
  { code: "RUB", symbol: "₽", after: true },
  { code: "BYN", symbol: "Br", after: true },
  { code: "UAH", symbol: "₴", after: true },
  { code: "KZT", symbol: "₸", after: true },
  { code: "PLN", symbol: "zł", after: true },
  { code: "INR", symbol: "₹", after: false },
  { code: "JPY", symbol: "¥", after: false, decimals: 0 },
  { code: "CNY", symbol: "¥", after: false },
  { code: "CHF", symbol: "CHF", after: true },
  { code: "CAD", symbol: "$", after: false },
  { code: "AUD", symbol: "$", after: false },
];

/**
 * Format an amount in the given currency. Symbol-after currencies get a space and
 * comma decimals ("1 234,56 €"); symbol-before ones get US-style grouping ("$1,234.56").
 */
export function formatMoney(amount: number, currencyCode: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const currency = CURRENCIES.find((c) => c.code === currencyCode) ?? CURRENCIES[0];
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  const [intPart, fracPart] = abs.toFixed(currency.decimals ?? 2).split(".");
  if (currency.after) {
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${sign}${grouped}${fracPart ? `,${fracPart}` : ""} ${currency.symbol}`;
  }
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${currency.symbol}${grouped}${fracPart ? `.${fracPart}` : ""}`;
}
