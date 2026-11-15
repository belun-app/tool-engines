import { describe, expect, it } from "vitest";
import {
  applyClientHints,
  detectIpadAsMac,
  parseUserAgent,
  windowsFromPlatformVersion,
} from "./what-is-my-user-agent.js";

// Real-world user-agent strings, published by the browser vendors.
const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
  edgeLegacy:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.17763",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  firefoxMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
  firefoxUbuntu: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
  chromeAndroidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
  yandex:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 YaBrowser/23.11.0.0 Safari/537.36",
  ie11: "Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko",
  ie8: "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.1; Trident/4.0)",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  smartTv:
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0.3809.146 TV Safari/537.36",
  windowsPhone:
    "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.15063",
  operaPresto: "Opera/9.80 (Windows NT 6.1; U; en) Presto/2.12.388 Version/12.16",
};

describe("parseUserAgent", () => {
  it("returns the empty result for empty / whitespace input", () => {
    for (const s of ["", "   \n"]) {
      expect(parseUserAgent(s)).toEqual({
        browserName: "",
        browserVersion: "",
        engineName: "",
        osName: "",
        osVersion: "",
        osFrozen: false,
        osAtLeast: false,
        deviceType: "",
        deviceKind: "",
        architecture: "",
        model: "",
      });
    }
  });

  it("parses desktop Chrome on Windows", () => {
    expect(parseUserAgent(UA.chromeWin)).toEqual({
      browserName: "Chrome",
      browserVersion: "120.0.0.0",
      engineName: "Blink",
      osName: "Windows",
      osVersion: "10 / 11",
      osFrozen: true,
      osAtLeast: false,
      deviceType: "Desktop",
      deviceKind: "desktop",
      architecture: "x86 64-bit",
      model: "",
    });
  });

  it("detects Chromium forks before Chrome", () => {
    expect(parseUserAgent(UA.edgeWin)).toMatchObject({
      browserName: "Microsoft Edge",
      browserVersion: "120.0.2210.91",
      engineName: "Blink",
    });
    expect(parseUserAgent(UA.opera)).toMatchObject({
      browserName: "Opera",
      browserVersion: "106.0.0.0",
    });
    expect(parseUserAgent(UA.yandex)).toMatchObject({
      browserName: "Yandex Browser",
      browserVersion: "23.11.0.0",
    });
    expect(parseUserAgent(UA.samsung)).toMatchObject({
      browserName: "Samsung Internet",
      browserVersion: "23.0",
      osName: "Android",
      osVersion: "13",
      deviceType: "Mobile",
    });
  });

  it("detects legacy EdgeHTML Edge", () => {
    expect(parseUserAgent(UA.edgeLegacy)).toMatchObject({
      browserName: "Microsoft Edge",
      browserVersion: "18.17763",
      engineName: "EdgeHTML",
    });
  });

  it("parses Firefox on Windows, macOS, Ubuntu and Android", () => {
    expect(parseUserAgent(UA.firefoxWin)).toMatchObject({
      browserName: "Firefox",
      browserVersion: "121.0",
      engineName: "Gecko",
      osName: "Windows",
    });
    // every macOS since Catalina sends 10.15: a placeholder, not the real version
    expect(parseUserAgent(UA.firefoxMac)).toMatchObject({
      osName: "macOS",
      osVersion: "",
      osFrozen: true,
    });
    expect(parseUserAgent(UA.firefoxUbuntu)).toMatchObject({
      osName: "Ubuntu Linux",
      deviceType: "Desktop",
    });
    expect(parseUserAgent(UA.firefoxAndroid)).toMatchObject({
      engineName: "Gecko",
      osName: "Android",
      osVersion: "14",
      deviceType: "Mobile",
    });
  });

  it("parses Safari on macOS, iPhone and iPad", () => {
    expect(parseUserAgent(UA.safariMac)).toMatchObject({
      browserName: "Safari",
      browserVersion: "17.2",
      engineName: "WebKit",
      osName: "macOS",
      osVersion: "",
      osFrozen: true,
      deviceType: "Desktop",
    });
    expect(parseUserAgent(UA.safariIphone)).toMatchObject({
      browserName: "Safari",
      osName: "iOS",
      osVersion: "17.2",
      deviceType: "Mobile",
    });
    expect(parseUserAgent(UA.safariIpad)).toMatchObject({
      osName: "iPadOS",
      osVersion: "17.2",
      deviceType: "Tablet",
    });
  });

  it("reports WebKit for Chrome and Firefox on iOS", () => {
    expect(parseUserAgent(UA.chromeIos)).toMatchObject({
      browserName: "Chrome",
      browserVersion: "120.0.6099.119",
      engineName: "WebKit",
      osName: "iOS",
    });
    expect(parseUserAgent(UA.firefoxIos)).toMatchObject({
      browserName: "Firefox",
      engineName: "WebKit",
    });
  });

  it("tells Android phones from Android tablets by the Mobile token", () => {
    expect(parseUserAgent(UA.chromeAndroid).deviceType).toBe("Mobile");
    expect(parseUserAgent(UA.chromeAndroidTablet).deviceType).toBe("Tablet");
  });

  it("maps Windows NT versions and falls back to NT x.y", () => {
    expect(parseUserAgent(UA.ie11)).toMatchObject({
      browserName: "Internet Explorer",
      browserVersion: "11.0",
      engineName: "Trident",
      osVersion: "7",
    });
    expect(parseUserAgent(UA.ie8)).toMatchObject({
      browserName: "Internet Explorer",
      browserVersion: "8.0",
      osVersion: "XP",
    });
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 4.0)").osVersion).toBe("NT 4.0");
  });

  it("detects ChromeOS, Windows Phone, Smart TVs and bots", () => {
    expect(parseUserAgent(UA.chromeOs).osName).toBe("ChromeOS");
    expect(parseUserAgent(UA.windowsPhone)).toMatchObject({
      osName: "Windows Phone",
      osVersion: "10.0",
      deviceType: "Mobile",
    });
    expect(parseUserAgent(UA.smartTv)).toMatchObject({ osName: "Tizen", deviceType: "Smart TV" });
    expect(parseUserAgent(UA.googlebot).deviceType).toBe("Bot / Crawler");
  });

  it("returns blanks rather than throwing on garbage", () => {
    const r = parseUserAgent("lorem ipsum 42");
    expect(r.browserName).toBe("");
    expect(r.osName).toBe("");
    expect(r.engineName).toBe("");
    // nothing recognised: no device type rather than a made-up "Desktop"
    expect(r.deviceType).toBe("");
    expect(() => parseUserAgent("Привет 👋 \u0000")).not.toThrow();
  });

  it("detects Presto for old Opera", () => {
    expect(parseUserAgent(UA.operaPresto)).toMatchObject({
      browserName: "Opera",
      engineName: "Presto",
    });
  });

  it("reports the real version for Opera 10+ (Version/12.16)", () => {
    expect(parseUserAgent(UA.operaPresto).browserVersion).toBe("12.16");
  });
});

