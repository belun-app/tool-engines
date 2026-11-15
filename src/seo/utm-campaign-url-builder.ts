/**
 * Adds UTM campaign parameters to a URL and predicts the GA4 default channel group that the
 * source and medium will be reported under.
 */

export interface UtmCampaignUrlInput {
  baseUrl: string;
  id?: string;
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
  /** utm_source_platform — the platform that routed the traffic (Search Ads 360, DV360). */
  sourcePlatform?: string;
  /** utm_creative_format — accepted by GA4, not shown in its reports yet. */
  creativeFormat?: string;
  /** utm_marketing_tactic — accepted by GA4, not shown in its reports yet. */
  marketingTactic?: string;
}

export interface UtmCampaignUrlResult {
  url: string;
  isValid: boolean;
  utmParamCount: number;
  urlLength: number;
  /**
   * utm_* parameters that were already in the pasted URL. They are removed from the
   * result (the form's values replace them), so a UI can offer to move them into the form.
   */
  existingUtm: Array<[string, string]>;
}

const EMPTY_RESULT: UtmCampaignUrlResult = {
  url: "",
  isValid: false,
  utmParamCount: 0,
  urlLength: 0,
  existingUtm: [],
};

/**
 * All nine GA4 campaign parameters with the input field each one comes from, in the order
 * Google's own Campaign URL Builder emits them (utm_id first), then the three newer ones.
 */
export const UTM_FIELDS: ReadonlyArray<[keyof UtmCampaignUrlInput, string]> = [
  ["id", "utm_id"],
  ["source", "utm_source"],
  ["medium", "utm_medium"],
  ["campaign", "utm_campaign"],
  ["term", "utm_term"],
  ["content", "utm_content"],
  ["sourcePlatform", "utm_source_platform"],
  ["creativeFormat", "utm_creative_format"],
  ["marketingTactic", "utm_marketing_tactic"],
];

const UTM_NAMES = new Set(UTM_FIELDS.map(([, name]) => name));

function collectParams(input: UtmCampaignUrlInput): Array<[string, string]> {
  const params: Array<[string, string]> = [];
  for (const [field, name] of UTM_FIELDS) {
    const value = (input[field] ?? "").trim();
    if (value) params.push([name, value]);
  }
  return params;
}

/** Decodes a query component the way servers read it ("+" is a space). */
function decodeComponent(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/**
 * A scheme without "//" (mailto:, tel:, javascript:) is not a page a campaign can link to.
 * "example.com:8080/a" is a host with a port, not a scheme, so a digit after ":" is allowed.
 */
const OPAQUE_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\/\/)(?!\d)/i;

