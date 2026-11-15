export type DueDateMethod = "lmp" | "conception" | "ivf-day3" | "ivf-day5" | "ultrasound";

export interface Milestone {
  /** Stable key so each language page can print its own label. */
  key: string;
  /** Completed weeks of gestation at which the milestone falls. */
  week: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** True once the reference date has passed this milestone. */
  past: boolean;
}

export interface TrimesterRange {
  key: "first" | "second" | "third";
  start: string;
  end: string;
  /** True when the reference date falls inside this range. */
  current: boolean;
}

export interface DueDateResult {
  valid: boolean;
  /** Estimated date of delivery, ISO YYYY-MM-DD. */
  dueDate: string;
  /** First day of the last menstrual period, derived for every method. */
  lmpDate: string;
  /** Estimated conception date — LMP + 14 days for a 28-day cycle. */
  conceptionDate: string;
  /** Completed weeks of gestation on the reference date. */
  weeks: number;
  /** Days into the current gestational week, 0–6. */
  days: number;
  /** Total completed days of gestation. */
  totalDays: number;
  /** 1, 2 or 3; 0 before the pregnancy starts. */
  trimester: number;
  /** Days remaining until the due date; 0 once the due date has passed. */
  daysRemaining: number;
  /** Whole weeks remaining until the due date. */
  weeksRemaining: number;
  /** Rounded share of the 280-day pregnancy already elapsed, 0–100. */
  progressPercent: number;
  /** True when the reference date is past the due date. */
  overdue: boolean;
  /** Days past the due date; 0 when not overdue. */
  daysOverdue: number;
  /** Weekday index of the due date, 0 = Sunday. */
  dueWeekday: number;
  /** Start of week 37 — the first day a birth is no longer considered preterm. */
  fullTermDate: string;
  /** Start of week 24 — the usual threshold of viability. */
  viabilityDate: string;
  trimesters: TrimesterRange[];
  milestones: Milestone[];
}

/** A pregnancy is dated as 280 days — 40 weeks — from the first day of the last period. */
const GESTATION_DAYS = 280;
const DAY_MS = 86400000;

