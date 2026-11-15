import { describe, expect, it } from "vitest";
import {
  STANDARD_BUTTONS,
  STANDARD_STICKS,
  buttonLabel,
  describeGamepad,
  detectStyle,
  readStick,
  summarizeDrift,
  summarizeProgress,
} from "./gamepad-tester.js";

// Polling navigator.getGamepads() and rumble are hardware-bound (mount only);
// everything below operates on plain Gamepad-shaped objects.

describe("STANDARD_BUTTONS / STANDARD_STICKS", () => {
  it("follows the W3C Standard Gamepad order (17 buttons)", () => {
    expect(STANDARD_BUTTONS.map((b) => b.index)).toEqual([...Array(17).keys()]);
    expect(STANDARD_BUTTONS.map((b) => b.xbox)).toEqual([
      "A",
      "B",
      "X",
      "Y",
      "LB",
      "RB",
      "LT",
      "RT",
      "View",
      "Menu",
      "LS",
      "RS",
      "D-pad ↑",
      "D-pad ↓",
      "D-pad ←",
      "D-pad →",
      "Guide",
    ]);
    // PlayStation: bottom Cross, right Circle; Nintendo swaps A/B and X/Y positions
    expect(STANDARD_BUTTONS.slice(0, 4).map((b) => b.playstation)).toEqual([
      "Cross",
      "Circle",
      "Square",
      "Triangle",
    ]);
    expect(STANDARD_BUTTONS.slice(0, 4).map((b) => b.nintendo)).toEqual(["B", "A", "Y", "X"]);
    expect(STANDARD_BUTTONS.filter((b) => b.analog).map((b) => b.index)).toEqual([6, 7]);
  });

  it("maps the sticks to axes 0/1 and 2/3 with clicks on 10/11", () => {
    expect(STANDARD_STICKS).toEqual([
      { axisX: 0, axisY: 1, standard: "Left stick", clickButton: 10 },
      { axisX: 2, axisY: 3, standard: "Right stick", clickButton: 11 },
    ]);
  });
});

describe("readStick", () => {
  it("treats anything inside the radial dead zone as centred", () => {
    const r = readStick(0.05, -0.05);
    expect(r).toMatchObject({
      x: 0,
      y: 0,
      magnitude: 0,
      angleDegrees: null,
      direction: "",
      active: false,
    });
    expect(r.rawMagnitude).toBe(0.07);
    expect(readStick(0, 0).active).toBe(false);
  });

  it("reports compass bearings with up = N (negative y)", () => {
    expect(readStick(0, -1)).toMatchObject({
      angleDegrees: 0,
      direction: "N",
      magnitude: 1,
      y: -1,
    });
    expect(readStick(1, 0)).toMatchObject({ angleDegrees: 90, direction: "E", x: 1 });
    expect(readStick(0, 1)).toMatchObject({ angleDegrees: 180, direction: "S" });
    expect(readStick(-1, 0)).toMatchObject({ angleDegrees: 270, direction: "W" });
    expect(readStick(0.5, 0.5).direction).toBe("SE");
    expect(readStick(-0.5, -0.5)).toMatchObject({ angleDegrees: 315, direction: "NW" });
  });

  it("rescales past the dead zone so the edge reads 0 and the rim reads 1", () => {
    // (0.5, 0.5): |v| = 0.7071, scaled (0.7071 - 0.1) / 0.9 = 0.6746; x = 0.7071 * 0.6746 = 0.477
    const r = readStick(0.5, 0.5);
    expect(r.rawMagnitude).toBe(0.71);
    expect(r.magnitude).toBe(0.67);
    expect(r.x).toBe(0.48);
    expect(r.y).toBe(0.48);
    // 0.55 on the x axis: (0.55 - 0.1) / 0.9 = 0.5
    expect(readStick(0.55, 0).x).toBe(0.5);
  });

  it("caps magnitude at 1 on a square-clamped corner", () => {
    const r = readStick(1, 1);
    expect(r.rawMagnitude).toBe(1.41);
    expect(r.magnitude).toBe(1);
    expect(r.x).toBe(0.71);
  });

  it("clamps out-of-range axes and the dead zone, and zeroes non-finite input", () => {
    expect(readStick(5, 0)).toMatchObject({ rawX: 1, x: 1 });
    expect(readStick(Number.NaN, Number.POSITIVE_INFINITY)).toMatchObject({
      rawX: 0,
      rawY: 0,
      active: false,
    });
    // dead zone 0 -> any movement is active; negative clamps to 0
    expect(readStick(0.01, 0, -1).active).toBe(true);
    // dead zone 2 clamps to 0.95
    expect(readStick(0.9, 0, 2).active).toBe(false);
    expect(readStick(1, 0, 2).active).toBe(true);
  });
});

