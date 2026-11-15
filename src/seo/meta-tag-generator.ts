/**
 * Builds the HTML meta tags of a page (title, description, Open Graph and Twitter Card) and
 * checks the title and description lengths.
 */

export interface MetaTagInput {
  title: string;
  description: string;
  url: string;
  siteName: string;
  imageUrl: string;
  twitterHandle: string;
  ogType: string;
  twitterCard: string;
}

export type LengthStatus = "empty" | "short" | "ok" | "long";

export interface MetaTagResult {
  html: string;
  titleLength: number;
  descriptionLength: number;
  titleStatus: LengthStatus;
  descriptionStatus: LengthStatus;
}

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lengthStatus(length: number, min: number, max: number): LengthStatus {
  if (length === 0) return "empty";
  if (length < min) return "short";
  if (length > max) return "long";
  return "ok";
}

export function normalizeTwitterHandle(handle: string): string {
  const trimmed = handle.trim().replace(/^@+/, "");
  return trimmed ? `@${trimmed}` : "";
}

export function generateMetaTags(input: MetaTagInput): MetaTagResult {
  const title = input.title.trim();
  const description = input.description.trim();
  const url = input.url.trim();
  const siteName = input.siteName.trim();
  const imageUrl = input.imageUrl.trim();
  const handle = normalizeTwitterHandle(input.twitterHandle);
  const ogType = input.ogType.trim() || "website";
  const twitterCard = input.twitterCard.trim() || "summary_large_image";

  const lines: string[] = [];

  if (title) lines.push(`<title>${escapeAttr(title)}</title>`);
  if (description) lines.push(`<meta name="description" content="${escapeAttr(description)}">`);
  if (url) lines.push(`<link rel="canonical" href="${escapeAttr(url)}">`);

  if (title || description || url || siteName || imageUrl) {
    lines.push("");
    lines.push("<!-- Open Graph -->");
    lines.push(`<meta property="og:type" content="${escapeAttr(ogType)}">`);
    if (title) lines.push(`<meta property="og:title" content="${escapeAttr(title)}">`);
    if (description)
      lines.push(`<meta property="og:description" content="${escapeAttr(description)}">`);
    if (url) lines.push(`<meta property="og:url" content="${escapeAttr(url)}">`);
    if (siteName) lines.push(`<meta property="og:site_name" content="${escapeAttr(siteName)}">`);
    if (imageUrl) lines.push(`<meta property="og:image" content="${escapeAttr(imageUrl)}">`);

    lines.push("");
    lines.push("<!-- Twitter Card -->");
    lines.push(`<meta name="twitter:card" content="${escapeAttr(twitterCard)}">`);
    if (title) lines.push(`<meta name="twitter:title" content="${escapeAttr(title)}">`);
    if (description)
      lines.push(`<meta name="twitter:description" content="${escapeAttr(description)}">`);
    if (imageUrl) lines.push(`<meta name="twitter:image" content="${escapeAttr(imageUrl)}">`);
    if (handle) lines.push(`<meta name="twitter:site" content="${escapeAttr(handle)}">`);
  }

  return {
    html: lines.join("\n").trim(),
    titleLength: title.length,
    descriptionLength: description.length,
    titleStatus: lengthStatus(title.length, TITLE_MIN, TITLE_MAX),
    descriptionStatus: lengthStatus(description.length, DESCRIPTION_MIN, DESCRIPTION_MAX),
  };
}
