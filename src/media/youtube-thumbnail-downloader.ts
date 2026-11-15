/**
 * Parses a YouTube video ID out of a pasted link or ID and builds the URLs of the video's
 * thumbnails in every size.
 *
 * Every YouTube thumbnail lives at a predictable address on the i.ytimg.com CDN, so a
 * thumbnail downloader needs no API key and no server: parse the video ID out of whatever
 * the user pasted, then build the URLs. The only thing that cannot be known ahead of time
 * is which sizes a given video actually has — that is decided by the resolution it was
 * uploaded at, and the page resolves it by loading each image.
 */

/** Reason an input could not be turned into a video ID. Pages map these to copy. */
export type ParseError = "empty" | "no-id" | "playlist" | "channel" | "bad-id";

export interface ParsedVideo {
  /** The 11-character video ID, or "" when the input could not be parsed. */
  id: string;
  /** Which input shape matched — useful as a hint in the UI. */
  kind: "watch" | "short-link" | "shorts" | "embed" | "live" | "raw-id" | "none";
  error: ParseError | "";
  /** Playback position in whole seconds if the link carried one (t / start), else 0. */
  startSeconds: number;
}

export interface ThumbnailVariant {
  /** Stable key the page uses to look up a translated label. */
  key: string;
  /** File name on the CDN, without extension. */
  file: string;
  width: number;
  height: number;
  /** Direct CDN address of the image. */
  url: string;
  /** Suggested name for the saved file. */
  filename: string;
  /** True for the three storyboard frames, which are stills, not the chosen thumbnail. */
  frame: boolean;
}

export interface ThumbnailSet {
  parsed: ParsedVideo;
  variants: ThumbnailVariant[];
  /** Canonical watch URL, or "" when nothing parsed. */
  watchUrl: string;
  /** Short youtu.be URL, or "" when nothing parsed. */
  shortUrl: string;
  /** The variant key a downloader should default to: the largest one YouTube may hold. */
  bestKey: string;
}

export type ThumbnailFormat = "jpg" | "webp";

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

const PATH_PREFIXES: Array<{ prefix: string; kind: ParsedVideo["kind"] }> = [
  { prefix: "shorts", kind: "shorts" },
  { prefix: "embed", kind: "embed" },
  { prefix: "live", kind: "live" },
  { prefix: "v", kind: "embed" },
  { prefix: "e", kind: "embed" },
];

const NONE: ParsedVideo = { id: "", kind: "none", error: "empty", startSeconds: 0 };

/**
 * YouTube writes time offsets three ways: plain seconds (t=90), a clock-ish compound
 * (t=1h2m3s) and the embed form (start=90). All three collapse to seconds here.
 */
