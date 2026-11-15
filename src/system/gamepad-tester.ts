/**
 * Gamepad test logic: the W3C Standard Gamepad layout, stick dead zones and drift,
 * controller style detection and test progress.
 *
 * Everything the Gamepad Tester needs that is not a DOM read: the W3C Standard Gamepad
 * layout, the dead-zone maths, the drift verdict, and the parsing of the vendor id
 * string browsers hand over. The page itself only polls `navigator.getGamepads()`.
 */

/** The shape of a Gamepad as this engine reads it — kept local so the module stays DOM-free. */
export interface GamepadLike {
  index?: number;
  id?: string;
  mapping?: string;
  connected?: boolean;
  buttons?: readonly { pressed?: boolean; value?: number }[];
  axes?: readonly number[];
  vibrationActuator?: unknown;
}

/** Which block of the controller a button belongs to — the UI groups its grid by this. */
export type ButtonGroup = "face" | "shoulder" | "trigger" | "center" | "stick" | "dpad";

/** Label set to print on the buttons. Detected from the controller id, overridable. */
export type PadStyle = "xbox" | "playstation" | "nintendo" | "generic";

export interface GamepadButtonDefinition {
  /** Position in the Standard Gamepad button array */
  index: number;
  group: ButtonGroup;
  /** Neutral, mapping-level name */
  standard: string;
  xbox: string;
  playstation: string;
  nintendo: string;
  /** True for the two triggers, which report a 0–1 value rather than just pressed */
  analog: boolean;
}

/**
 * The 17 buttons of the Standard Gamepad mapping, in array order. Pads that report
 * `mapping: "standard"` are guaranteed to use these positions; everything else is a
 * guess, which is why the tool prints the raw index next to every button.
 */
export const STANDARD_BUTTONS: GamepadButtonDefinition[] = [
  {
    index: 0,
    group: "face",
    standard: "Face bottom",
    xbox: "A",
    playstation: "Cross",
    nintendo: "B",
    analog: false,
  },
  {
    index: 1,
    group: "face",
    standard: "Face right",
    xbox: "B",
    playstation: "Circle",
    nintendo: "A",
    analog: false,
  },
  {
    index: 2,
    group: "face",
    standard: "Face left",
    xbox: "X",
    playstation: "Square",
    nintendo: "Y",
    analog: false,
  },
  {
    index: 3,
    group: "face",
    standard: "Face top",
    xbox: "Y",
    playstation: "Triangle",
    nintendo: "X",
    analog: false,
  },
  {
    index: 4,
    group: "shoulder",
    standard: "Left shoulder",
    xbox: "LB",
    playstation: "L1",
    nintendo: "L",
    analog: false,
  },
  {
    index: 5,
    group: "shoulder",
    standard: "Right shoulder",
    xbox: "RB",
    playstation: "R1",
    nintendo: "R",
    analog: false,
  },
  {
    index: 6,
    group: "trigger",
    standard: "Left trigger",
    xbox: "LT",
    playstation: "L2",
    nintendo: "ZL",
    analog: true,
  },
  {
    index: 7,
    group: "trigger",
    standard: "Right trigger",
    xbox: "RT",
    playstation: "R2",
    nintendo: "ZR",
    analog: true,
  },
  {
    index: 8,
    group: "center",
    standard: "Select",
    xbox: "View",
    playstation: "Share",
    nintendo: "Minus",
    analog: false,
  },
  {
    index: 9,
    group: "center",
    standard: "Start",
    xbox: "Menu",
    playstation: "Options",
    nintendo: "Plus",
    analog: false,
  },
  {
    index: 10,
    group: "stick",
    standard: "Left stick press",
    xbox: "LS",
    playstation: "L3",
    nintendo: "LS",
    analog: false,
  },
  {
    index: 11,
    group: "stick",
    standard: "Right stick press",
    xbox: "RS",
    playstation: "R3",
    nintendo: "RS",
    analog: false,
  },
  {
    index: 12,
    group: "dpad",
    standard: "D-pad up",
    xbox: "D-pad ↑",
    playstation: "D-pad ↑",
    nintendo: "D-pad ↑",
    analog: false,
  },
  {
    index: 13,
    group: "dpad",
    standard: "D-pad down",
    xbox: "D-pad ↓",
    playstation: "D-pad ↓",
    nintendo: "D-pad ↓",
    analog: false,
  },
  {
    index: 14,
    group: "dpad",
    standard: "D-pad left",
    xbox: "D-pad ←",
    playstation: "D-pad ←",
    nintendo: "D-pad ←",
    analog: false,
  },
  {
    index: 15,
    group: "dpad",
    standard: "D-pad right",
    xbox: "D-pad →",
    playstation: "D-pad →",
    nintendo: "D-pad →",
    analog: false,
  },
  {
    index: 16,
    group: "center",
    standard: "Home",
    xbox: "Guide",
    playstation: "PS",
    nintendo: "Home",
    analog: false,
  },
];

