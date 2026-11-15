export type CronLang = "en" | "ru";

export interface CronResult {
  /** True when the expression parsed without errors. */
  valid: boolean;
  /** Localized error message, empty when valid. */
  error: string;
  /** Normalized expression (whitespace collapsed, macros expanded to 5 fields). */
  expression: string;
  /** Plain-language description of the schedule, in the requested language. */
  description: string;
  /** Up to five upcoming run times, formatted in local time. Empty for @reboot. */
  nextRuns: string[];
  /** The five raw fields, useful for a breakdown view. */
  fields: {
    minute: string;
    hour: string;
    dayOfMonth: string;
    month: string;
    dayOfWeek: string;
  };
}

interface FieldParse {
  raw: string;
  values: number[];
  isAll: boolean;
  stepEvery: number | null;
  error: string | null;
}

const MONTH_ABBR = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const DOW_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function normalize(value: number, kind: string): number {
  return kind === "dow" && value === 7 ? 0 : value;
}

function parseValue(token: string, kind: string): number | null {
  const t = token.trim();
  if (/^\d+$/.test(t)) return Number.parseInt(t, 10);
  const lower = t.toLowerCase().slice(0, 3);
  if (kind === "month") {
    const i = MONTH_ABBR.indexOf(lower);
    if (i >= 0) return i + 1;
  }
  if (kind === "dow") {
    const i = DOW_ABBR.indexOf(lower);
    if (i >= 0) return i;
  }
  return null;
}

function parsePart(
  part: string,
  min: number,
  max: number,
  kind: string,
): { values: number[]; error?: string } {
  let step = 1;
  let body = part;
  if (part.includes("/")) {
    const [b, s] = part.split("/");
    body = b;
    step = Number.parseInt(s, 10);
    if (!Number.isInteger(step) || step <= 0) return { values: [], error: part };
  }

  let from: number;
  let to: number;
  if (body === "*") {
    from = min;
    to = max;
  } else if (body.includes("-")) {
    const [a, b] = body.split("-");
    const av = parseValue(a, kind);
    const bv = parseValue(b, kind);
    if (av === null || bv === null) return { values: [], error: part };
    from = av;
    to = bv;
  } else {
    const v = parseValue(body, kind);
    if (v === null) return { values: [], error: part };
    from = v;
    to = v;
  }

  if (from < min || to > max || from > to) return { values: [], error: part };

  const values: number[] = [];
  for (let i = from; i <= to; i += step) values.push(i);
  return { values };
}

function parseField(token: string, min: number, max: number, kind: string): FieldParse {
  const result: FieldParse = {
    raw: token,
    values: [],
    isAll: token === "*",
    stepEvery: null,
    error: null,
  };

  const stepMatch = token.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = Number.parseInt(stepMatch[1], 10);
    if (step <= 0) {
      result.error = token;
      return result;
    }
    result.stepEvery = step;
  }

  const set = new Set<number>();
  for (const part of token.split(",")) {
    const parsed = parsePart(part, min, max, kind);
    // An empty list item ("1,,2", "5,") reports error "" — still an error, so report the field.
    if (parsed.error !== undefined) {
      result.error = parsed.error || token;
      return result;
    }
    for (const v of parsed.values) set.add(normalize(v, kind));
  }

  result.values = [...set].sort((a, b) => a - b);
  if (result.values.length === 0) result.error = token;
  return result;
}

// ---------------------------------------------------------------------------
// Helpers shared by the locales
// ---------------------------------------------------------------------------

