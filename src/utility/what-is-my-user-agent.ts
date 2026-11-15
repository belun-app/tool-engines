/**
 * Parses a User-Agent string into browser, engine, operating system and device type, and
 * refines it with User-Agent Client Hints where the string is frozen.
 */

/** Device class as a code; pages map it to their own words. */
export type DeviceKind = "" | "desktop" | "mobile" | "tablet" | "tv" | "bot" | "script";

export interface UserAgentResult {
  browserName: string;
  browserVersion: string;
  engineName: string;
  osName: string;
  /** "" when unknown or when the string only carries a frozen placeholder (see osFrozen) */
  osVersion: string;
  /**
   * True when the OS token is a placeholder browsers send for every version
   * ("Mac OS X 10_15_7", Chrome's reduced "Android 10; K", "Windows NT 10.0" for 10 and 11).
   */
  osFrozen: boolean;
  /**
   * True when `osVersion` is only a lower bound: since iOS 26 every iPhone/iPad browser
   * sends a frozen "18_6"/"18_7" token, and only Safari adds its real "Version/26.x".
   * Pages show it as "18.6 or later".
   */
  osAtLeast: boolean;
  /** English label, kept for callers without page texts; prefer `deviceKind` */
  deviceType: string;
  deviceKind: DeviceKind;
  /** CPU architecture and bitness, e.g. "x86 64-bit" (from the string or Client Hints) */
  architecture: string;
  /** Device model, e.g. "SM-S918B" or "Pixel 8" */
  model: string;
}

const EMPTY: UserAgentResult = {
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
};

const DEVICE_LABELS: Record<DeviceKind, string> = {
  "": "",
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
  tv: "Smart TV",
  bot: "Bot / Crawler",
  script: "Script / HTTP client",
};

/** Real user agents are a few hundred characters; longer input is cut before any regex. */
export const MAX_UA_LENGTH = 2048;

/**
 * Crawlers: a word ending in "bot" ("Googlebot/2.1", "YandexBot", "GPTBot"), not a
 * substring of a model name such as "CUBOT_X50".
 */
const BOT_PATTERN =
  /(?:^|[^a-z])[a-z-]*bot(?![a-z_\d])|crawler|spider|crawling|slurp|facebookexternalhit|ia_archiver|bingpreview|mediapartners-google/i;
const BOT_NAME = /([A-Za-z][\w-]*?bot)(?:\/([\d.]+))?/i;

/** HTTP libraries, command-line clients and headless browsers. */
const SCRIPT_PATTERN =
  /^(curl|wget|python-requests|python-urllib|python-httpx|aiohttp|go-http-client|okhttp|axios|node-fetch|undici|java|libwww-perl|postmanruntime|apache-httpclient|httpie|insomnia)\/([\d.]+)/i;
const HEADLESS_PATTERN = /(HeadlessChrome|PhantomJS|Puppeteer|Playwright)\/([\d.]+)/;

interface BrowserRule {
  name: string;
  pattern: RegExp;
}

// Order matters: Chromium forks announce Chrome/Safari too, so check forks first.
const BROWSER_RULES: BrowserRule[] = [
  { name: "Microsoft Edge", pattern: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
  { name: "Opera", pattern: /OPR\/([\d.]+)/ },
  // Opera Mini keeps "Opera/9.80" up front and its own version in "Opera Mini/x".
  { name: "Opera Mini", pattern: /Opera Mini\/([\d.]+)/ },
  // Opera 10–12 froze its token at "Opera/9.80" and moved the real version to "Version/x".
  { name: "Opera", pattern: /Opera\/9\.80.*?Version\/([\d.]+)/ },
  { name: "Opera", pattern: /Opera[/ ]([\d.]+)/ },
  { name: "Samsung Internet", pattern: /SamsungBrowser\/([\d.]+)/ },
  { name: "Yandex Browser", pattern: /YaBrowser\/([\d.]+)/ },
  { name: "Vivaldi", pattern: /Vivaldi\/([\d.]+)/ },
  { name: "Brave", pattern: /Brave\/([\d.]+)/ },
  { name: "UC Browser", pattern: /UCBrowser\/([\d.]+)/ },
  { name: "Firefox", pattern: /(?:Firefox|FxiOS)\/([\d.]+)/ },
  { name: "Internet Explorer", pattern: /MSIE ([\d.]+)/ },
  { name: "Internet Explorer", pattern: /Trident\/[\d.]+;[^)]*?rv:([\d.]+)/ },
  { name: "Chrome", pattern: /(?:Chrome|CriOS)\/([\d.]+)/ },
];