export interface StickDefinition {
  /** Index of the horizontal axis in the Standard Gamepad axis array */
  axisX: number;
  /** Index of the vertical axis; negative values point up */
  axisY: number;
  standard: string;
  /** Index of the button that this stick's click reports on */
  clickButton: number;
}

/** The two analog sticks of the Standard Gamepad mapping. */
export const STANDARD_STICKS: StickDefinition[] = [
  { axisX: 0, axisY: 1, standard: "Left stick", clickButton: 10 },
  { axisX: 2, axisY: 3, standard: "Right stick", clickButton: 11 },
];

/** A stick inside this radius of centre is treated as released. 10% is the usual default. */
export const DEFAULT_DEAD_ZONE = 0.1;

/** Below this, an analog trigger counts as released. Triggers rest at 0 and rarely creep. */
export const TRIGGER_THRESHOLD = 0.08;

const clamp = (n: number, min: number, max: number) => (n < min ? min : n > max ? max : n);

const finite = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StickReading {
  /** Axis values exactly as the browser reported them, −1…1 */
  rawX: number;
  rawY: number;
  /** Distance from centre before the dead zone, 0…~1.41 on a square-clamped pad */
  rawMagnitude: number;
  /** Axis values after the dead zone, rescaled so the dead-zone edge reads 0 */
  x: number;
  y: number;
  /** Distance from centre after the dead zone, 0…1 */
  magnitude: number;
  /** Compass bearing in degrees: 0 is up, 90 is right. Null when the stick is centred. */
  angleDegrees: number | null;
  /** Nearest of the eight compass directions, "" when centred */
  direction: string;
  /** True once the stick has left the dead zone */
  active: boolean;
}

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const EMPTY_STICK: StickReading = {
  rawX: 0,
  rawY: 0,
  rawMagnitude: 0,
  x: 0,
  y: 0,
  magnitude: 0,
  angleDegrees: null,
  direction: "",
  active: false,
};

/**
 * Apply a radial dead zone, which is what games actually use: the cut-off is a circle
 * around the centre, not two independent per-axis thresholds. Per-axis dead zones are
 * the reason some old PC ports let you creep diagonally but not straight ahead.
 * Past the cut-off the value is rescaled, so the stick still reaches a full 1.0 at the
 * rim instead of losing the first tenth of its travel.
 */
export function readStick(
  rawXInput: number,
  rawYInput: number,
  deadZone: number = DEFAULT_DEAD_ZONE,
): StickReading {
  const rawX = clamp(finite(rawXInput), -1, 1);
  const rawY = clamp(finite(rawYInput), -1, 1);
  const dz = clamp(finite(deadZone), 0, 0.95);

  const rawMagnitude = Math.hypot(rawX, rawY);
  if (rawMagnitude <= dz || rawMagnitude === 0) {
    return { ...EMPTY_STICK, rawX, rawY, rawMagnitude: round2(rawMagnitude) };
  }

  const scaled = Math.min(1, (rawMagnitude - dz) / (1 - dz));
  const x = (rawX / rawMagnitude) * scaled;
  const y = (rawY / rawMagnitude) * scaled;

  // Screen coordinates: y grows downward, so "up" is −y. Bearing runs clockwise from up.
  const bearing = ((Math.atan2(rawX, -rawY) * 180) / Math.PI + 360) % 360;
  const angleDegrees = Math.round(bearing) % 360;
  const direction = DIRECTIONS[Math.round(angleDegrees / 45) % 8];

  return {
    rawX,
    rawY,
    rawMagnitude: round2(rawMagnitude),
    x: round2(x),
    y: round2(y),
    magnitude: round2(scaled),
    angleDegrees,
    direction,
    active: true,
  };
}