export function buildUtmUrl(input: UtmCampaignUrlInput): UtmCampaignUrlResult {
  const rawUrl = input.baseUrl.trim();
  if (!rawUrl) return EMPTY_RESULT;
  if (OPAQUE_SCHEME.test(rawUrl)) return EMPTY_RESULT;

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return EMPTY_RESULT;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return EMPTY_RESULT;
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return EMPTY_RESULT;

  // The existing query is kept byte for byte (q=a+b stays q=a+b, a bare "flag" stays bare,
  // signed URLs keep their signature); only old pairs of the nine parameters the form owns
  // are taken out. Any other utm_* key (utm_reader, utm_brand…) stays exactly as it was.
  const kept: string[] = [];
  const existingUtm: Array<[string, string]> = [];
  for (const pair of parsed.search.replace(/^\?/, "").split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeComponent(eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
    if (UTM_NAMES.has(key))
      existingUtm.push([key, eq < 0 ? "" : decodeComponent(pair.slice(eq + 1))]);
    else kept.push(pair);
  }

  const params = collectParams(input);
  // encodeURIComponent writes a space as %20, like Google's campaign builder (not "+").
  const added = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  const query = [...kept, ...added].join("&");

  // href keeps a user:password@ part and the punycode host; cut it before the query.
  // A raw "?" or "#" cannot occur before the query, so the first one starts it.
  const base = parsed.href.split(/[?#]/)[0];
  const url = `${base}${query ? `?${query}` : ""}${parsed.hash}`;

  return {
    url,
    isValid: true,
    utmParamCount: params.length,
    urlLength: url.length,
    existingUtm,
  };
}

/** The regex GA4 applies to utm_medium to decide whether a visit is paid. */
export const GA4_PAID_REGEX = "^(.*cp.*|ppc|retargeting|paid.*)$";

export type Ga4MediumVerdict =
  | { kind: "channel"; channel: string }
  /** Paid, but Search, Social, Video or Other depends on utm_source. */
  | { kind: "paid" }
  | { kind: "unassigned" }
  | { kind: "empty" };

const PAID = new RegExp(GA4_PAID_REGEX);

/** A source written as a bare name ("google") or a host ("www.google.com", "m.facebook.com"). */
const sourceList = (names: string) =>
  new RegExp(`^(?:(?:www|m|l|lm|mobile)[.])?(?:${names})(?:[.][a-z]{2,6}){0,2}$`);

/**
 * The best-known entries of GA4's source categories (the full lists are Google's and much
 * longer). A source outside them is treated as unknown rather than as "not search/social".
 */
const SEARCH_SOURCES = sourceList(
  "google|bing|yahoo|search[.]yahoo|yandex|ya|duckduckgo|baidu|ecosia|naver|seznam|qwant|startpage|search[.]brave|go[.]mail|ask|aol",
);
const SOCIAL_SOURCES = sourceList(
  "facebook|fb|instagram|ig|vk|vkontakte|ok|odnoklassniki|telegram|t[.]me|tiktok|linkedin|lnkd|twitter|t[.]co|x|pinterest|reddit|threads|snapchat|whatsapp|quora|tumblr|discord",
);
const VIDEO_SOURCES = sourceList("youtube|youtu|vimeo|rutube|twitch|dailymotion");
const SHOPPING_SOURCES =
  /^(?:google shopping|igshopping|amazon|ebay|etsy|shopify|walmart|aliexpress|alibaba)(?:\.[a-z]{2,6}){0,2}$/;

const SOCIAL_MEDIUM = /^(social|social-network|social-media|sm|social network|social media)$/;
const EMAIL = /^(email|e-mail|e_mail|e mail)$/;

type SourceCategory = "search" | "social" | "video" | "shopping" | null;

function sourceCategory(source: string): SourceCategory {
  if (!source) return null;
  if (SHOPPING_SOURCES.test(source)) return "shopping";
  if (SEARCH_SOURCES.test(source)) return "search";
  if (SOCIAL_SOURCES.test(source)) return "social";
  if (VIDEO_SOURCES.test(source)) return "video";
  return null;
}

/**
 * The GA4 default channel a utm_source + utm_medium pair leads to, following Google's rules
 * in their evaluation order (first match wins). A paid medium from a source this function
 * does not recognise (or no source yet) gives "paid": Paid Search, Paid Social or Paid Other
 * then depends on utm_source. A pair that matches no rule leaves the visit in Unassigned —
 * the most common tagging mistake.
 * Source: https://support.google.com/analytics/answer/9756891
 */
export function ga4Channel(source: string, medium: string): Ga4MediumVerdict {
  const m = medium.trim().toLowerCase();
  if (!m) return { kind: "empty" };
  const s = source.trim().toLowerCase();
  const cat = sourceCategory(s);
  const paid = PAID.test(m);
  const channel = (name: string): Ga4MediumVerdict => ({ kind: "channel", channel: name });

  if (paid && cat === "shopping") return channel("Paid Shopping");
  if (paid && cat === "search") return channel("Paid Search");
  if (paid && cat === "social") return channel("Paid Social");
  if (paid && cat === "video") return channel("Paid Video");
  if (/^(display|banner|expandable|interstitial|cpm)$/.test(m)) return channel("Display");
  if (paid) return { kind: "paid" };
  if (cat === "shopping") return channel("Organic Shopping");
  if (cat === "social" || SOCIAL_MEDIUM.test(m)) return channel("Organic Social");
  if (cat === "video" || /video/.test(m)) return channel("Organic Video");
  if (cat === "search" || m === "organic") return channel("Organic Search");
  if (/^(referral|app|link)$/.test(m)) return channel("Referral");
  if (EMAIL.test(s) || EMAIL.test(m)) return channel("Email");
  if (m === "affiliate") return channel("Affiliates");
  if (m === "audio") return channel("Audio");
  if (s === "sms" || m === "sms") return channel("SMS");
  if (/push$|mobile|notification/.test(m) || s === "firebase") {
    return channel("Mobile Push Notifications");
  }
  return { kind: "unassigned" };
}

/**
 * The GA4 channel a utm_medium leads to before utm_source is known. A paid medium (cpc, ppc,
 * paid_social…) gives "paid": which paid channel depends on the source.
 */
export function ga4ChannelForMedium(medium: string): Ga4MediumVerdict {
  return ga4Channel("", medium);
}
