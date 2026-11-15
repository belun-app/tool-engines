/**
 * Chess clock engine — a pure, deterministic state machine.
 *
 * No DOM and no clock of its own: every function that needs "now" takes it as
 * an argument (the mount passes `performance.now()`), so a test can drive a
 * whole game with a fake clock.
 *
 * Time is never counted in ticks. For the side whose turn it is the engine
 * keeps the remaining time at the start of the turn (`remaining[active]`, the
 * anchor) plus the time already used in this turn before the last resume
 * (`turnUsed`), and the timestamp of that resume (`turnStart`). The value on
 * the display is always `anchor − charged(turnUsed + (now − turnStart))`,
 * so a frame that is late, or a tab that slept for a minute, still shows the
 * exact time the moment it is read again.
 *
 * Bonus modes, per period:
 *   - fischer   — `bonusMs` is added after every completed move;
 *   - bronstein — after the move, min(time used this turn, bonusMs) is added back;
 *   - delay     — simple (US) delay: the first `bonusMs` of each turn are free,
 *                 the main time only starts falling after them;
 *   - none      — sudden death.
 *
 * Multi-stage controls: a player's `periods[i]` starts once that player has
 * completed `periods[i].afterMoves` moves (cumulative), at which point
 * `timeMs` is added to their clock and the period's bonus applies from then on.
 * FIDE classical 90/40+30 is periods [{0, 90 min, 30 s fischer},
 * {40, 30 min, 30 s fischer}].
 */

export type BonusMode = "fischer" | "bronstein" | "delay" | "none";
export type Side = 0 | 1;
export type ClockStatus = "idle" | "running" | "paused" | "flagged";
type Pair<T> = [T, T];

export interface Period {
  /** Cumulative number of this player's completed moves after which the period starts (0 for the first). */
  afterMoves: number;
  /** Time put on the clock when the period starts — the base time for the first period. */
  timeMs: number;
  bonusMs: number;
  mode: BonusMode;
}

export interface PlayerControl {
  periods: Period[];
}

/** players[0] is the left player (top in portrait), players[1] the right one (bottom). */
export interface TimeControl {
  players: Pair<PlayerControl>;
}

export const LIMITS = {
  maxBaseMs: 10 * 3_600_000,
  maxStageMs: 10 * 3_600_000,
  maxBonusMs: 300_000,
  maxPeriods: 3,
  maxMoves: 500,
  /** Ceiling for an arbiter adjustment. */
  maxClockMs: 24 * 3_600_000,
  maxHistory: 2000,
} as const;

export const BONUS_MODES: readonly BonusMode[] = ["fischer", "bronstein", "delay", "none"];

const MIN = 60_000;
const SEC = 1000;

export const other = (side: Side): Side => (side === 0 ? 1 : 0);

function setAt<T>(pair: Pair<T>, side: Side, value: T): Pair<T> {
  return side === 0 ? [value, pair[1]] : [pair[0], value];
}

/** Bonus 0 and mode "none" mean the same thing; keep one spelling so controls compare equal. */
export function normalizePeriod(p: Period): Period {
  if (p.mode === "none" || p.bonusMs <= 0) return { ...p, bonusMs: 0, mode: "none" };
  return { ...p };
}

/** The same single-period control for both players: `simpleControl(5 * 60_000, 3000, "fischer")` is 5+3. */
export function simpleControl(
  baseMs: number,
  bonusMs = 0,
  mode: BonusMode = "fischer",
): TimeControl {
  const player = (): PlayerControl => ({
    periods: [normalizePeriod({ afterMoves: 0, timeMs: baseMs, bonusMs, mode })],
  });
  return { players: [player(), player()] };
}

function clonePlayer(p: PlayerControl): PlayerControl {
  return { periods: p.periods.map((x) => ({ ...x })) };
}

export function cloneControl(c: TimeControl): TimeControl {
  return { players: [clonePlayer(c.players[0]), clonePlayer(c.players[1])] };
}

// ---------------------------------------------------------------- validation

export type IssueField = "time" | "bonus" | "moves";
export type IssueCode = "invalid" | "zeroBase" | "tooLarge" | "order" | "tooMany";