export interface DriftSample {
  x: number;
  y: number;
}

/** "pending" — nothing sampled yet; otherwise how bad the resting offset is. */
export type DriftVerdict = "pending" | "clean" | "minor" | "drifting";

export interface DriftReport {
  samples: number;
  /** Largest distance from centre recorded while the stick was untouched */
  maxMagnitude: number;
  /** Mean distance from centre across the whole sample window */
  averageMagnitude: number;
  /** Fraction of samples that were not exactly centred */
  offCentreShare: number;
  /** Smallest dead zone, in percent, that would have silenced every sample */
  requiredDeadZonePercent: number;
  verdict: DriftVerdict;
}

const EMPTY_DRIFT: DriftReport = {
  samples: 0,
  maxMagnitude: 0,
  averageMagnitude: 0,
  offCentreShare: 0,
  requiredDeadZonePercent: 0,
  verdict: "pending",
};

/**
 * Judge a batch of at-rest samples. A healthy stick parks within a couple of percent of
 * centre; worn potentiometers sit further out and never come back, which is what makes a
 * character walk on its own. The thresholds are deliberately generous — 5% still passes,
 * because almost no pad reads a perfect zero.
 */
export function summarizeDrift(samples: readonly DriftSample[]): DriftReport {
  if (!samples || samples.length === 0) return { ...EMPTY_DRIFT };

  let max = 0;
  let total = 0;
  let offCentre = 0;

  for (const sample of samples) {
    const magnitude = Math.hypot(clamp(finite(sample?.x), -1, 1), clamp(finite(sample?.y), -1, 1));
    if (magnitude > max) max = magnitude;
    if (magnitude > 0) offCentre++;
    total += magnitude;
  }

  const verdict: DriftVerdict = max < 0.05 ? "clean" : max < 0.15 ? "minor" : "drifting";

  return {
    samples: samples.length,
    maxMagnitude: round2(max),
    averageMagnitude: round2(total / samples.length),
    offCentreShare: round2(offCentre / samples.length),
    requiredDeadZonePercent: Math.ceil(max * 100),
    verdict,
  };
}

export interface GamepadInfo {
  index: number;
  /** The raw id string, exactly as the browser reports it */
  id: string;
  /** The id with the trailing vendor/product parenthetical removed */
  name: string;
  /** Four hex digits, or "" when the browser did not expose them */
  vendorId: string;
  productId: string;
  mapping: string;
  /** True when the pad follows the Standard Gamepad button and axis order */
  standardMapping: boolean;
  buttons: number;
  axes: number;
  style: PadStyle;
  /** True when the browser exposes a vibration actuator for this pad */
  hasVibration: boolean;
}

const EMPTY_INFO: GamepadInfo = {
  index: 0,
  id: "",
  name: "",
  vendorId: "",
  productId: "",
  mapping: "",
  standardMapping: false,
  buttons: 0,
  axes: 0,
  style: "generic",
  hasVibration: false,
};

/**
 * Pick a label set from the controller id. Chrome reports something like
 * "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)", Firefox the
 * terser "054c-09cc-Wireless Controller", so both the words and the vendor id are worth
 * checking. 045e is Microsoft, 054c Sony, 057e Nintendo.
 */
export function detectStyle(id: string): PadStyle {
  const text = (id ?? "").toLowerCase();
  if (!text) return "generic";

  if (/xbox|xinput|045e|microsoft/.test(text)) return "xbox";
  if (/playstation|dualshock|dualsense|054c|sony|wireless controller/.test(text)) {
    return "playstation";
  }
  if (/nintendo|switch|joy-con|pro controller|057e/.test(text)) return "nintendo";
  return "generic";
}