describe("summarizeDrift", () => {
  it("is pending with no samples", () => {
    expect(summarizeDrift([])).toEqual({
      samples: 0,
      maxMagnitude: 0,
      averageMagnitude: 0,
      offCentreShare: 0,
      requiredDeadZonePercent: 0,
      verdict: "pending",
    });
  });

  it("calls a stick under 5 % clean", () => {
    const r = summarizeDrift([
      { x: 0, y: 0 },
      { x: 0.02, y: 0 },
    ]);
    expect(r).toEqual({
      samples: 2,
      maxMagnitude: 0.02,
      averageMagnitude: 0.01,
      offCentreShare: 0.5,
      requiredDeadZonePercent: 2,
      verdict: "clean",
    });
  });

  it("calls 5–15 % minor and 15 %+ drifting", () => {
    expect(summarizeDrift([{ x: 0.1, y: 0 }]).verdict).toBe("minor");
    // (0.3, 0.4) -> 0.5
    const r = summarizeDrift([{ x: 0.3, y: 0.4 }]);
    expect(r.verdict).toBe("drifting");
    expect(r.maxMagnitude).toBe(0.5);
    expect(r.requiredDeadZonePercent).toBe(50);
  });

  it("ignores junk samples", () => {
    const r = summarizeDrift([
      { x: Number.NaN, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(r.verdict).toBe("clean");
    expect(r.offCentreShare).toBe(0);
  });
});

describe("detectStyle / describeGamepad / buttonLabel", () => {
  it("detects the controller family from Chrome and Firefox ids", () => {
    expect(detectStyle("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe("xbox");
    expect(detectStyle("045e-0b13-Xbox Wireless Controller")).toBe("xbox");
    expect(
      detectStyle("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"),
    ).toBe("playstation");
    expect(detectStyle("054c-09cc-Wireless Controller")).toBe("playstation");
    expect(detectStyle("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")).toBe(
      "nintendo",
    );
    expect(detectStyle("Logitech Dual Action (Vendor: 046d Product: c216)")).toBe("generic");
    expect(detectStyle("")).toBe("generic");
  });

  it("parses vendor/product ids and strips the parenthetical from the name", () => {
    const info = describeGamepad({
      index: 1,
      id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
      mapping: "standard",
      buttons: Array(17).fill({ pressed: false, value: 0 }),
      axes: [0, 0, 0, 0],
      vibrationActuator: {},
    });
    expect(info).toEqual({
      index: 1,
      id: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
      name: "Wireless Controller",
      vendorId: "054c",
      productId: "09cc",
      mapping: "standard",
      standardMapping: true,
      buttons: 17,
      axes: 4,
      style: "playstation",
      hasVibration: true,
    });
  });

  it("parses Firefox-style vendor-product prefixes", () => {
    const info = describeGamepad({ id: "045E-028E-Xbox 360 Wired Controller", mapping: "" });
    expect(info).toMatchObject({
      vendorId: "045e",
      productId: "028e",
      standardMapping: false,
      style: "xbox",
    });
  });

  it("returns defaults for null / partial pads", () => {
    expect(describeGamepad(null)).toMatchObject({ id: "", buttons: 0, style: "generic" });
    expect(describeGamepad({})).toMatchObject({ index: 0, name: "", hasVibration: false });
  });

  it("labels buttons per family and falls back to the bare index", () => {
    const a = STANDARD_BUTTONS[0];
    expect(buttonLabel(a, "xbox")).toBe("A");
    expect(buttonLabel(a, "playstation")).toBe("Cross");
    expect(buttonLabel(a, "nintendo")).toBe("B");
    expect(buttonLabel(a, "generic")).toBe("B0");
  });
});

describe("summarizeProgress (gamepad)", () => {
  it("is empty for a pad without inputs", () => {
    expect(summarizeProgress([], [], 0, 0)).toMatchObject({
      percent: 0,
      complete: false,
      remaining: [],
    });
  });

  it("measures coverage against the pad's own counts", () => {
    // 3 of 21 inputs -> 14.3 % -> 14
    const p = summarizeProgress([0, 1], [0], 17, 4, "xbox");
    expect(p).toMatchObject({
      buttonsTested: 2,
      buttonsTotal: 17,
      axesTested: 1,
      axesTotal: 4,
      percent: 14,
    });
    expect(p.remaining.slice(0, 3)).toEqual(["X", "Y", "LB"]);
    expect(p.remaining.slice(-3)).toEqual(["Axis 1", "Axis 2", "Axis 3"]);
  });

  it("names buttons past the standard 17 generically and ignores out-of-range presses", () => {
    const p = summarizeProgress([99], [], 18, 0);
    expect(p.buttonsTested).toBe(0);
    expect(p.remaining.at(-1)).toBe("Button 17");
    expect(p.remaining[0]).toBe("B0");
  });

  it("completes a small arcade stick", () => {
    expect(summarizeProgress([0, 1, 2], [0, 1], 3, 2)).toMatchObject({
      percent: 100,
      complete: true,
    });
  });
});
