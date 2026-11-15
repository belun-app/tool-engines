/**
 * Body mass index from weight and height, its adult weight category, and the healthy weight
 * range for the height.
 */

export interface BmiResult {
  bmi: number | null;
  category: "underweight" | "normal" | "overweight" | "obese" | "";
  minHealthyKg: number | null;
  maxHealthyKg: number | null;
}

export function calculateBmi(weightKg: number, heightCm: number): BmiResult {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || weightKg <= 0 || heightCm <= 0) {
    return { bmi: null, category: "", minHealthyKg: null, maxHealthyKg: null };
  }
  const hm = heightCm / 100;
  const bmi = weightKg / (hm * hm);

  let category: "underweight" | "normal" | "overweight" | "obese";
  if (bmi < 18.5) category = "underweight";
  else if (bmi < 25) category = "normal";
  else if (bmi < 30) category = "overweight";
  else category = "obese";

  return {
    bmi: Math.round(bmi * 10) / 10,
    category,
    minHealthyKg: Math.round(18.5 * hm * hm * 10) / 10,
    maxHealthyKg: Math.round(24.9 * hm * hm * 10) / 10,
  };
}

export function lbsToKg(lbs: number): number {
  return lbs * 0.45359237;
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}