describe("bots, scripts and odd devices", () => {
  it("does not take a CUBOT phone for a bot", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Linux; Android 11; CUBOT_X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    );
    expect(r).toMatchObject({ deviceKind: "mobile", osVersion: "11", model: "CUBOT_X50" });
  });

  it("names crawlers", () => {
    expect(parseUserAgent(UA.googlebot)).toMatchObject({
      deviceKind: "bot",
      browserName: "Googlebot",
      browserVersion: "2.1",
    });
    expect(
      parseUserAgent("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)"),
    ).toMatchObject({
      deviceKind: "bot",
      browserName: "YandexBot",
    });
  });

  it("reports command-line clients and headless browsers as scripts", () => {
    expect(parseUserAgent("curl/8.4.0")).toMatchObject({
      deviceKind: "script",
      browserName: "curl",
      browserVersion: "8.4.0",
    });
    expect(parseUserAgent("python-requests/2.31.0").deviceKind).toBe("script");
    const headless = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
    );
    expect(headless).toMatchObject({ deviceKind: "script", browserName: "HeadlessChrome" });
  });

  it("does not call unrecognised text a desktop", () => {
    expect(parseUserAgent("hello world")).toMatchObject({ deviceKind: "", deviceType: "" });
  });

  it("parses Opera Mini as a phone browser", () => {
    expect(
      parseUserAgent(
        "Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; id) Presto/2.12.423 Version/12.16",
      ),
    ).toMatchObject({ browserName: "Opera Mini", deviceKind: "mobile" });
  });

  it("checks TVs before tablets (Android TV has no Mobile token)", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 9; BRAVIA 4K UR2 Build/PTT1.190515.001.S52) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Safari/537.36",
      ).deviceKind,
    ).toBe("tv");
  });

  it("marks Chrome's reduced Android 10; K as a placeholder", () => {
    const r = parseUserAgent(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    );
    expect(r).toMatchObject({ osName: "Android", osVersion: "", osFrozen: true, model: "" });
  });

  it("reads iOS 26 from Safari's Version token when the OS token is frozen at 18.6", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ),
    ).toMatchObject({
      osName: "iOS",
      osVersion: "26.0",
      osAtLeast: false,
      browserVersion: "26.0",
    });
    // iOS 18 itself keeps its token
    expect(parseUserAgent(UA.safariIphone).osVersion).toBe("17.2");
  });

  it("marks a frozen 18.6/18.7 iOS token without Version/26 as a lower bound", () => {
    const chromeIos26 =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(chromeIos26)).toMatchObject({
      browserName: "Chrome",
      osName: "iOS",
      osVersion: "18.6",
      osFrozen: true,
      osAtLeast: true,
    });
    const firefoxIos =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15";
    expect(parseUserAgent(firefoxIos)).toMatchObject({ osVersion: "18.7", osAtLeast: true });
    const webView =
      "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(parseUserAgent(webView)).toMatchObject({
      osName: "iPadOS",
      osVersion: "18.6",
      osAtLeast: true,
    });
    // Other iOS tokens are exact
    expect(parseUserAgent(UA.chromeIos)).toMatchObject({ osVersion: "17.2", osAtLeast: false });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0 Mobile/15E148 Safari/604.1",
      ),
    ).toMatchObject({ osVersion: "18.5", osAtLeast: false });
  });

  it("parses a huge pasted string (patterns without nested quantifiers)", () => {
    // With quadratic backtracking 300 000 characters would not finish within the test
    // timeout; the result itself must stay a plain parse of the known tokens.
    const junk = `Mozilla/5.0 Trident/7.0 Version/1.0 ${"x".repeat(300_000)}`;
    const r = parseUserAgent(junk);
    expect(typeof r.browserName).toBe("string");
    expect(parseUserAgent(junk)).toEqual(r);
  });
});