function isContiguous(values: number[]): boolean {
  if (values.length < 3) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== 1) return false;
  }
  return true;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function timeOfDay(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

// ---------------------------------------------------------------------------
// Locale definitions
// ---------------------------------------------------------------------------

interface Locale {
  joinList(items: string[]): string;
  everyMinute: string;
  everyNMinutes(n: number): string;
  everyMinuteEveryNHours(n: number): string;
  everyNHours(n: number): string;
  minuteValues(values: number[]): string;
  hourValues(values: number[]): string;
  everyMinutePastHours(hourPhrase: string): string;
  everyNMinutesPastHours(n: number, hourPhrase: string): string;
  minutesPastEveryHour(minutePhrase: string): string;
  minutesPastHours(minutePhrase: string, hourPhrase: string): string;
  atTimes(times: string[]): string;
  onDom(domPhrase: string): string;
  onDow(dowPhrase: string): string;
  onDomOrDow(domPhrase: string, dowPhrase: string): string;
  everyNDaysOfMonth(n: number): string;
  everyNDaysOfWeek(n: number): string;
  domValues(values: number[]): string;
  dowValues(values: number[]): string;
  monthClause(field: FieldParse): string;
  assemble(clauses: string[]): string;
  formatNextRun(date: Date): string;
  reboot: string;
  errFieldCount: string;
  errToken(part: string): string;
}

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const EN_DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function enValueList(values: number[], singular: string, plural: string): string {
  if (values.length === 1) return `${singular} ${values[0]}`;
  if (isContiguous(values)) return `${plural} ${values[0]} through ${values[values.length - 1]}`;
  return `${plural} ${EN.joinList(values.map(String))}`;
}

const EN: Locale = {
  joinList(items) {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  },
  everyMinute: "every minute",
  everyNMinutes: (n) => `every ${n} minutes`,
  everyMinuteEveryNHours: (n) => `every minute, every ${n} hours`,
  everyNHours: (n) => `every ${n} hours`,
  minuteValues: (values) => enValueList(values, "minute", "minutes"),
  hourValues: (values) => enValueList(values, "hour", "hours"),
  everyMinutePastHours: (hourPhrase) => `every minute past ${hourPhrase}`,
  everyNMinutesPastHours: (n, hourPhrase) => `every ${n} minutes past ${hourPhrase}`,
  minutesPastEveryHour: (minutePhrase) => `at ${minutePhrase} past every hour`,
  minutesPastHours: (minutePhrase, hourPhrase) => `at ${minutePhrase} past ${hourPhrase}`,
  atTimes: (times) => `at ${EN.joinList(times)}`,
  onDom: (domPhrase) => `on ${domPhrase}`,
  onDow: (dowPhrase) => `on ${dowPhrase}`,
  onDomOrDow: (domPhrase, dowPhrase) => `on ${domPhrase} or on ${dowPhrase}`,
  everyNDaysOfMonth: (n) => `every ${n} days of the month`,
  everyNDaysOfWeek: (n) => `every ${n} days of the week`,
  domValues: (values) => `${enValueList(values, "day", "days")} of the month`,
  dowValues(values) {
    if (values.length === 1) return EN_DOW[values[0]];
    if (isContiguous(values)) {
      return `${EN_DOW[values[0]]} through ${EN_DOW[values[values.length - 1]]}`;
    }
    return EN.joinList(values.map((v) => EN_DOW[v]));
  },
  monthClause(field) {
    if (field.isAll) return "";
    if (field.stepEvery) return `every ${field.stepEvery} months`;
    const v = field.values;
    if (v.length === 1) return `in ${EN_MONTHS[v[0] - 1]}`;
    if (isContiguous(v))
      return `in ${EN_MONTHS[v[0] - 1]} through ${EN_MONTHS[v[v.length - 1] - 1]}`;
    return `in ${EN.joinList(v.map((m) => EN_MONTHS[m - 1]))}`;
  },
  assemble(clauses) {
    const text = clauses.filter(Boolean).join(", ");
    if (!text) return "";
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  },
  formatNextRun(date) {
    const wd = EN_DOW_SHORT[date.getDay()];
    const month = EN_MONTH_SHORT[date.getMonth()];
    return `${wd}, ${date.getDate()} ${month} ${date.getFullYear()}, ${timeOfDay(date.getHours(), date.getMinutes())}`;
  },
  reboot: "Runs once at system startup (reboot).",
  errFieldCount: "A cron expression needs exactly 5 fields: minute hour day month weekday.",
  errToken: (part) => `Invalid value: "${part}". Check the allowed range for that field.`,
};

const RU_MONTHS_PREP = [
  "январе",
  "феврале",
  "марте",
  "апреле",
  "мае",
  "июне",
  "июле",
  "августе",
  "сентябре",
  "октябре",
  "ноябре",
  "декабре",
];
const RU_MONTHS_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const RU_MONTHS_NOM = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
const RU_MONTH_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];
// index 0 = Sunday
const RU_DOW_DATIVE = [
  "воскресеньям",
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
];
const RU_DOW_GEN = [
  "воскресенья",
  "понедельника",
  "вторника",
  "среды",
  "четверга",
  "пятницы",
  "субботы",
];
const RU_DOW_ACC = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среду",
  "четверг",
  "пятницу",
  "субботу",
];
const RU_DOW_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const RU: Locale = {
  joinList(items) {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} и ${items[1]}`;
    return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
  },
  everyMinute: "каждую минуту",
  everyNMinutes: (n) => `каждые ${n} ${pluralRu(n, ["минуту", "минуты", "минут"])}`,
  everyMinuteEveryNHours: (n) =>
    `каждую минуту, каждые ${n} ${pluralRu(n, ["час", "часа", "часов"])}`,
  everyNHours: (n) => `каждые ${n} ${pluralRu(n, ["час", "часа", "часов"])}`,
  minuteValues(values) {
    const word = (n: number) => pluralRu(n, ["минуту", "минуты", "минут"]);
    if (values.length === 1) return `${values[0]} ${word(values[0])}`;
    if (isContiguous(values)) {
      return `с ${values[0]} по ${values[values.length - 1]} ${word(values[values.length - 1])}`;
    }
    return `${RU.joinList(values.map(String))} ${word(values[values.length - 1])}`;
  },
  hourValues(values) {
    const word = (n: number) => pluralRu(n, ["час", "часа", "часов"]);
    if (values.length === 1) return `${values[0]} ${word(values[0])}`;
    if (isContiguous(values)) {
      return `часы с ${values[0]} по ${values[values.length - 1]}`;
    }
    return `часы ${RU.joinList(values.map(String))}`;
  },
  everyMinutePastHours: (hourPhrase) => `каждую минуту в ${hourPhrase}`,
  everyNMinutesPastHours: (n, hourPhrase) =>
    `каждые ${n} ${pluralRu(n, ["минуту", "минуты", "минут"])} в ${hourPhrase}`,
  minutesPastEveryHour: (minutePhrase) => `в ${minutePhrase} каждого часа`,
  minutesPastHours: (minutePhrase, hourPhrase) => `в ${minutePhrase} в ${hourPhrase}`,
  atTimes: (times) => `в ${RU.joinList(times)}`,
  onDom: (domPhrase) => domPhrase,
  onDow: (dowPhrase) => dowPhrase,
  onDomOrDow: (domPhrase, dowPhrase) => `${domPhrase} или ${dowPhrase}`,
  everyNDaysOfMonth: (n) => `каждые ${n} ${pluralRu(n, ["день", "дня", "дней"])} месяца`,
  everyNDaysOfWeek: (n) => `каждые ${n} ${pluralRu(n, ["день", "дня", "дней"])} недели`,
  domValues(values) {
    if (values.length === 1) return `${values[0]}-го числа месяца`;
    if (isContiguous(values)) {
      return `с ${values[0]} по ${values[values.length - 1]} число месяца`;
    }
    return `${RU.joinList(values.map((v) => `${v}-го`))} числа месяца`;
  },
  dowValues(values) {
    if (values.length === 1) return `по ${RU_DOW_DATIVE[values[0]]}`;
    if (isContiguous(values)) {
      return `с ${RU_DOW_GEN[values[0]]} по ${RU_DOW_ACC[values[values.length - 1]]}`;
    }
    return `по ${RU.joinList(values.map((v) => RU_DOW_DATIVE[v]))}`;
  },
  monthClause(field) {
    if (field.isAll) return "";
    if (field.stepEvery) {
      return `каждые ${field.stepEvery} ${pluralRu(field.stepEvery, ["месяц", "месяца", "месяцев"])}`;
    }
    const v = field.values;
    if (v.length === 1) return `в ${RU_MONTHS_PREP[v[0] - 1]}`;
    if (isContiguous(v)) {
      return `с ${RU_MONTHS_GEN[v[0] - 1]} по ${RU_MONTHS_NOM[v[v.length - 1] - 1]}`;
    }
    return `в ${RU.joinList(v.map((m) => RU_MONTHS_PREP[m - 1]))}`;
  },
  assemble(clauses) {
    const text = clauses.filter(Boolean).join(", ");
    if (!text) return "";
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  },
  formatNextRun(date) {
    const wd = RU_DOW_SHORT[date.getDay()];
    const month = RU_MONTH_SHORT[date.getMonth()];
    return `${wd}, ${date.getDate()} ${month} ${date.getFullYear()}, ${timeOfDay(date.getHours(), date.getMinutes())}`;
  },
  reboot: "Запускается один раз при старте системы (reboot).",
  errFieldCount:
    "Cron-выражение должно содержать ровно 5 полей: минута час день месяц день_недели.",
  errToken: (part) => `Недопустимое значение: «${part}». Проверьте допустимый диапазон поля.`,
};

// ---------------------------------------------------------------------------
// Description builders
// ---------------------------------------------------------------------------

function hourPhrase(field: FieldParse, loc: Locale): string {
  return field.stepEvery ? loc.everyNHours(field.stepEvery) : loc.hourValues(field.values);
}

function timeClause(minute: FieldParse, hour: FieldParse, loc: Locale): string {
  if (minute.isAll && hour.isAll) return loc.everyMinute;
  if (minute.stepEvery && hour.isAll) return loc.everyNMinutes(minute.stepEvery);
  if (minute.isAll && hour.stepEvery) return loc.everyMinuteEveryNHours(hour.stepEvery);
  if (minute.isAll) return loc.everyMinutePastHours(hourPhrase(hour, loc));
  if (minute.stepEvery) return loc.everyNMinutesPastHours(minute.stepEvery, hourPhrase(hour, loc));
  if (hour.isAll) return loc.minutesPastEveryHour(loc.minuteValues(minute.values));
  if (hour.stepEvery) {
    return loc.minutesPastHours(loc.minuteValues(minute.values), hourPhrase(hour, loc));
  }

  const times: string[] = [];
  for (const h of hour.values) {
    for (const m of minute.values) times.push(timeOfDay(h, m));
  }
  if (times.length <= 12) return loc.atTimes(times);
  return loc.minutesPastHours(loc.minuteValues(minute.values), hourPhrase(hour, loc));
}

function dayClause(dom: FieldParse, dow: FieldParse, loc: Locale): string {
  if (dom.isAll && dow.isAll) return "";
  const domPhrase = dom.stepEvery
    ? loc.everyNDaysOfMonth(dom.stepEvery)
    : loc.domValues(dom.values);
  const dowPhrase = dow.stepEvery ? loc.everyNDaysOfWeek(dow.stepEvery) : loc.dowValues(dow.values);
  if (!dom.isAll && dow.isAll) return loc.onDom(domPhrase);
  if (dom.isAll && !dow.isAll) return loc.onDow(dowPhrase);
  return loc.onDomOrDow(domPhrase, dowPhrase);
}

// ---------------------------------------------------------------------------
// Next-run computation
// ---------------------------------------------------------------------------

function dayMatches(date: Date, dom: FieldParse, dow: FieldParse): boolean {
  const domMatch = dom.isAll || dom.values.includes(date.getDate());
  const dowMatch = dow.isAll || dow.values.includes(date.getDay());
  if (dom.isAll || dow.isAll) return domMatch && dowMatch;
  return domMatch || dowMatch;
}

function computeNextRuns(
  minute: FieldParse,
  hour: FieldParse,
  dom: FieldParse,
  month: FieldParse,
  dow: FieldParse,
  now: Date,
  count: number,
): Date[] {
  const minuteSet = new Set(minute.values);
  const hourSet = new Set(hour.values);
  const monthSet = new Set(month.values);

  const runs: Date[] = [];
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  let guard = 0;
  while (runs.length < count && guard < 400000) {
    guard++;
    if (!monthSet.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(d, dom, dow)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hourSet.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minuteSet.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    runs.push(new Date(d.getTime()));
    d.setMinutes(d.getMinutes() + 1, 0, 0);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const EMPTY_FIELDS = { minute: "", hour: "", dayOfMonth: "", month: "", dayOfWeek: "" };

/**
 * Parse a 5-field cron expression (or a @macro), returning a localized
 * plain-language description and the next upcoming run times in local time.
 * Empty input returns an invalid result without an error message.
 */
export function describeCron(
  expression: string,
  lang: CronLang = "en",
  now: Date = new Date(),
): CronResult {
  const loc = lang === "ru" ? RU : EN;
  const trimmed = expression.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return {
      valid: false,
      error: "",
      expression: "",
      description: "",
      nextRuns: [],
      fields: { ...EMPTY_FIELDS },
    };
  }

  if (trimmed.toLowerCase() === "@reboot") {
    return {
      valid: true,
      error: "",
      expression: "@reboot",
      description: loc.reboot,
      nextRuns: [],
      fields: { ...EMPTY_FIELDS },
    };
  }

  const normalized = MACROS[trimmed.toLowerCase()] ?? trimmed;
  const tokens = normalized.split(" ");
  if (tokens.length !== 5) {
    return {
      valid: false,
      error: loc.errFieldCount,
      expression: normalized,
      description: "",
      nextRuns: [],
      fields: { ...EMPTY_FIELDS },
    };
  }

  const minute = parseField(tokens[0], 0, 59, "minute");
  const hour = parseField(tokens[1], 0, 23, "hour");
  const dom = parseField(tokens[2], 1, 31, "dom");
  const month = parseField(tokens[3], 1, 12, "month");
  const dow = parseField(tokens[4], 0, 7, "dow");

  const fields = {
    minute: tokens[0],
    hour: tokens[1],
    dayOfMonth: tokens[2],
    month: tokens[3],
    dayOfWeek: tokens[4],
  };

  const firstError = [minute, hour, dom, month, dow].find((f) => f.error);
  if (firstError) {
    return {
      valid: false,
      error: loc.errToken(firstError.error as string),
      expression: normalized,
      description: "",
      nextRuns: [],
      fields,
    };
  }

  const clauses = [timeClause(minute, hour, loc), dayClause(dom, dow, loc), loc.monthClause(month)];
  const description = loc.assemble(clauses);

  const nextRuns = computeNextRuns(minute, hour, dom, month, dow, now, 5).map((d) =>
    loc.formatNextRun(d),
  );

  return {
    valid: true,
    error: "",
    expression: normalized,
    description,
    nextRuns,
    fields,
  };
}