export interface ValidationIssue {
  side: Side;
  /** 0 = base period, 1 = stage 2, 2 = stage 3. */
  period: number;
  field: IssueField;
  code: IssueCode;
}

const isNonNegFinite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Every problem with a control; an empty array means the clock can be built from it. */
export function validateControl(control: TimeControl): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const side of [0, 1] as const) {
    const periods = control.players[side]?.periods ?? [];
    if (periods.length === 0) {
      issues.push({ side, period: 0, field: "time", code: "invalid" });
      continue;
    }
    if (periods.length > LIMITS.maxPeriods) {
      issues.push({ side, period: LIMITS.maxPeriods, field: "moves", code: "tooMany" });
    }
    periods.forEach((p, i) => {
      const push = (field: IssueField, code: IssueCode) =>
        issues.push({ side, period: i, field, code });
      if (!isNonNegFinite(p.timeMs)) push("time", "invalid");
      else if (p.timeMs > (i === 0 ? LIMITS.maxBaseMs : LIMITS.maxStageMs))
        push("time", "tooLarge");
      if (!BONUS_MODES.includes(p.mode)) push("bonus", "invalid");
      else if (!isNonNegFinite(p.bonusMs)) push("bonus", "invalid");
      else if (p.bonusMs > LIMITS.maxBonusMs) push("bonus", "tooLarge");
      if (i === 0) {
        if (p.afterMoves !== 0) push("moves", "order");
        // A clock that starts at 0:00 flags the moment it runs — except under
        // simple delay, where every move still gets its free delay seconds.
        const freeTime = p.mode === "delay" && p.bonusMs > 0;
        if (isNonNegFinite(p.timeMs) && p.timeMs === 0 && !freeTime) push("time", "zeroBase");
      } else {
        const prev = periods[i - 1]?.afterMoves ?? 0;
        if (
          !Number.isInteger(p.afterMoves) ||
          p.afterMoves < 1 ||
          p.afterMoves <= prev ||
          p.afterMoves > LIMITS.maxMoves
        )
          push("moves", "order");
      }
    });
  }
  return issues;
}

// ---------------------------------------------------------------- notation

const SEG_RE =
  /^(?:G\/?)?(\d{1,4}(?:\.\d{1,3})?|\d{1,4}:\d{1,2}(?::\d{1,2})?)(?:\/(\d{1,3}))?(?:([+db])(\d{1,3}(?:\.\d{1,3})?))?$/i;

function parseClockTime(text: string): number | null {
  if (!text.includes(":")) return Math.round(Number.parseFloat(text) * MIN);
  const parts = text.split(":").map((x) => Number.parseInt(x, 10));
  if (parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 2) {
    const [m, s] = parts as [number, number];
    if (s >= 60) return null;
    return m * MIN + s * SEC;
  }
  const [h, m, s] = parts as [number, number, number];
  if (m >= 60 || s >= 60) return null;
  return h * 3_600_000 + m * MIN + s * SEC;
}

function parsePlayer(text: string): PlayerControl | null {
  const segs = text.split(",");
  if (segs.length < 1 || segs.length > LIMITS.maxPeriods) return null;
  const periods: Period[] = [];
  let afterMoves = 0;
  for (let i = 0; i < segs.length; i++) {
    const m = SEG_RE.exec(segs[i] ?? "");
    if (!m) return null;
    const timeMs = parseClockTime(m[1] ?? "");
    if (timeMs === null || !Number.isFinite(timeMs)) return null;
    const moves = m[2] ? Number.parseInt(m[2], 10) : null;
    // Every period but the last must say how many moves it lasts.
    if (i < segs.length - 1 && (moves === null || moves < 1)) return null;
    const sign = (m[3] ?? "").toLowerCase();
    const mode: BonusMode =
      sign === "+" ? "fischer" : sign === "d" ? "delay" : sign === "b" ? "bronstein" : "none";
    const bonusMs = m[4] ? Math.round(Number.parseFloat(m[4]) * SEC) : 0;
    periods.push(normalizePeriod({ afterMoves, timeMs, bonusMs, mode }));
    if (moves !== null) afterMoves += moves;
  }
  return { periods };
}