/** Read the parts of a Gamepad object the readout panel prints. */
export function describeGamepad(pad: GamepadLike | null | undefined): GamepadInfo {
  if (!pad) return { ...EMPTY_INFO };

  const id = typeof pad.id === "string" ? pad.id : "";
  const vendor = /vendor:?\s*([0-9a-f]{4})/i.exec(id) ?? /^([0-9a-f]{4})-[0-9a-f]{4}/i.exec(id);
  const product = /product:?\s*([0-9a-f]{4})/i.exec(id) ?? /^[0-9a-f]{4}-([0-9a-f]{4})/i.exec(id);

  const name = id.replace(/\s*\([^)]*\)\s*$/, "").trim() || id;
  const mapping = typeof pad.mapping === "string" ? pad.mapping : "";

  return {
    index: finite(pad.index),
    id,
    name,
    vendorId: vendor ? vendor[1].toLowerCase() : "",
    productId: product ? product[1].toLowerCase() : "",
    mapping,
    standardMapping: mapping === "standard",
    buttons: pad.buttons?.length ?? 0,
    axes: pad.axes?.length ?? 0,
    style: detectStyle(id),
    hasVibration: Boolean(pad.vibrationActuator),
  };
}

/**
 * The label to print on a button for the given controller family. An unrecognised pad
 * gets `B0`…`B16` rather than a guessed name: on a non-standard mapping the button at
 * index 0 is not necessarily the bottom face button, and a wrong label is worse than
 * a bare index.
 */
export function buttonLabel(button: GamepadButtonDefinition, style: PadStyle): string {
  if (style === "xbox") return button.xbox;
  if (style === "playstation") return button.playstation;
  if (style === "nintendo") return button.nintendo;
  return `B${button.index}`;
}

export interface GamepadProgress {
  buttonsTested: number;
  buttonsTotal: number;
  axesTested: number;
  axesTotal: number;
  /** Share of inputs exercised at least once, 0–100 */
  percent: number;
  /** Labels of inputs that have never moved, in array order */
  remaining: string[];
  complete: boolean;
}

const EMPTY_PROGRESS: GamepadProgress = {
  buttonsTested: 0,
  buttonsTotal: 0,
  axesTested: 0,
  axesTotal: 0,
  percent: 0,
  remaining: [],
  complete: false,
};

/**
 * Coverage is measured against the pad's own counts, not against the 17+4 of the standard
 * mapping — a racing wheel or an arcade stick reports fewer inputs and should still be
 * able to finish the test.
 */
export function summarizeProgress(
  pressedButtons: Iterable<number>,
  movedAxes: Iterable<number>,
  buttonCount: number,
  axisCount: number,
  style: PadStyle = "generic",
): GamepadProgress {
  const buttonsTotal = Math.max(0, Math.trunc(finite(buttonCount)));
  const axesTotal = Math.max(0, Math.trunc(finite(axisCount)));
  if (buttonsTotal === 0 && axesTotal === 0) return { ...EMPTY_PROGRESS, remaining: [] };

  const pressed = new Set(pressedButtons ?? []);
  const moved = new Set(movedAxes ?? []);
  const remaining: string[] = [];

  let buttonsTested = 0;
  for (let i = 0; i < buttonsTotal; i++) {
    if (pressed.has(i)) {
      buttonsTested++;
      continue;
    }
    const definition = STANDARD_BUTTONS[i];
    remaining.push(definition ? buttonLabel(definition, style) : `Button ${i}`);
  }

  let axesTested = 0;
  for (let i = 0; i < axesTotal; i++) {
    if (moved.has(i)) {
      axesTested++;
      continue;
    }
    remaining.push(`Axis ${i}`);
  }

  const total = buttonsTotal + axesTotal;
  const tested = buttonsTested + axesTested;

  return {
    buttonsTested,
    buttonsTotal,
    axesTested,
    axesTotal,
    percent: Math.round((tested / total) * 100),
    remaining,
    complete: tested === total,
  };
}
