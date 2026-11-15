import { describe, expect, it } from "vitest";
import {
  KEYBOARD_LAYOUT,
  allKeyCodes,
  buildLayout,
  describeKeyEvent,
  findKey,
  isAltGrPair,
  isChatter,
  keyName,
  placeKeys,
  releaseKey,
  summarizeProgress,
} from "./keyboard-tester.js";

describe("KEYBOARD_LAYOUT", () => {
  it("is a full-size ANSI 104-key board (74 main + 13 nav + 17 numpad)", () => {
    const count = (id: string) =>
      KEYBOARD_LAYOUT.find((s) => s.id === id)?.rows.reduce((n, r) => n + r.keys.length, 0);
    expect(count("main")).toBe(74);
    expect(count("nav")).toBe(13);
    expect(count("numpad")).toBe(17);
    expect(allKeyCodes()).toHaveLength(104);
  });

  it("has no duplicate KeyboardEvent.code values", () => {
    const codes = allKeyCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses the standard ANSI 15-unit row widths in the main block", () => {
    const main = KEYBOARD_LAYOUT.find((s) => s.id === "main");
    // number row .. bottom row (the F-row has gaps and is skipped)
    const widths = main?.rows.slice(1).map((r) => r.keys.reduce((n, k) => n + (k.width ?? 1), 0));
    expect(widths).toEqual([15, 15, 15, 15, 15]);
  });

  it("lists codes in reading order", () => {
    const codes = allKeyCodes();
    expect(codes[0]).toBe("Escape");
    expect(codes.at(-1)).toBe("NumpadDecimal");
    expect(codes.indexOf("KeyQ")).toBeLessThan(codes.indexOf("KeyA"));
  });
});

describe("findKey", () => {
  it("finds keys in every section", () => {
    expect(findKey("KeyA")).toEqual({ code: "KeyA", label: "A" });
    expect(findKey("Space")).toMatchObject({ code: "Space", label: "Space", width: 6.25 });
    expect(findKey("ArrowUp")?.label).toBe("↑");
    expect(findKey("NumpadEnter")?.label).toBe("Enter");
  });

  it("returns null for unknown or empty codes", () => {
    expect(findKey("")).toBeNull();
    expect(findKey("F13")).toBeNull();
    expect(findKey("keya")).toBeNull();
  });
});

describe("describeKeyEvent", () => {
  it("returns the empty readout without code and key", () => {
    expect(describeKeyEvent({})).toEqual({
      code: "",
      key: "",
      keyCode: 0,
      location: "Standard",
      locationIndex: 0,
      onLayout: false,
    });
  });

  it("describes a letter key", () => {
    expect(describeKeyEvent({ code: "KeyA", key: "a", keyCode: 65, location: 0 })).toEqual({
      code: "KeyA",
      key: "a",
      keyCode: 65,
      location: "Standard",
      locationIndex: 0,
      onLayout: true,
    });
  });

  it("names the space bar and maps locations", () => {
    expect(describeKeyEvent({ code: "Space", key: " ", keyCode: 32 }).key).toBe("Space");
    expect(describeKeyEvent({ code: "ShiftLeft", key: "Shift", location: 1 }).location).toBe(
      "Left",
    );
    expect(describeKeyEvent({ code: "ShiftRight", key: "Shift", location: 2 }).location).toBe(
      "Right",
    );
    expect(describeKeyEvent({ code: "Numpad5", key: "5", location: 3 }).location).toBe("Numpad");
    expect(describeKeyEvent({ code: "KeyA", key: "a", location: 9 }).location).toBe("Standard");
    // the index lets a page show its own words (RU "Левая") instead of the English ones
    expect(describeKeyEvent({ code: "AltRight", key: "Alt", location: 2 }).locationIndex).toBe(2);
    expect(describeKeyEvent({ code: "KeyA", key: "a", location: 9 }).locationIndex).toBe(0);
  });

  it("handles keys off the layout, Cyrillic keys and bad keyCodes", () => {
    const r = describeKeyEvent({ code: "F13", key: "F13", keyCode: -1 });
    expect(r.onLayout).toBe(false);
    expect(r.keyCode).toBe(0);
    // Russian layout: the KeyF position produces "а"
    expect(describeKeyEvent({ code: "KeyF", key: "а" })).toMatchObject({
      key: "а",
      onLayout: true,
    });
    // key without code (some virtual keyboards)
    expect(describeKeyEvent({ key: "Unidentified" })).toMatchObject({ code: "", onLayout: false });
  });
});