const EMPTY: DueDateResult = {
  valid: false,
  dueDate: "",
  lmpDate: "",
  conceptionDate: "",
  weeks: 0,
  days: 0,
  totalDays: 0,
  trimester: 0,
  daysRemaining: 0,
  weeksRemaining: 0,
  progressPercent: 0,
  overdue: false,
  daysOverdue: 0,
  dueWeekday: 0,
  fullTermDate: "",
  viabilityDate: "",
  trimesters: [],
  milestones: [],
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

/**
 * Gestational age, in days, that the given date already represents.
 *
 * Naegele's rule assumes ovulation on cycle day 14, so a known conception date is itself
 * 14 days of gestation. A day-3 embryo transfer is 17 days (14 + 3) and a day-5 blastocyst
 * transfer is 19 days (14 + 5) — the offsets IVF clinics use to issue an EDD.
 */
const OFFSET_DAYS: Record<Exclude<DueDateMethod, "lmp" | "ultrasound">, number> = {
  conception: 14,
  "ivf-day3": 17,
  "ivf-day5": 19,
};

const MILESTONE_WEEKS: ReadonlyArray<{ key: string; week: number }> = [
  { key: "heartbeat", week: 6 },
  { key: "end-of-embryonic", week: 10 },
  { key: "nt-scan", week: 12 },
  { key: "first-trimester-end", week: 14 },
  { key: "anatomy-scan", week: 20 },
  { key: "viability", week: 24 },
  { key: "third-trimester-start", week: 28 },
  { key: "glucose-test", week: 28 },
  { key: "early-term", week: 37 },
  { key: "full-term", week: 39 },
  { key: "due-date", week: 40 },
  { key: "post-term", week: 42 },
];

export interface DueDateInput {
  method: DueDateMethod;
  /** The known date for the chosen method, ISO YYYY-MM-DD. */
  date: string;
  /** Average cycle length in days; only used by the LMP method. Defaults to 28. */
  cycleLength?: number;
  /** Gestational age in weeks reported by an ultrasound. Only used by that method. */
  scanWeeks?: number;
  /** Extra days on top of `scanWeeks`, 0–6. */
  scanDays?: number;
  /** Date to measure progress against. Defaults to today. */
  today?: string;
}

/**
 * Estimate a due date and the current stage of a pregnancy.
 *
 * Every method is normalised to a notional LMP first, then the EDD is LMP + 280 days.
 * A cycle longer or shorter than 28 days shifts ovulation, so the LMP method corrects by
 * `cycleLength - 28` — the adjustment midwives apply by hand and most online calculators
 * quietly skip.
 */
export function calculateDueDate(input: DueDateInput): DueDateResult {
  const given = parseDate(input.date);
  if (!given) return { ...EMPTY };

  const reference = (input.today ? parseDate(input.today) : null) ?? new Date();
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());

  let lmp: Date;

  if (input.method === "lmp") {
    const cycle = input.cycleLength ?? 28;
    // Cycles outside 20–45 days are almost always a typo rather than a real cycle.
    const safeCycle = Number.isFinite(cycle) ? Math.min(45, Math.max(20, cycle)) : 28;
    lmp = addDays(given, Math.round(safeCycle) - 28);
  } else if (input.method === "ultrasound") {
    const rawWeeks = input.scanWeeks ?? 0;
    const rawDays = input.scanDays ?? 0;
    const weeks = Number.isFinite(rawWeeks) ? Math.min(42, Math.max(0, Math.round(rawWeeks))) : 0;
    const extra = Number.isFinite(rawDays) ? Math.min(6, Math.max(0, Math.round(rawDays))) : 0;
    const ageAtScan = weeks * 7 + extra;
    if (ageAtScan <= 0) return { ...EMPTY };
    lmp = addDays(given, -ageAtScan);
  } else {
    lmp = addDays(given, -OFFSET_DAYS[input.method]);
  }

  const dueDate = addDays(lmp, GESTATION_DAYS);
  const conception = addDays(lmp, 14);

  const elapsed = diffDays(lmp, today);
  const totalDays = Math.max(0, elapsed);
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;

  const rawRemaining = diffDays(today, dueDate);
  const overdue = rawRemaining < 0;

  // A pregnancy dated into the future reports trimester 0 rather than a misleading 1.
  const started = elapsed >= 0;
  let trimester = 0;
  if (started) {
    if (weeks < 14) trimester = 1;
    else if (weeks < 28) trimester = 2;
    else trimester = 3;
  }

  const todayISO = toISO(today);
  const ranges: ReadonlyArray<{ key: TrimesterRange["key"]; start: Date; end: Date }> = [
    { key: "first", start: lmp, end: addDays(lmp, 13 * 7 + 6) },
    { key: "second", start: addDays(lmp, 14 * 7), end: addDays(lmp, 27 * 7 + 6) },
    { key: "third", start: addDays(lmp, 28 * 7), end: dueDate },
  ];
  const trimesters: TrimesterRange[] = ranges.map(({ key, start, end }) => {
    const startISO = toISO(start);
    const endISO = toISO(end);
    return {
      key,
      start: startISO,
      end: endISO,
      current: started && todayISO >= startISO && todayISO <= endISO,
    };
  });

  const milestones: Milestone[] = MILESTONE_WEEKS.map(({ key, week }) => {
    const date = addDays(lmp, week * 7);
    return { key, week, date: toISO(date), past: today.getTime() >= date.getTime() };
  });

  return {
    valid: true,
    dueDate: toISO(dueDate),
    lmpDate: toISO(lmp),
    conceptionDate: toISO(conception),
    weeks,
    days,
    totalDays,
    trimester,
    daysRemaining: Math.max(0, rawRemaining),
    weeksRemaining: Math.floor(Math.max(0, rawRemaining) / 7),
    progressPercent: Math.min(100, Math.max(0, Math.round((totalDays / GESTATION_DAYS) * 100))),
    overdue,
    daysOverdue: overdue ? -rawRemaining : 0,
    dueWeekday: dueDate.getDay(),
    fullTermDate: toISO(addDays(lmp, 37 * 7)),
    viabilityDate: toISO(addDays(lmp, 24 * 7)),
    trimesters,
    milestones,
  };
}