/**
 * Parse the share-link notation. Grammar (case-insensitive):
 *
 *   control := player ( "~" player )?          second player only for time odds
 *   player  := period ( "," period ){0,2}       up to three periods
 *   period  := "G"? "/"? time ( "/" moves )? ( ("+" | "d" | "b") seconds )?
 *   time    := minutes | m:ss | h:mm:ss
 *
 * `+` is a Fischer increment, `d` a simple delay, `b` a Bronstein delay; no
 * suffix is sudden death. `/moves` is the number of moves the period lasts.
 * A space is read as `+`, because `?tc=5+3` arrives URL-decoded as "5 3"; a space
 * or `+` right before `d`/`b` is dropped, so "G/5 d2" reads as G5d2.
 * Returns null for anything malformed or out of range.
 */
export function parseTimeControl(raw: string): TimeControl | null {
  if (typeof raw !== "string") return null;
  // "G/5 d2" (as printed on US clocks) and "G/5+d2" (the same, URL-decoded) mean G5d2.
  const text = raw
    .trim()
    .replace(/\s/g, "+")
    .replace(/\++(?=[db]\d)/gi, "");
  if (text.length === 0 || text.length > 120) return null;
  const parts = text.split("~");
  if (parts.length > 2) return null;
  const first = parsePlayer(parts[0] ?? "");
  if (!first) return null;
  const second = parts.length === 2 ? parsePlayer(parts[1] ?? "") : clonePlayer(first);
  if (!second) return null;
  const control: TimeControl = { players: [first, second] };
  return validateControl(control).length === 0 ? control : null;
}

function formatMinutes(ms: number): string {
  if (ms % MIN === 0) return String(ms / MIN);
  if (ms % SEC === 0) {
    const total = ms / SEC;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }
  return String(Number((ms / MIN).toFixed(3)));
}

const formatSeconds = (ms: number) => String(Number((ms / SEC).toFixed(3)));

function formatPlayer(p: PlayerControl): string {
  return p.periods
    .map((period, i) => {
      const next = p.periods[i + 1];
      const prefix = i === 0 && period.mode === "delay" ? "G" : "";
      const moves = next ? `/${next.afterMoves - period.afterMoves}` : "";
      const b = formatSeconds(period.bonusMs);
      const suffix =
        period.mode === "fischer"
          ? `+${b}`
          : period.mode === "delay"
            ? `d${b}`
            : period.mode === "bronstein"
              ? `b${b}`
              : "+0";
      return `${prefix}${formatMinutes(period.timeMs)}${moves}${suffix}`;
    })
    .join(",");
}

/** Inverse of `parseTimeControl`: "5+3", "G5d2", "90/40+30,30+30", "5+0~3+0". */
export function formatTimeControl(control: TimeControl): string {
  const a = formatPlayer(control.players[0]);
  const b = formatPlayer(control.players[1]);
  return a === b ? a : `${a}~${b}`;
}

// ---------------------------------------------------------------- presets

export type PresetGroup = "bullet" | "blitz" | "rapid" | "classical" | "delay";

export interface Preset {
  group: PresetGroup;
  /** Button text. */
  label: string;
  /** Canonical notation — equals `formatTimeControl(parseTimeControl(tc))`. */
  tc: string;
}

/**
 * Grouped by FIDE category (base + 60 × bonus: ≤ 10 min blitz, under 60 min
 * rapid, otherwise standard), with bullet split out of blitz as players
 * expect; a test keeps every group consistent with `fideCategory`.
 */