function detectBrowser(ua: string): { name: string; version: string } {
  for (const rule of BROWSER_RULES) {
    const match = ua.match(rule.pattern);
    if (match) return { name: rule.name, version: match[1] ?? "" };
  }
  // Safari: the "Version/x" token, checked separately from "Safari/" so a long
  // string without "Safari" cannot make the regex backtrack.
  const safari = /Safari\//.test(ua) ? ua.match(/Version\/([\d.]+)/) : null;
  if (safari) return { name: "Safari", version: safari[1] };
  return { name: "", version: "" };
}

function detectEngine(ua: string, browserName: string): string {
  if (browserName === "Internet Explorer") return "Trident";
  if (/Edge\/\d/.test(ua)) return "EdgeHTML";
  if (/FxiOS|CriOS|EdgiOS/.test(ua)) return "WebKit";
  if (/Gecko\/\d/.test(ua) && /Firefox\//.test(ua)) return "Gecko";
  if (/AppleWebKit\//.test(ua)) {
    return /(?:Chrome|Chromium)\//.test(ua) ? "Blink" : "WebKit";
  }
  if (/Presto\//.test(ua)) return "Presto";
  return "";
}

const WINDOWS_VERSIONS: Record<string, string> = {
  "10.0": "10 / 11",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
  "6.0": "Vista",
  "5.2": "XP x64",
  "5.1": "XP",
};

interface OsInfo {
  name: string;
  version: string;
  frozen: boolean;
  atLeast?: boolean;
}

/** OS tokens iOS 26+ browsers freeze to; the real system can be this or any later one. */
const FROZEN_IOS_TOKENS = new Set(["18.6", "18.7"]);

function detectOs(ua: string): OsInfo {
  const os = (name: string, version = "", frozen = false): OsInfo => ({ name, version, frozen });

  const windowsPhone = ua.match(/Windows Phone(?: OS)? ([\d.]+)/);
  if (windowsPhone) return os("Windows Phone", windowsPhone[1]);

  const windows = ua.match(/Windows NT ([\d.]+)/);
  if (windows) {
    // NT 10.0 is sent by Windows 10 and 11 alike.
    return os("Windows", WINDOWS_VERSIONS[windows[1]] ?? `NT ${windows[1]}`, windows[1] === "10.0");
  }

  const ios = ua.match(/(?:iPhone|CPU) OS ([\d_]+)/);
  if (ios) {
    const name = /iPad/.test(ua) ? "iPadOS" : "iOS";
    const token = ios[1].replace(/_/g, ".");
    // Since iOS 26 Safari freezes the OS token at 18.6/18.7; its "Version/26.x" is the
    // real system version (Safari ships with the OS).
    const safari = ua.match(/Version\/(\d+)(\.\d+)?/);
    if (safari && Number(safari[1]) >= 26 && /^18\./.test(token))
      return os(name, `${safari[1]}${safari[2] ?? ""}`);
    // Chrome, Firefox, Edge and in-app WebViews on iOS 26 send the same frozen token
    // without a Version/26: it only proves "18.6 or later".
    if (FROZEN_IOS_TOKENS.has(token)) return { name, version: token, frozen: true, atLeast: true };
    return os(name, token);
  }
  if (/iPhone|iPad|iPod/.test(ua)) return os("iOS");

  // Chrome's reduced user agent: "Android 10; K" for every Android version.
  if (/Android 10; K[;)]/.test(ua)) return os("Android", "", true);
  const android = ua.match(/Android ([\d.]+)/);
  if (android) return os("Android", android[1]);
  if (/Android/.test(ua)) return os("Android");

  const mac = ua.match(/Mac OS X ([\d_.]+)/);
  if (mac) {
    const version = mac[1].replace(/_/g, ".");
    // Every macOS since Catalina reports 10.15.7 (10.15 in Firefox).
    if (version === "10.15.7" || version === "10.15") return os("macOS", "", true);
    return os("macOS", version);
  }

  if (/CrOS/.test(ua)) return os("ChromeOS");
  if (/Tizen/.test(ua)) return os("Tizen");
  if (/Ubuntu/.test(ua)) return os("Ubuntu Linux");
  if (/Fedora/.test(ua)) return os("Fedora Linux");
  if (/Linux/.test(ua)) return os("Linux");
  if (/FreeBSD/.test(ua)) return os("FreeBSD");

  return os("");
}

function detectDeviceKind(ua: string, known: boolean): DeviceKind {
  if (SCRIPT_PATTERN.test(ua) || HEADLESS_PATTERN.test(ua)) return "script";
  if (!/cubot/i.test(ua) && BOT_PATTERN.test(ua)) return "bot";
  // TV before tablet: Android TV boxes send "Android" without "Mobile".
  if (
    /Smart-?TV|AppleTV|GoogleTV|Android TV|BRAVIA|\bAFT[A-Z]|\bTV\b|Web0S|HbbTV|CrKey|Roku/i.test(
      ua,
    )
  )
    return "tv";
  if (/Opera Mini|Opera Mobi/.test(ua)) return "mobile";
  if (/iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) || /Tablet/i.test(ua)) {
    return "tablet";
  }
  if (/Mobi|iPhone|iPod|Windows Phone/.test(ua)) return "mobile";
  return known ? "desktop" : "";
}

