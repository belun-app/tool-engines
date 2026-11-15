import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  buildImagePdf,
  computeInvoice,
  formatFileSize,
  formatMoney,
} from "./invoice-generator.js";

// Drawing the invoice happens on a canvas in the mount (DOM-bound). The PDF packer is
// re-exported from pdf/word-to-pdf and is tested there; here we only check the re-export.

describe("computeInvoice", () => {
  it("returns zeros for no items", () => {
    expect(computeInvoice([], 20)).toEqual({
      lines: [],
      subtotal: 0,
      discountAmount: 0,
      taxAmount: 0,
      total: 0,
    });
  });

  it("computes line amounts, subtotal, tax and total (hand-calculated)", () => {
    const r = computeInvoice(
      [
        { description: "Design", quantity: 10, unitPrice: 45.5 },
        { description: "Hosting", quantity: 3, unitPrice: 19.99 },
      ],
      20,
    );
    // 455 + 59.97 = 514.97; tax 20% = 102.994 -> 102.99; total 617.96
    expect(r.lines.map((l) => l.amount)).toEqual([455, 59.97]);
    expect(r.subtotal).toBe(514.97);
    expect(r.discountAmount).toBe(0);
    expect(r.taxAmount).toBe(102.99);
    expect(r.total).toBe(617.96);
  });

  it("applies the discount before tax", () => {
    const r = computeInvoice([{ description: "", quantity: 1, unitPrice: 200 }], 10, 15);
    // 200 - 15% = 170; tax 10% of 170 = 17; total 187
    expect(r.discountAmount).toBe(30);
    expect(r.taxAmount).toBe(17);
    expect(r.total).toBe(187);
  });

  it("caps the discount at 100%", () => {
    const r = computeInvoice([{ description: "x", quantity: 2, unitPrice: 50 }], 20, 150);
    expect(r.discountAmount).toBe(100);
    expect(r.taxAmount).toBe(0);
    expect(r.total).toBe(0);
  });

  it("treats negative, NaN and missing numbers as zero", () => {
    const r = computeInvoice(
      [
        { description: "neg", quantity: -2, unitPrice: 10 },
        { description: "nan", quantity: Number.NaN, unitPrice: 5 },
        { description: "inf", quantity: 1, unitPrice: Number.POSITIVE_INFINITY },
        // biome-ignore lint/suspicious/noExplicitAny: malformed input from the form
        { description: "missing" } as any,
      ],
      -5,
      Number.NaN,
    );
    expect(r.lines.every((l) => l.amount === 0)).toBe(true);
    expect(r.lines[0].quantity).toBe(0);
    expect(r.total).toBe(0);
  });

  it("tolerates a null items list and null entries", () => {
    // biome-ignore lint/suspicious/noExplicitAny: defensive path
    expect(computeInvoice(null as any, 10).total).toBe(0);
    // biome-ignore lint/suspicious/noExplicitAny: defensive path
    expect(computeInvoice([null as any], 10).lines[0]).toEqual({
      description: "",
      quantity: 0,
      unitPrice: 0,
      amount: 0,
    });
  });

  it("avoids float drift in sums (0.1 + 0.2)", () => {
    const r = computeInvoice(
      [
        { description: "a", quantity: 1, unitPrice: 0.1 },
        { description: "b", quantity: 1, unitPrice: 0.2 },
      ],
      0,
    );
    expect(r.subtotal).toBe(0.3);
  });

  it("rounds half a cent up", () => {
    const r = computeInvoice([{ description: "x", quantity: 1, unitPrice: 1.005 }], 0);
    expect(r.lines[0].amount).toBe(1.01);
  });
});

describe("formatMoney", () => {
  it("puts the symbol before with US grouping", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234567.891, "GBP")).toBe("£1,234,567.89");
    expect(formatMoney(0, "INR")).toBe("₹0.00");
  });

  it("puts the symbol after with no-break-space grouping and comma decimals", () => {
    // Groups and the symbol are separated by U+00A0 so the amount never wraps.
    expect(formatMoney(1234.56, "EUR")).toBe("1 234,56 €");
    expect(formatMoney(1000000, "RUB")).toBe("1 000 000,00 ₽");
    expect(formatMoney(5, "CHF")).toBe("5,00 CHF");
  });

  it("formats negatives and falls back to USD / zero", () => {
    expect(formatMoney(-12.3, "USD")).toBe("-$12.30");
    expect(formatMoney(-12.3, "EUR")).toBe("-12,30 €");
    expect(formatMoney(7, "XXX")).toBe("$7.00");
    expect(formatMoney(Number.NaN, "USD")).toBe("$0.00");
  });

  it("lists the picker currencies with unique codes", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes[0]).toBe("USD");
  });

  it("prints JPY without decimals", () => {
    expect(formatMoney(1000, "JPY")).toBe("¥1,000");
  });
});

describe("re-exports", () => {
  it("exposes the PDF packer and size formatter", () => {
    expect(typeof buildImagePdf).toBe("function");
    expect(typeof formatFileSize(1024)).toBe("string");
  });
});
