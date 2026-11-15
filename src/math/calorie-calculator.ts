/**
 * Daily calorie needs: basal metabolic rate by the Mifflin-St Jeor equation, total energy
 * expenditure for an activity level, and targets for losing or gaining weight.
 */

export type Sex = "male" | "female";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very-active";

export interface CalorieResult {
  bmr: number;
  tdee: number;
  mildLoss: number;
  loss: number;
  mildGain: number;
  gain: number;
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  "very-active": 1.9,
};

export function calculateCalories(
  age: number,
  sex: Sex,
  heightCm: number,
  weightKg: number,
  activity: ActivityLevel,
): CalorieResult {
  if (
    !Number.isFinite(age) ||
    !Number.isFinite(heightCm) ||
    !Number.isFinite(weightKg) ||
    age <= 0 ||
    age > 130 ||
    heightCm <= 0 ||
    weightKg <= 0
  ) {
    return { bmr: 0, tdee: 0, mildLoss: 0, loss: 0, mildGain: 0, gain: 0 };
  }

  const sexConstant = sex === "male" ? 5 : -161;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant;
  const multiplier = ACTIVITY_MULTIPLIERS[activity] ?? 1.2;
  const tdee = bmr * multiplier;

  const clamp = (value: number) => Math.max(0, Math.round(value));

  return {
    bmr: clamp(bmr),
    tdee: clamp(tdee),
    mildLoss: clamp(tdee - 250),
    loss: clamp(tdee - 500),
    mildGain: clamp(tdee + 250),
    gain: clamp(tdee + 500),
  };
}