describe("summarizeProgress", () => {
  it("starts at 0 % with every label remaining", () => {
    const p = summarizeProgress([]);
    expect(p).toMatchObject({ tested: 0, total: 104, percent: 0, complete: false });
    expect(p.remaining).toHaveLength(104);
    expect(p.remaining[0]).toBe("Esc");
  });

  it("counts only layout keys and ignores duplicates / unknown codes", () => {
    const p = summarizeProgress(["KeyA", "KeyA", "Space", "F13", ""]);
    expect(p.tested).toBe(2);
    // 2 / 104 = 1.92 % -> 2
    expect(p.percent).toBe(2);
    expect(p.remaining).not.toContain("A");
  });

  it("names duplicate keys apart in the untested list", () => {
    const pressed = allKeyCodes().filter((c) => !["ShiftRight", "Numpad7", "Digit7"].includes(c));
    expect(summarizeProgress(pressed).remaining).toEqual(["7", "Right Shift", "Num 7"]);
    const comma = summarizeProgress(allKeyCodes().filter((c) => c !== "Comma" && c !== "Period"));
    expect(comma.remaining).toEqual(["Comma", "Period"]);
    expect(comma.remainingCodes).toEqual(["Comma", "Period"]);
  });

  it("takes the page's words for the names", () => {
    const words = { left: "Левый", right: "Правый", num: "Num", names: { Comma: "Запятая" } };
    const p = summarizeProgress(
      allKeyCodes().filter((c) => !["ShiftLeft", "Comma"].includes(c)),
      KEYBOARD_LAYOUT,
      words,
    );
    expect(p.remaining).toEqual(["Левый Shift", "Запятая"]);
  });

  it("rounds the percentage", () => {
    // 52 / 104 = 50 %
    expect(summarizeProgress(allKeyCodes().slice(0, 52)).percent).toBe(50);
    // 103 / 104 = 99.04 % -> 99, not complete
    const p = summarizeProgress(allKeyCodes().slice(1));
    expect(p.percent).toBe(99);
    expect(p.complete).toBe(false);
    expect(p.remaining).toEqual(["Esc"]);
  });

  it("is complete once every key is pressed (accepts any iterable)", () => {
    const p = summarizeProgress(new Set(allKeyCodes()));
    expect(p).toMatchObject({ tested: 104, percent: 100, complete: true, remaining: [] });
  });
});

describe("buildLayout", () => {
  const count = (o: Parameters<typeof buildLayout>[0]) => allKeyCodes(buildLayout(o)).length;

  it("builds the common sizes with their real key counts", () => {
    expect(count({})).toBe(104);
    expect(count({ standard: "iso" })).toBe(105);
    expect(count({ size: "tkl" })).toBe(87);
    expect(count({ size: "tkl", standard: "iso" })).toBe(88);
    expect(count({ size: "laptop" })).toBe(78);
  });

  it("has no duplicate codes and full 15-unit rows in every variant", () => {
    for (const size of ["full", "tkl", "laptop"] as const)
      for (const standard of ["ansi", "iso"] as const)
        for (const os of ["win", "mac"] as const) {
          const layout = buildLayout({ size, standard, os });
          const codes = allKeyCodes(layout);
          expect(new Set(codes).size, `${size}/${standard}/${os}`).toBe(codes.length);
          const placed = placeKeys(layout).keys.filter((key) => key.section === "main");
          // rows 1-5 (number row .. bottom row) end exactly at 15 units
          for (const row of [1.25, 2.25, 3.25, 4.25, 5.25]) {
            const right = Math.max(
              ...placed
                .filter((key) => key.y + key.h > row && key.y <= row)
                .map((key) => key.x + key.w),
            );
            expect(right, `${size}/${standard}/${os} row ${row}`).toBe(15);
          }
        }
  });

  it("ISO adds IntlBackslash and a tall Enter; ANSI has neither", () => {
    expect(findKey("IntlBackslash", buildLayout({ standard: "iso" }))).not.toBeNull();
    expect(findKey("Enter", buildLayout({ standard: "iso" }))?.height).toBe(2);
    expect(findKey("IntlBackslash")).toBeNull();
  });

  it("laptop drops the numpad and nav cluster but keeps the arrows", () => {
    const laptop = buildLayout({ size: "laptop" });
    expect(laptop.map((s) => s.id)).toEqual(["main"]);
    expect(findKey("ArrowUp", laptop)).not.toBeNull();
    expect(findKey("Numpad7", laptop)).toBeNull();
    expect(findKey("Home", laptop)).toBeNull();
  });

  it("Mac labels Cmd/Opt and drops keys a Mac keyboard does not have", () => {
    const mac = buildLayout({ os: "mac" });
    expect(findKey("MetaLeft", mac)?.label).toBe("Cmd");
    expect(findKey("AltLeft", mac)?.label).toBe("Opt");
    expect(findKey("ContextMenu", mac)).toBeNull();
    expect(findKey("Insert", mac)).toBeNull();
    expect(findKey("F13", mac)).not.toBeNull();
  });
});

