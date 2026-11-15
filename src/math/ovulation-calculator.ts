export type CyclePhase =
  | "menstrual"
  | "follicular"
  | "fertile"
  | "ovulation"
  | "luteal"
  | "unknown";

export interface CycleProjection {
  /** 0 is the cycle that starts on the entered period date; 1 is the next one, and so on. */
  index: number;
  periodStart: string;
  /** Last day of bleeding — periodStart + periodLength - 1. */
  periodEnd: string;
  /** Six-day fertile window: five days before ovulation through ovulation day itself. */
  fertileStart: string;
  /** Ovulation day — the last day of the six-day window (the egg survives 12–24 hours). */
  fertileEnd: string;
  /** Start of the three highest-probability days (ovulation - 2). */
  peakStart: string;
  ovulationDate: string;
  /** First day of the following period, ISO. */
  nextPeriod: string;
  /** Implantation usually happens 6–12 days after ovulation. */
  implantationStart: string;
  implantationEnd: string;
  /** Earliest day a urine test is reliable — 14 days past ovulation. */
  testDate: string;
  /** Estimated due date if conception happened in this cycle (ovulation + 266 days). */
  dueDate: string;
  /** True once the reference date is past this cycle's ovulation day. */
  past: boolean;
}

export interface OvulationResult {
  valid: boolean;
  /** Day of the current cycle, 1-based. 0 when the reference date precedes the period date. */
  cycleDay: number;
  phase: CyclePhase;
  /** Next ovulation on or after the reference date, ISO. */
  nextOvulation: string;
  daysToOvulation: number;
  ovulationToday: boolean;
  nextFertileStart: string;
  nextFertileEnd: string;
  inFertileWindow: boolean;
  daysToFertileStart: number;
  /** Start of the next period on or after the reference date. */
  nextPeriod: string;
  daysToNextPeriod: number;
  /** The luteal-phase length actually used, after clamping. */
  lutealPhase: number;
  /** The cycle length actually used, after clamping. */
  cycleLength: number;
  cycles: CycleProjection[];
}

export interface OvulationInput {
  /** First day of the most recent period, ISO YYYY-MM-DD. */
  lastPeriod: string;
  /** Average cycle length in days. Clamped to 20–45. Defaults to 28. */
  cycleLength?: number;
  /** Luteal-phase length in days. Clamped to 9–17. Defaults to 14. */
  lutealPhase?: number;
  /** Days of bleeding. Clamped to 1–10. Defaults to 5. */
  periodLength?: number;
  /** How many cycles to project. Clamped to 1–12. Defaults to 6. */
  cycles?: number;
  /** Date to measure "today" against. Defaults to the real today. */
  today?: string;
}

const DAY_MS = 86400000;
/** A pregnancy is dated as 266 days from conception — 280 days from a notional LMP. */
const CONCEPTION_TO_BIRTH = 266;