function parseTime(raw: string | null): number {
  if (!raw) return 0;
  const plain = Number(raw);
  if (Number.isFinite(plain) && plain >= 0) return Math.floor(plain);

  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(raw.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Accepts anything a person is likely to paste: a watch URL, a youtu.be link, a Shorts
 * or embed or live URL, a bare ID, or a full URL with tracking parameters attached. A
 * protocol-less "youtu.be/xyz" is normalised rather than rejected, because that is what
 * the Android share sheet puts on the clipboard.
 */
export function parseYouTubeId(input: string): ParsedVideo {
  const text = input.trim();
  if (!text) return { ...NONE };

  if (ID_RE.test(text)) return { id: text, kind: "raw-id", error: "", startSeconds: 0 };

  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { id: "", kind: "none", error: "no-id", startSeconds: 0 };
  }

  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return { id: "", kind: "none", error: "no-id", startSeconds: 0 };

  const startSeconds = parseTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const segments = url.pathname.split("/").filter(Boolean);

  // youtu.be/VIDEOID — the ID is the whole path.
  if (host.endsWith("youtu.be")) {
    const candidate = segments[0] ?? "";
    if (!candidate) return { id: "", kind: "none", error: "no-id", startSeconds };
    return ID_RE.test(candidate)
      ? { id: candidate, kind: "short-link", error: "", startSeconds }
      : { id: "", kind: "none", error: "bad-id", startSeconds };
  }

  // /watch?v=VIDEOID — also covers /watch_popup and the music.youtube.com player.
  const v = url.searchParams.get("v");
  if (v) {
    return ID_RE.test(v)
      ? { id: v, kind: "watch", error: "", startSeconds }
      : { id: "", kind: "none", error: "bad-id", startSeconds };
  }

  // /attribution_link?u=%2Fwatch%3Fv%3D… wraps a relative watch URL in a query parameter.
  const nested = url.searchParams.get("u") ?? url.searchParams.get("url");
  if (nested) {
    const inner = parseYouTubeId(
      /^https?:\/\//i.test(nested) ? nested : `https://www.youtube.com${nested}`,
    );
    if (inner.id) return { ...inner, startSeconds: inner.startSeconds || startSeconds };
  }

  const matched = PATH_PREFIXES.find((p) => p.prefix === segments[0]);
  if (matched) {
    const candidate = segments[1] ?? "";
    if (!candidate) return { id: "", kind: "none", error: "no-id", startSeconds };
    return ID_RE.test(candidate)
      ? { id: candidate, kind: matched.kind, error: "", startSeconds }
      : { id: "", kind: "none", error: "bad-id", startSeconds };
  }

  if (segments[0] === "playlist" || url.searchParams.has("list")) {
    return { id: "", kind: "none", error: "playlist", startSeconds };
  }

  if (segments[0]?.startsWith("@") || ["channel", "c", "user"].includes(segments[0] ?? "")) {
    return { id: "", kind: "none", error: "channel", startSeconds };
  }

  return { id: "", kind: "none", error: "no-id", startSeconds };
}

/**
 * Ordered largest first. `maxresdefault` exists only when the video was uploaded at 720p
 * or above and `sddefault` from 480p, while `hqdefault`, `mqdefault` and `default` always
 * exist — YouTube generates them from whatever it has. The three numbered frames are the
 * stills YouTube offered the uploader when they picked a thumbnail; they are grabbed at
 * roughly 25%, 50% and 75% of the running time.
 */
const SIZES: Array<Omit<ThumbnailVariant, "url" | "filename">> = [
  { key: "maxres", file: "maxresdefault", width: 1280, height: 720, frame: false },
  { key: "sd", file: "sddefault", width: 640, height: 480, frame: false },
  { key: "hq", file: "hqdefault", width: 480, height: 360, frame: false },
  { key: "mq", file: "mqdefault", width: 320, height: 180, frame: false },
  { key: "default", file: "default", width: 120, height: 90, frame: false },
  { key: "hq1", file: "hq1", width: 480, height: 360, frame: true },
  { key: "hq2", file: "hq2", width: 480, height: 360, frame: true },
  { key: "hq3", file: "hq3", width: 480, height: 360, frame: true },
];

/**
 * i.ytimg.com is the CDN that img.youtube.com redirects to, so addressing it directly
 * saves a round trip. The WebP copies live under a separate /vi_webp/ path and are
 * usually 25-35% smaller at the same pixel size.
 */
export function thumbnailUrl(id: string, file: string, format: ThumbnailFormat = "jpg"): string {
  if (!ID_RE.test(id)) return "";
  return format === "webp"
    ? `https://i.ytimg.com/vi_webp/${id}/${file}.webp`
    : `https://i.ytimg.com/vi/${id}/${file}.jpg`;
}

const EMPTY_SET: ThumbnailSet = {
  parsed: { ...NONE },
  variants: [],
  watchUrl: "",
  shortUrl: "",
  bestKey: "",
};

/** Build every thumbnail address for whatever was pasted. Never throws. */
export function buildThumbnailSet(input: string, format: ThumbnailFormat = "jpg"): ThumbnailSet {
  const parsed = parseYouTubeId(input);
  if (!parsed.id) return { ...EMPTY_SET, parsed };

  const ext = format === "webp" ? "webp" : "jpg";
  const variants = SIZES.map((size) => ({
    ...size,
    url: thumbnailUrl(parsed.id, size.file, format),
    filename: `${parsed.id}-${size.file}.${ext}`,
  }));

  return {
    parsed,
    variants,
    watchUrl: `https://www.youtube.com/watch?v=${parsed.id}`,
    shortUrl: `https://youtu.be/${parsed.id}`,
    bestKey: "maxres",
  };
}
