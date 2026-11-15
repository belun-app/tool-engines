/**
 * Tip and total for a bill, split between a number of people.
 */

export interface TipResult {
  tipAmount: number;
  totalAmount: number;
  tipPerPerson: number;
  totalPerPerson: number;
  billPerPerson: number;
  valid: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateTip(bill: number, tipPercent: number, people: number): TipResult {
  const validBill = Number.isFinite(bill) && bill > 0;
  const validTip = Number.isFinite(tipPercent) && tipPercent >= 0;
  const split = Number.isFinite(people) && people >= 1 ? Math.floor(people) : 1;

  if (!validBill || !validTip) {
    return {
      tipAmount: 0,
      totalAmount: 0,
      tipPerPerson: 0,
      totalPerPerson: 0,
      billPerPerson: 0,
      valid: false,
    };
  }

  const tipAmount = round2((bill * tipPercent) / 100);
  const totalAmount = round2(bill + tipAmount);

  return {
    tipAmount,
    totalAmount,
    tipPerPerson: round2(tipAmount / split),
    totalPerPerson: round2(totalAmount / split),
    billPerPerson: round2(bill / split),
    valid: true,
  };
}