export const PRESETS: readonly Preset[] = [
  { group: "bullet", label: "1+0", tc: "1+0" },
  { group: "bullet", label: "1+1", tc: "1+1" },
  { group: "bullet", label: "2+1", tc: "2+1" },
  { group: "blitz", label: "3+0", tc: "3+0" },
  { group: "blitz", label: "3+2", tc: "3+2" },
  { group: "blitz", label: "5+0", tc: "5+0" },
  { group: "blitz", label: "5+3", tc: "5+3" },
  { group: "blitz", label: "10+0", tc: "10+0" },
  { group: "rapid", label: "10+5", tc: "10+5" },
  { group: "rapid", label: "15+10", tc: "15+10" },
  { group: "rapid", label: "25+10", tc: "25+10" },
  { group: "rapid", label: "30+0", tc: "30+0" },
  { group: "rapid", label: "30+20", tc: "30+20" },
  { group: "classical", label: "60+30", tc: "60+30" },
  { group: "classical", label: "90+30", tc: "90+30" },
  { group: "classical", label: "FIDE 90/40+30", tc: "90/40+30,30+30" },
  { group: "delay", label: "G/5 d2", tc: "G5d2" },
  { group: "delay", label: "G/30 d5", tc: "G30d5" },
  { group: "delay", label: "G/90 d5", tc: "G90d5" },
];

export const DEFAULT_TC = "5+3";

// ---------------------------------------------------------------- reference

export type FideCategory = "blitz" | "rapid" | "standard";

/**
 * The most time one player can spend on their first `moves` moves: the base,
 * every stage that starts before the last of those moves, and the bonus each
 * move earns (Fischer increment, or the free seconds of a Bronstein or simple
 * delay — the most a delay can save per move). This is how FIDE sizes a
 * control: "the time allotted plus 60 times any increment".
 */
export function timeForMoves(player: PlayerControl, moves: number): number {
  const periods = player.periods;
  let total = 0;
  for (const p of periods) if (p.afterMoves === 0 || p.afterMoves < moves) total += p.timeMs;
  for (let move = 1; move <= moves; move++) {
    // Move n is played in the last period that started after n − 1 completed moves.
    let period = periods[0];
    for (const p of periods) if (p.afterMoves <= move - 1) period = p;
    if (period && period.mode !== "none") total += period.bonusMs;
  }
  return total;
}

/**
 * FIDE category from the 60-move time (FIDE Laws, Appendices A and B):
 * 10 minutes or less is blitz, more than 10 and under 60 is rapid, 60 or more
 * is standard. The larger of the two players' times counts for odds games.
 */
export function fideCategory(control: TimeControl): FideCategory {
  const ms = Math.max(timeForMoves(control.players[0], 60), timeForMoves(control.players[1], 60));
  if (ms <= 10 * MIN) return "blitz";
  if (ms < 60 * MIN) return "rapid";
  return "standard";
}

export interface PresetReferenceRow {
  preset: Preset;
  /** Most time per player for the first 40 moves (≈ what online sites use to classify). */
  per40Ms: number;
  /** Most time per player for the first 60 moves (what FIDE uses to classify). */
  per60Ms: number;
  /** Longest a 60-move game can last: both players' 60-move time together. */
  game60Ms: number;
  category: FideCategory;
}

/** One row per preset for the "how long each time control lasts" table. */
export function presetReference(presets: readonly Preset[] = PRESETS): PresetReferenceRow[] {
  return presets.flatMap((preset) => {
    const control = parseTimeControl(preset.tc);
    if (!control) return [];
    const [a, b] = control.players;
    return [
      {
        preset,
        per40Ms: Math.max(timeForMoves(a, 40), timeForMoves(b, 40)),
        per60Ms: Math.max(timeForMoves(a, 60), timeForMoves(b, 60)),
        game60Ms: timeForMoves(a, 60) + timeForMoves(b, 60),
        category: fideCategory(control),
      },
    ];
  });
}

