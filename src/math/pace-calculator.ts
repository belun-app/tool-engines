/**
 * Running pace calculator: solves for pace, time or distance from the other two, in
 * kilometres or miles, with split times.
 */

export type PaceUnit = "km" | "mi";
export type PaceSolveFor = "pace" | "time" | "distance";

export interface PaceSplit {
  distance: number;
  cumulativeSeconds: number;
}

export interface PaceInput {
  solveFor: PaceSolveFor;
  unit: PaceUnit;
  distance: number;
  timeSeconds: number;
  paceSeconds: number;
}

export interface PaceResult {
  valid: boolean;
  distance: number;
  distanceKm: number;
  distanceMi: number;
  totalSeconds: number;
  paceSecondsPerKm: number;
  paceSecondsPerMi: number;
  speedKmh: number;
  speedMph: number;
  splits: PaceSplit[];
}

const KM_PER_MILE = 1.609344;
const MAX_SPLIT_ROWS = 30;

function emptyResult(): PaceResult {
  return {
    valid: false,
    distance: 0,
    distanceKm: 0,
    distanceMi: 0,
    totalSeconds: 0,
    paceSecondsPerKm: 0,
    paceSecondsPerMi: 0,
    speedKmh: 0,
    speedMph: 0,
    splits: [],
  };
}

function buildSplits(distance: number, paceSeconds: number): PaceSplit[] {
  if (distance <= 0 || paceSeconds <= 0) return [];
  const whole = Math.floor(distance);
  const step = whole > MAX_SPLIT_ROWS ? Math.ceil(whole / MAX_SPLIT_ROWS) : 1;
  const splits: PaceSplit[] = [];
  for (let d = step; d <= whole; d += step) {
    splits.push({ distance: d, cumulativeSeconds: d * paceSeconds });
  }
  if (distance > whole || splits.length === 0 || splits[splits.length - 1].distance < distance) {
    splits.push({ distance, cumulativeSeconds: distance * paceSeconds });
  }
  return splits;
}

export function calculatePace(input: PaceInput): PaceResult {
  const { solveFor, unit } = input;
  let { distance, timeSeconds, paceSeconds } = input;

  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(timeSeconds) ||
    !Number.isFinite(paceSeconds)
  ) {
    return emptyResult();
  }

  if (solveFor === "pace") {
    if (distance <= 0 || timeSeconds <= 0) return emptyResult();
    paceSeconds = timeSeconds / distance;
  } else if (solveFor === "time") {
    if (distance <= 0 || paceSeconds <= 0) return emptyResult();
    timeSeconds = paceSeconds * distance;
  } else {
    if (timeSeconds <= 0 || paceSeconds <= 0) return emptyResult();
    distance = timeSeconds / paceSeconds;
  }

  const distanceKm = unit === "km" ? distance : distance * KM_PER_MILE;
  const distanceMi = unit === "mi" ? distance : distance / KM_PER_MILE;

  return {
    valid: true,
    distance,
    distanceKm,
    distanceMi,
    totalSeconds: timeSeconds,
    paceSecondsPerKm: timeSeconds / distanceKm,
    paceSecondsPerMi: timeSeconds / distanceMi,
    speedKmh: distanceKm / (timeSeconds / 3600),
    speedMph: distanceMi / (timeSeconds / 3600),
    splits: buildSplits(distance, paceSeconds),
  };
}

export function formatTime(totalSeconds: number): string {
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

export function formatPace(secondsPerUnit: number): string {
  const total = Math.round(secondsPerUnit);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