describe("placeKeys", () => {
  const byCode = (code: string, opts?: Parameters<typeof placeKeys>[1]) =>
    placeKeys(KEYBOARD_LAYOUT, opts).keys.find((key) => key.code === code);

  it("draws a proportional board: 23 units wide, Backspace 2u, Space 6.25u", () => {
    const placed = placeKeys();
    expect(placed.width).toBe(23);
    expect(placed.height).toBe(6.25);
    expect(byCode("Backspace")?.w).toBe(2);
    expect(byCode("Space")?.w).toBe(6.25);
  });

  it("puts the up arrow above the down arrow and makes numpad + and Enter two rows tall", () => {
    const up = byCode("ArrowUp");
    const down = byCode("ArrowDown");
    expect(up?.x).toBe(down?.x);
    expect(up?.w).toBe(1);
    expect((down?.y ?? 0) - (up?.y ?? 0)).toBe(1);
    expect(byCode("NumpadAdd")?.h).toBe(2);
    expect(byCode("NumpadEnter")?.h).toBe(2);
    // the numpad is a 4-column grid: 4 and 7 share a column, + sits in the 4th
    expect(byCode("Numpad4")?.x).toBe(byCode("Numpad7")?.x);
    expect(byCode("NumpadAdd")?.x).toBe(byCode("NumpadSubtract")?.x);
  });

  it("stacks nav and numpad under the main block on narrow screens", () => {
    const opts = { stacked: true, lowerScale: 1.5 };
    expect(placeKeys(KEYBOARD_LAYOUT, opts).width).toBeLessThanOrEqual(15);
    const esc = byCode("Escape", opts);
    const prt = byCode("PrintScreen", opts);
    expect(esc?.x).toBe(0);
    expect(prt?.x).toBe(0);
    expect(prt?.y).toBeGreaterThan(6);
    expect(prt?.w).toBe(1.5);
  });
});

describe("keyName", () => {
  it("adds the side or Num to paired keys", () => {
    expect(keyName({ code: "ShiftLeft", label: "Shift", side: "left" })).toBe("Left Shift");
    expect(keyName({ code: "Numpad7", label: "7", numpad: true })).toBe("Num 7");
    expect(keyName({ code: "KeyA", label: "A" })).toBe("A");
  });
});

describe("isChatter", () => {
  it("flags a fresh press that follows the release faster than the threshold", () => {
    expect(isChatter(1000, 1020, 50)).toBe(true);
    expect(isChatter(1000, 1080, 50)).toBe(false);
  });

  it("never flags auto-repeat or a first press", () => {
    expect(isChatter(1000, 1010, 50, true)).toBe(false);
    expect(isChatter(undefined, 1010, 50)).toBe(false);
  });
});

describe("isAltGrPair", () => {
  it("matches Windows' fake Left Ctrl in front of AltGr (same timeStamp)", () => {
    expect(
      isAltGrPair(
        { code: "ControlLeft", timeStamp: 1234.5 },
        { code: "AltRight", timeStamp: 1234.5 },
      ),
    ).toBe(true);
    expect(
      isAltGrPair({ code: "ControlLeft", timeStamp: 1000 }, { code: "AltRight", timeStamp: 1001 }),
    ).toBe(true);
  });

  it("keeps a real Left Ctrl: later Right Alt, another key, or Right Ctrl", () => {
    expect(
      isAltGrPair({ code: "ControlLeft", timeStamp: 1000 }, { code: "AltRight", timeStamp: 1080 }),
    ).toBe(false);
    expect(
      isAltGrPair({ code: "ControlLeft", timeStamp: 1000 }, { code: "KeyA", timeStamp: 1000 }),
    ).toBe(false);
    expect(
      isAltGrPair({ code: "ControlRight", timeStamp: 1000 }, { code: "AltRight", timeStamp: 1000 }),
    ).toBe(false);
    expect(
      isAltGrPair({ code: "ControlLeft", timeStamp: 1000 }, { code: "AltRight", timeStamp: 999 }),
    ).toBe(false);
    expect(
      isAltGrPair(
        { code: "ControlLeft", timeStamp: Number.NaN },
        { code: "AltRight", timeStamp: 1 },
      ),
    ).toBe(false);
  });
});

describe("releaseKey", () => {
  it("releases only the key that went up", () => {
    expect(releaseKey(["KeyA", "KeyS"], "KeyA")).toEqual(["KeyS"]);
  });

  it("releasing Cmd also releases letters macOS never sent a keyup for", () => {
    expect(releaseKey(["MetaLeft", "KeyC", "ShiftLeft"], "MetaLeft")).toEqual(["ShiftLeft"]);
  });
});