describe("Client Hints", () => {
  const chromeWin = () => parseUserAgent(UA.chromeWin);

  it("maps the Windows platformVersion to 10 or 11", () => {
    expect(windowsFromPlatformVersion("15.0.0")).toBe("11");
    expect(windowsFromPlatformVersion("13.0.0")).toBe("11");
    expect(windowsFromPlatformVersion("10.0.0")).toBe("10");
    expect(windowsFromPlatformVersion("0.3.0")).toBe("7 / 8 / 8.1");
    expect(windowsFromPlatformVersion("")).toBe("");
  });

  it("replaces frozen OS versions and the reduced browser version", () => {
    const r = applyClientHints(chromeWin(), {
      platform: "Windows",
      platformVersion: "15.0.0",
      architecture: "x86",
      bitness: "64",
      fullVersionList: [
        { brand: "Not_A Brand", version: "8.0.0.0" },
        { brand: "Google Chrome", version: "120.0.6099.130" },
      ],
    });
    expect(r).toMatchObject({
      osVersion: "11",
      osFrozen: false,
      browserVersion: "120.0.6099.130",
      architecture: "x86 64-bit",
    });
    const mac = applyClientHints(parseUserAgent(UA.safariMac), {
      platform: "macOS",
      platformVersion: "15.1.0",
      architecture: "arm",
      bitness: "64",
    });
    expect(mac).toMatchObject({ osVersion: "15.1", osFrozen: false, architecture: "ARM 64-bit" });
    const android = applyClientHints(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      ),
      { platform: "Android", platformVersion: "14.0.0", model: "Pixel 8" },
    );
    expect(android).toMatchObject({ osVersion: "14", model: "Pixel 8" });
  });

  it("keeps an exact Windows version (NT 6.x) instead of the vague 7 / 8 / 8.1 hint", () => {
    const win81 = parseUserAgent(
      "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
    );
    expect(win81).toMatchObject({ osName: "Windows", osVersion: "8.1", osFrozen: false });
    const r = applyClientHints(win81, { platform: "Windows", platformVersion: "0.3.0" });
    expect(r).toMatchObject({ osVersion: "8.1", osFrozen: false });
    // NT 10.0 is still resolved from the hint
    expect(
      applyClientHints(chromeWin(), { platform: "Windows", platformVersion: "10.0.0" }).osVersion,
    ).toBe("10");
  });

  it("ignores hints for another platform and empty hints", () => {
    expect(applyClientHints(chromeWin(), {})).toEqual(chromeWin());
    expect(
      applyClientHints(chromeWin(), { platform: "macOS", platformVersion: "15.0.0" }).osVersion,
    ).toBe("10 / 11");
  });
});

describe("detectIpadAsMac", () => {
  it("turns a touch-screen Mac into iPadOS on a tablet", () => {
    const r = detectIpadAsMac(parseUserAgent(UA.safariMac), UA.safariMac, 5);
    expect(r).toMatchObject({ osName: "iPadOS", osVersion: "17.2", deviceKind: "tablet" });
  });

  it("leaves a real Mac (no touch) alone", () => {
    expect(detectIpadAsMac(parseUserAgent(UA.safariMac), UA.safariMac, 0).osName).toBe("macOS");
  });
});