function detectArchitecture(ua: string): string {
  if (/Win64; x64|x86_64|WOW64|amd64/i.test(ua)) return "x86 64-bit";
  if (/arm_64|aarch64|arm64/i.test(ua)) return "ARM 64-bit";
  if (/armv7|armv8l/i.test(ua)) return "ARM 32-bit";
  if (/i686|i386/.test(ua)) return "x86 32-bit";
  return "";
}

function detectModel(ua: string): string {
  const android = ua.match(
    /Android [\d.]+; (?:[a-z]{2}[-_][a-z]{2}; )?([^;)]+?)(?: Build\/[^;)]*)?[;)]/i,
  );
  if (!android) return "";
  const model = android[1].replace(/^SAMSUNG /i, "").trim();
  // "K" is Chrome's reduced placeholder, "Mobile"/"wv" are not models.
  return /^(K|Mobile|wv|U|Linux)$/i.test(model) ? "" : model;
}

export function parseUserAgent(userAgent: string): UserAgentResult {
  const ua = (userAgent ?? "").trim().slice(0, MAX_UA_LENGTH);
  if (!ua) return { ...EMPTY };

  const script = ua.match(SCRIPT_PATTERN) ?? ua.match(HEADLESS_PATTERN);
  const botName = !script && !/cubot/i.test(ua) && BOT_PATTERN.test(ua) ? ua.match(BOT_NAME) : null;
  const browser = script
    ? { name: script[1], version: script[2] }
    : botName
      ? { name: botName[1], version: botName[2] ?? "" }
      : detectBrowser(ua);
  const os = detectOs(ua);
  const engineName = detectEngine(ua, browser.name);
  const known = Boolean(browser.name || os.name || engineName);
  const deviceKind = detectDeviceKind(ua, known);

  return {
    browserName: browser.name,
    browserVersion: browser.version,
    engineName,
    osName: os.name,
    osVersion: os.version,
    osFrozen: os.frozen,
    osAtLeast: os.atLeast ?? false,
    deviceType: DEVICE_LABELS[deviceKind],
    deviceKind,
    architecture: detectArchitecture(ua),
    model: detectModel(ua),
  };
}