/** "7 min", "43 min 20 s", "2 h 30 min" — compact durations for the reference table. */
export function formatDuration(ms: number, units = { h: "h", min: "min", s: "s" }): string {
  const total = Math.round(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${units.h}`);
  if (m) parts.push(`${m} ${units.min}`);
  if (s || parts.length === 0) parts.push(`${s} ${units.s}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------- clock state

interface Snapshot {
  /** For the active side: time at the start of the turn. For the other side: its exact time. */
  remaining: Pair<number>;
  moves: Pair<number>;
  /** Index into each player's periods. */
  period: Pair<number>;
  /** Whose clock runs (or would run on resume); null before the first press. */
  active: Side | null;
  /** Time used in the current turn before the last resume. */
  turnUsed: number;
}

export interface ClockState extends Snapshot {
  control: TimeControl;
  status: ClockStatus;
  /** Timestamp of the last start/resume while running, else null. */
  turnStart: number | null;
  flagged: Side | null;
  /**
   * The side playing White: set by the first press (the other side is Black),
   * or predicted by `swapColours` for the next game. Null when unknown.
   */
  white: Side | null;
  /** States before each press or adjustment, newest last — what `undo` returns to. */
  history: Snapshot[];
}

export function createClock(control: TimeControl, white: Side | null = null): ClockState {
  const c = cloneControl(control);
  const base = (side: Side) => c.players[side].periods[0]?.timeMs ?? 0;
  return {
    control: c,
    status: "idle",
    remaining: [base(0), base(1)],
    moves: [0, 0],
    period: [0, 0],
    active: null,
    turnUsed: 0,
    turnStart: null,
    flagged: null,
    white,
    history: [],
  };
}

export function currentPeriod(state: ClockState, side: Side): Period {
  const periods = state.control.players[side].periods;
  return (periods[state.period[side]] ?? periods[0]) as Period;
}

/** Time used in the current turn, across pauses. */
export function turnElapsed(state: ClockState, now: number): number {
  const live =
    state.status === "running" && state.turnStart !== null ? Math.max(0, now - state.turnStart) : 0;
  return state.turnUsed + live;
}

/** How much of `elapsed` comes off the main time under the period's mode. */
function charged(elapsed: number, period: Period): number {
  return period.mode === "delay" ? Math.max(0, elapsed - period.bonusMs) : elapsed;
}

const inTurn = (state: ClockState, side: Side) =>
  state.active === side && (state.status === "running" || state.status === "paused");

/** The time a side's clock shows right now; never below zero. */
export function remainingFor(state: ClockState, side: Side, now: number): number {
  if (!inTurn(state, side)) return Math.max(0, state.remaining[side]);
  const used = charged(turnElapsed(state, now), currentPeriod(state, side));
  return Math.max(0, state.remaining[side] - used);
}

/** Simple-delay seconds still free in the current turn (0 for other modes and the waiting side). */
export function delayLeftFor(state: ClockState, side: Side, now: number): number {
  if (!inTurn(state, side)) return 0;
  const p = currentPeriod(state, side);
  if (p.mode !== "delay") return 0;
  return Math.max(0, p.bonusMs - turnElapsed(state, now));
}

/** Milliseconds until the running side's flag falls, or null when nothing is running. */
export function msUntilFlag(state: ClockState, now: number): number | null {
  if (state.status !== "running" || state.active === null) return null;
  return remainingFor(state, state.active, now) + delayLeftFor(state, state.active, now);
}

/** Bring the state up to `now`: if the running clock has reached 0, the flag falls. */
export function settle(state: ClockState, now: number): ClockState {
  if (state.status !== "running" || state.active === null) return state;
  const side = state.active;
  // Under simple delay the flag can only fall once the free seconds are spent.
  if (remainingFor(state, side, now) > 0 || delayLeftFor(state, side, now) > 0) return state;
  return {
    ...state,
    status: "flagged",
    flagged: side,
    remaining: setAt(state.remaining, side, 0),
    turnUsed: turnElapsed(state, now),
    turnStart: null,
  };
}

function snapshot(state: ClockState, turnUsed: number): Snapshot {
  return {
    remaining: [...state.remaining] as Pair<number>,
    moves: [...state.moves] as Pair<number>,
    period: [...state.period] as Pair<number>,
    active: state.active,
    turnUsed,
  };
}

function pushHistory(history: Snapshot[], entry: Snapshot): Snapshot[] {
  const next = [...history, entry];
  return next.length > LIMITS.maxHistory ? next.slice(next.length - LIMITS.maxHistory) : next;
}

/**
 * `side` presses their clock button — the end of their turn.
 *
 * - Idle: the press starts the *opponent's* clock (Black presses to start White's).
 * - Running: only the side whose clock runs can end the turn; a press from the
 *   other side changes nothing, which is what makes a double tap harmless.
 * - Paused or flagged: ignored.
 */
export function press(state: ClockState, side: Side, now: number): ClockState {
  const s = settle(state, now);
  if (s.status === "idle") {
    return {
      ...s,
      status: "running",
      active: other(side),
      white: other(side),
      turnUsed: 0,
      turnStart: now,
      history: pushHistory(s.history, snapshot(s, 0)),
    };
  }
  if (s.status !== "running" || s.active !== side) return s;

  const elapsed = turnElapsed(s, now);
  const period = currentPeriod(s, side);
  let rem = s.remaining[side] - charged(elapsed, period);
  if (period.mode === "fischer") rem += period.bonusMs;
  else if (period.mode === "bronstein") rem += Math.min(elapsed, period.bonusMs);

  const moves = s.moves[side] + 1;
  let periodIndex = s.period[side];
  const next = s.control.players[side].periods[periodIndex + 1];
  if (next && moves >= next.afterMoves) {
    rem += next.timeMs;
    periodIndex += 1;
  }

  return {
    ...s,
    remaining: setAt(s.remaining, side, rem),
    moves: setAt(s.moves, side, moves),
    period: setAt(s.period, side, periodIndex),
    active: other(side),
    turnUsed: 0,
    turnStart: now,
    history: pushHistory(s.history, snapshot(s, elapsed)),
  };
}

/**
 * Space bar: end the turn of whoever is running. Before the game it starts
 * the left clock (as if the right player, holding Black, had pressed).
 */
export function pressActive(state: ClockState, now: number): ClockState {
  const s = settle(state, now);
  if (s.status === "idle") return press(s, 1, now);
  if (s.status !== "running" || s.active === null) return s;
  return press(s, s.active, now);
}

export function pause(state: ClockState, now: number): ClockState {
  const s = settle(state, now);
  if (s.status !== "running") return s;
  return { ...s, status: "paused", turnUsed: turnElapsed(s, now), turnStart: null };
}

export function resume(state: ClockState, now: number): ClockState {
  if (state.status !== "paused" || state.active === null) return state;
  return settle({ ...state, status: "running", turnStart: now }, now);
}

export function togglePause(state: ClockState, now: number): ClockState {
  return state.status === "paused" ? resume(state, now) : pause(state, now);
}

/**
 * Undo the last press: both clocks, move counters and stages go back to the
 * moment before it, and the clock is left paused (or idle, if the press undone
 * was the one that started the game). Not available after a flag.
 */
export function undo(state: ClockState, now: number): ClockState {
  const s = settle(state, now);
  if (s.status === "flagged" || s.history.length === 0) return s;
  const last = s.history[s.history.length - 1] as Snapshot;
  return {
    ...s,
    remaining: [...last.remaining] as Pair<number>,
    moves: [...last.moves] as Pair<number>,
    period: [...last.period] as Pair<number>,
    active: last.active,
    turnUsed: last.turnUsed,
    turnStart: null,
    status: last.active === null ? "idle" : "paused",
    history: s.history.slice(0, -1),
  };
}

export const canUndo = (state: ClockState) =>
  state.status !== "flagged" && state.history.length > 0;

/**
 * Arbiter correction: add `deltaMs` (negative to remove) to one side's clock.
 * Only while paused or before the start. The shown time is clamped to
 * [0, LIMITS.maxClockMs].
 */
export function adjust(state: ClockState, side: Side, deltaMs: number, now: number): ClockState {
  if (state.status !== "paused" && state.status !== "idle") return state;
  if (!Number.isFinite(deltaMs)) return state;
  const shown = remainingFor(state, side, now);
  const target = Math.min(LIMITS.maxClockMs, Math.max(0, shown + deltaMs));
  if (target === shown) return state;
  return {
    ...state,
    remaining: setAt(state.remaining, side, state.remaining[side] + (target - shown)),
    // An adjustment is undoable like a press: Undo reverses the last action.
    history: pushHistory(state.history, snapshot(state, state.turnUsed)),
  };
}

export function reset(state: ClockState): ClockState {
  return createClock(state.control);
}

/**
 * A fresh game with the colours swapped: the players keep their seats and
 * their halves of the clock, and the side that had Black now has White.
 * (The first press still decides it for real.)
 */
export function swapColours(state: ClockState): ClockState {
  return createClock(state.control, state.white === null ? null : other(state.white));
}

// ---------------------------------------------------------------- reading

export interface SideView {
  remainingMs: number;
  /** Simple-delay countdown still to run before the main time moves. */
  delayLeftMs: number;
  moves: number;
  /** 0-based period index. */
  period: number;
  periods: number;
  /** Moves this player still has to make before the next period's time is added; null in the last period. */
  movesToNextPeriod: number | null;
  /** True while this side's clock is the one counting down. */
  running: boolean;
  flagged: boolean;
  /** "white" / "black" once known (first press or a swap), else null. */
  colour: "white" | "black" | null;
}

export interface ClockView {
  status: ClockStatus;
  active: Side | null;
  flagged: Side | null;
  sides: Pair<SideView>;
}

export function readClock(state: ClockState, now: number): ClockView {
  const s = settle(state, now);
  const side = (i: Side): SideView => {
    const periods = s.control.players[i].periods;
    const next = periods[s.period[i] + 1];
    return {
      remainingMs: remainingFor(s, i, now),
      delayLeftMs: delayLeftFor(s, i, now),
      moves: s.moves[i],
      period: s.period[i],
      periods: periods.length,
      movesToNextPeriod: next ? Math.max(0, next.afterMoves - s.moves[i]) : null,
      running: s.status === "running" && s.active === i,
      flagged: s.flagged === i,
      colour: s.white === null ? null : s.white === i ? "white" : "black",
    };
  };
  return { status: s.status, active: s.active, flagged: s.flagged, sides: [side(0), side(1)] };
}

/**
 * Low-time warning threshold for a side. "auto" is 20 s or 10 % of the base
 * time, whichever is larger; a number is a fixed threshold in ms; "off" is 0.
 */
export function lowTimeThreshold(
  control: TimeControl,
  side: Side,
  setting: "auto" | "off" | number,
): number {
  if (setting === "off") return 0;
  if (typeof setting === "number") return Math.max(0, setting);
  const base = control.players[side].periods[0]?.timeMs ?? 0;
  return Math.max(20_000, Math.round(base * 0.1));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Clock face text. At or above `tenthsBelowMs` whole seconds are rounded up,
 * so 0:00 only ever appears on a fallen flag ("4:59" after the first instant
 * of a 5-minute clock is the rounding chess players expect: "5:00" until a
 * full second has gone). Tenths take over one second before the threshold, so
 * with the default 10 s the face goes "0:11" → "10.9" → … → "9.9" → "0.3",
 * never jumping from "0:11" straight to "10.0"; tenths are rounded down.
 * `tenthsBelowMs = 0` never shows tenths.
 */
export function formatClock(ms: number, tenthsBelowMs = 10_000): string {
  const t = Math.max(0, Number.isFinite(ms) ? ms : 0);
  if (tenthsBelowMs > 0 && t < tenthsBelowMs + 1000) {
    const tenths = Math.floor(t / 100);
    const secs = Math.floor(tenths / 10);
    const frac = tenths % 10;
    if (secs < 60) return `${secs}.${frac}`;
    return `${Math.floor(secs / 60)}:${pad2(secs % 60)}.${frac}`;
  }
  const total = Math.ceil(t / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

// ---------------------------------------------------------------- persistence

export interface SavedClock {
  v: 1;
  control: TimeControl;
  status: "idle" | "paused" | "flagged";
  remaining: Pair<number>;
  moves: Pair<number>;
  period: Pair<number>;
  active: Side | null;
  turnUsed: number;
  flagged: Side | null;
  /** Optional: absent in games saved before colours were tracked. */
  white?: Side | null;
  history: Snapshot[];
}

/**
 * A storable copy of the game. A running clock is saved as paused at `now`,
 * so a reload never brings back a clock that has been silently running.
 * Timestamps are dropped: performance.now() means nothing after a reload.
 */
export function serializeClock(state: ClockState, now: number): SavedClock {
  const s = pause(settle(state, now), now);
  return {
    v: 1,
    control: cloneControl(s.control),
    status: s.status === "running" ? "paused" : s.status,
    remaining: [...s.remaining] as Pair<number>,
    moves: [...s.moves] as Pair<number>,
    period: [...s.period] as Pair<number>,
    active: s.active,
    turnUsed: s.turnUsed,
    flagged: s.flagged,
    white: s.white,
    history: s.history.map((h) => snapshot({ ...s, ...h }, h.turnUsed)),
  };
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isSideOrNull = (x: unknown): x is Side | null => x === 0 || x === 1 || x === null;
const isTime = (x: unknown): x is number => isNonNegFinite(x) && x <= LIMITS.maxClockMs * 2;
const isCount = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 100_000;
const isPairOf = (x: unknown, check: (v: unknown) => boolean): x is Pair<number> =>
  Array.isArray(x) && x.length === 2 && check(x[0]) && check(x[1]);

function readControl(x: unknown): TimeControl | null {
  if (!isObj(x) || !Array.isArray(x.players) || x.players.length !== 2) return null;
  const players: PlayerControl[] = [];
  for (const p of x.players) {
    if (!isObj(p) || !Array.isArray(p.periods)) return null;
    const periods: Period[] = [];
    for (const q of p.periods) {
      if (!isObj(q)) return null;
      const { afterMoves, timeMs, bonusMs, mode } = q;
      if (typeof afterMoves !== "number" || typeof timeMs !== "number") return null;
      if (typeof bonusMs !== "number" || typeof mode !== "string") return null;
      periods.push({ afterMoves, timeMs, bonusMs, mode: mode as BonusMode });
    }
    players.push({ periods });
  }
  const control: TimeControl = {
    players: [players[0] as PlayerControl, players[1] as PlayerControl],
  };
  return validateControl(control).length === 0 ? control : null;
}

function readSnapshot(x: unknown, control: TimeControl): Snapshot | null {
  if (!isObj(x)) return null;
  const { remaining, moves, period, active, turnUsed } = x;
  if (!isPairOf(remaining, isTime) || !isPairOf(moves, isCount) || !isPairOf(period, isCount))
    return null;
  if (!isSideOrNull(active) || !isTime(turnUsed)) return null;
  for (const side of [0, 1] as const) {
    if (period[side] >= control.players[side].periods.length) return null;
  }
  return {
    remaining: [remaining[0], remaining[1]],
    moves: [moves[0], moves[1]],
    period: [period[0], period[1]],
    active,
    turnUsed,
  };
}

/** Rebuild a clock from stored data, checking its shape; null if anything is off. */
export function restoreClock(data: unknown): ClockState | null {
  if (!isObj(data) || data.v !== 1) return null;
  const control = readControl(data.control);
  if (!control) return null;
  const base = readSnapshot(data, control);
  if (!base) return null;
  const status = data.status === "running" ? "paused" : data.status;
  if (status !== "idle" && status !== "paused" && status !== "flagged") return null;
  if (!isSideOrNull(data.flagged)) return null;
  if (status !== "idle" && base.active === null) return null;
  if (status === "flagged" && data.flagged === null) return null;
  if (!Array.isArray(data.history)) return null;
  const history: Snapshot[] = [];
  for (const h of data.history.slice(-LIMITS.maxHistory)) {
    const snap = readSnapshot(h, control);
    if (!snap) return null;
    history.push(snap);
  }
  return {
    ...base,
    control,
    status,
    turnStart: null,
    flagged: status === "flagged" ? data.flagged : null,
    white: data.white === 0 || data.white === 1 ? data.white : null,
    history,
  };
}

/** JSON.parse in a try/catch plus the shape check — for reading localStorage. */
export function parseSavedClock(json: string | null | undefined): ClockState | null {
  if (typeof json !== "string" || json.length === 0) return null;
  try {
    return restoreClock(JSON.parse(json));
  } catch {
    return null;
  }
}