const EMPTY: OvulationResult = {
  valid: false,
  cycleDay: 0,
  phase: "unknown",
  nextOvulation: "",
  daysToOvulation: 0,
  ovulationToday: false,
  nextFertileStart: "",
  nextFertileEnd: "",
  inFertileWindow: false,
  daysToFertileStart: 0,
  nextPeriod: "",
  daysToNextPeriod: 0,
  lutealPhase: 14,
  cycleLength: 28,
  cycles: [],
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an ISO date as local midnight — `new Date("2026-01-01")` would be UTC. */
function parseDate(iso: string): Date | null {
  if (!ISO.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // Rejects 2026-02-30, which the Date constructor would silently roll into March.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Project ovulation and fertile windows forward from one known period date.
 *
 * Ovulation is placed by counting backwards from the *next* period, not forwards from the
 * last one: the luteal phase is the stable half of the cycle at roughly 14 days, while the
 * follicular half is what stretches and shrinks. So ovulation lands on
 * `cycleLength - lutealPhase`, which is day 14 only for a textbook 28-day cycle. Calculators
 * that hard-code day 14 are wrong by a week for anyone on a 35-day cycle.
 *
 * The fertile window is the six days ending on ovulation day (Wilcox et al., NEJM 1995):
 * sperm survive up to five days in fertile cervical mucus, and the egg only 12–24 hours, so
 * conception after ovulation day is rare.
 */
export function calculateOvulation(input: OvulationInput): OvulationResult {
  const start = parseDate(input.lastPeriod);
  if (!start) return { ...EMPTY };

  const cycleLength = clampInt(input.cycleLength, 20, 45, 28);
  const lutealPhase = clampInt(input.lutealPhase, 9, 17, 14);
  const periodLength = clampInt(input.periodLength, 1, 10, 5);
  const count = clampInt(input.cycles, 1, 12, 6);

  const reference = (input.today ? parseDate(input.today) : null) ?? new Date();
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const todayISO = toISO(today);

  // Ovulation cannot fall on or before the last day of bleeding, so a very short cycle paired
  // with a long luteal phase is pulled back to at least one follicular day after the period.
  const ovulationOffset = Math.max(periodLength, cycleLength - lutealPhase);

  const cycles: CycleProjection[] = [];
  for (let i = 0; i < count; i++) {
    const periodStart = addDays(start, i * cycleLength);
    const ovulation = addDays(periodStart, ovulationOffset);
    cycles.push({
      index: i,
      periodStart: toISO(periodStart),
      periodEnd: toISO(addDays(periodStart, periodLength - 1)),
      fertileStart: toISO(addDays(ovulation, -5)),
      fertileEnd: toISO(ovulation),
      peakStart: toISO(addDays(ovulation, -2)),
      ovulationDate: toISO(ovulation),
      nextPeriod: toISO(addDays(periodStart, cycleLength)),
      implantationStart: toISO(addDays(ovulation, 6)),
      implantationEnd: toISO(addDays(ovulation, 12)),
      testDate: toISO(addDays(ovulation, 14)),
      dueDate: toISO(addDays(ovulation, CONCEPTION_TO_BIRTH)),
      past: today.getTime() > ovulation.getTime(),
    });
  }

  const elapsed = diffDays(start, today);
  const cycleDay = elapsed < 0 ? 0 : (elapsed % cycleLength) + 1;

  // The cycle the reference date actually sits in, which may be beyond the projected list.
  const currentStart =
    elapsed < 0 ? start : addDays(start, Math.floor(elapsed / cycleLength) * cycleLength);
  const currentOvulation = addDays(currentStart, ovulationOffset);
  const currentFertileStart = addDays(currentOvulation, -5);
  const currentFertileEnd = currentOvulation;

  let phase: CyclePhase = "unknown";
  if (elapsed >= 0) {
    if (cycleDay <= periodLength) phase = "menstrual";
    else if (todayISO === toISO(currentOvulation)) phase = "ovulation";
    else if (todayISO >= toISO(currentFertileStart) && todayISO <= toISO(currentFertileEnd))
      phase = "fertile";
    else if (today.getTime() < currentFertileStart.getTime()) phase = "follicular";
    else phase = "luteal";
  }

  // Next ovulation and period on or after the reference date, counted from the cycle
  // arithmetic rather than looked up in the projected list, which may lie entirely in the past.
  const ovulationCycles = Math.max(0, Math.ceil((elapsed - ovulationOffset) / cycleLength));
  const nextOvulation = addDays(start, ovulationCycles * cycleLength + ovulationOffset);
  const nextFertileStart = addDays(nextOvulation, -5);
  const nextPeriod = addDays(start, Math.max(1, Math.ceil(elapsed / cycleLength)) * cycleLength);

  return {
    valid: true,
    cycleDay,
    phase,
    nextOvulation: toISO(nextOvulation),
    daysToOvulation: Math.max(0, diffDays(today, nextOvulation)),
    ovulationToday: phase === "ovulation",
    nextFertileStart: toISO(nextFertileStart),
    nextFertileEnd: toISO(nextOvulation),
    inFertileWindow: phase === "fertile" || phase === "ovulation",
    daysToFertileStart: Math.max(0, diffDays(today, nextFertileStart)),
    nextPeriod: toISO(nextPeriod),
    daysToNextPeriod: Math.max(0, diffDays(today, nextPeriod)),
    lutealPhase,
    cycleLength,
    cycles,
  };
}