/** The subset of `navigator.userAgentData.getHighEntropyValues()` this tool reads. */
export interface ClientHints {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  model?: string;
  mobile?: boolean;
  fullVersionList?: Array<{ brand: string; version: string }>;
}

/** The hint names to request from `getHighEntropyValues`. */
export const CLIENT_HINT_NAMES = [
  "platformVersion",
  "architecture",
  "bitness",
  "model",
  "fullVersionList",
] as const;

const BRAND_FOR: Record<string, RegExp> = {
  Chrome: /^Google Chrome$/,
  "Microsoft Edge": /^Microsoft Edge$/,
  Opera: /^Opera$/,
  "Yandex Browser": /^(YaBrowser|Yandex)$/,
  Brave: /^Brave$/,
  Vivaldi: /^Vivaldi$/,
  "Samsung Internet": /^Samsung Internet$/,
};

/** Windows 11 reports platformVersion 13+, Windows 10 reports 1–10, 7/8/8.1 report 0. */
export function windowsFromPlatformVersion(platformVersion: string): string {
  const major = Number.parseInt(platformVersion, 10);
  if (!Number.isFinite(major)) return "";
  if (major >= 13) return "11";
  if (major >= 1) return "10";
  return "7 / 8 / 8.1";
}

function trimVersion(v: string): string {
  // "15.1.0" → "15.1", "14.0.0" → "14"
  return v.replace(/(\.0)+$/, "");
}

/**
 * Replace the frozen parts of the visitor's own user agent with the real values
 * Chromium browsers expose through User-Agent Client Hints.
 */
export function applyClientHints(result: UserAgentResult, hints: ClientHints): UserAgentResult {
  const out = { ...result };
  const platform = hints.platform ?? "";
  const pv = hints.platformVersion ?? "";
  if (pv) {
    // Only the frozen "NT 10.0" (10 or 11) needs the hint; "NT 6.3" is already exactly 8.1.
    if (/windows/i.test(platform) && out.osName === "Windows" && out.osFrozen) {
      const v = windowsFromPlatformVersion(pv);
      if (v) {
        out.osVersion = v;
        out.osFrozen = false;
      }
    } else if (/mac/i.test(platform) && out.osName === "macOS") {
      out.osVersion = trimVersion(pv);
      out.osFrozen = false;
    } else if (/android/i.test(platform) && out.osName === "Android") {
      out.osVersion = trimVersion(pv);
      out.osFrozen = false;
    } else if (/chrome ?os/i.test(platform) && out.osName === "ChromeOS") {
      out.osVersion = pv;
    }
  }
  const brand = BRAND_FOR[out.browserName];
  const full = brand && hints.fullVersionList?.find((b) => brand.test(b.brand));
  if (full?.version) out.browserVersion = full.version;
  const arch = (hints.architecture ?? "").toLowerCase();
  if (arch) {
    const name = arch === "arm" ? "ARM" : arch === "x86" ? "x86" : (hints.architecture ?? "");
    out.architecture = hints.bitness ? `${name} ${hints.bitness}-bit` : name;
  }
  if (hints.model) out.model = hints.model;
  return out;
}

/**
 * iPadOS 13+ Safari sends a Mac user agent by default. A "Mac" with a multi-touch
 * screen is an iPad; its Safari version matches the iPadOS version.
 */
export function detectIpadAsMac(
  result: UserAgentResult,
  ua: string,
  maxTouchPoints: number,
): UserAgentResult {
  if (!/Macintosh/.test(ua) || !(maxTouchPoints > 1)) return result;
  const version = ua.match(/Version\/([\d.]+)/)?.[1] ?? "";
  return {
    ...result,
    osName: "iPadOS",
    osVersion: version,
    osFrozen: false,
    osAtLeast: false,
    deviceKind: "tablet",
    deviceType: DEVICE_LABELS.tablet,
  };
}
