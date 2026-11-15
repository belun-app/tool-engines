import { describe, expect, it } from "vitest";
import { buildThumbnailSet, parseYouTubeId, thumbnailUrl } from "./youtube-thumbnail-downloader.js";

// Checking which sizes exist means loading the images (mount, network); the URL
// building and link parsing are pure.

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeId — accepted shapes", () => {
  it.each([
    [ID, "raw-id", 0],
    [`  ${ID}  `, "raw-id", 0],
    [`https://www.youtube.com/watch?v=${ID}`, "watch", 0],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, "watch", 90],
    [`https://m.youtube.com/watch?feature=share&v=${ID}&list=PL123`, "watch", 0],
    [`https://music.youtube.com/watch?v=${ID}`, "watch", 0],
    [`www.youtube.com/watch?v=${ID}&t=1h2m3s`, "watch", 3723],
    [`http://YOUTUBE.com/watch?v=${ID}&t=90.7`, "watch", 90],
    [`youtu.be/${ID}?t=42`, "short-link", 42],
    [`https://youtu.be/${ID}?si=tracking`, "short-link", 0],
    [`https://www.youtube.com/shorts/${ID}?feature=share`, "shorts", 0],
    [`https://www.youtube-nocookie.com/embed/${ID}?start=10`, "embed", 10],
    [`https://www.youtube.com/v/${ID}`, "embed", 0],
    [`https://www.youtube.com/live/${ID}`, "live", 0],
  ])("%s -> %s", (input, kind, start) => {
    expect(parseYouTubeId(input)).toEqual({ id: ID, kind, error: "", startSeconds: start });
  });

  it("unwraps attribution links", () => {
    const r = parseYouTubeId(
      `https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3D${ID}%26t%3D5`,
    );
    expect(r).toMatchObject({ id: ID, kind: "watch", startSeconds: 5 });
  });
});

describe("parseYouTubeId — rejections", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["https://vimeo.com/123456", "no-id"],
    ["not a url at all", "no-id"],
    ["https://www.youtube.com/", "no-id"],
    ["https://youtu.be/", "no-id"],
    ["https://www.youtube.com/shorts/", "no-id"],
    ["https://www.youtube.com/watch?v=short", "bad-id"],
    ["https://youtu.be/too-long-id-here", "bad-id"],
    ["https://www.youtube.com/embed/%%%", "bad-id"],
    ["https://www.youtube.com/playlist?list=PLabc", "playlist"],
    ["https://www.youtube.com/@SomeChannel", "channel"],
    ["https://www.youtube.com/channel/UCabc", "channel"],
    ["https://www.youtube.com/user/someone", "channel"],
  ])("%s -> %s", (input, error) => {
    const r = parseYouTubeId(input);
    expect(r.id).toBe("");
    expect(r.kind).toBe("none");
    expect(r.error).toBe(error);
  });

  it("ignores unreadable or negative times", () => {
    expect(parseYouTubeId(`https://youtu.be/${ID}?t=abc`).startSeconds).toBe(0);
    expect(parseYouTubeId(`https://youtu.be/${ID}?t=-5`).startSeconds).toBe(0);
  });
});

describe("thumbnailUrl", () => {
  it("builds JPG and WebP CDN addresses", () => {
    expect(thumbnailUrl(ID, "hqdefault")).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
    expect(thumbnailUrl(ID, "maxresdefault", "webp")).toBe(
      `https://i.ytimg.com/vi_webp/${ID}/maxresdefault.webp`,
    );
  });

  it("refuses invalid IDs", () => {
    expect(thumbnailUrl("bad", "default")).toBe("");
    expect(thumbnailUrl("../../etc/pa", "default")).toBe("");
  });
});

describe("buildThumbnailSet", () => {
  it("lists all eight variants largest first with names and links", () => {
    const set = buildThumbnailSet(`https://youtu.be/${ID}`);
    expect(set.variants.map((v) => v.key)).toEqual([
      "maxres",
      "sd",
      "hq",
      "mq",
      "default",
      "hq1",
      "hq2",
      "hq3",
    ]);
    expect(set.variants[0]).toEqual({
      key: "maxres",
      file: "maxresdefault",
      width: 1280,
      height: 720,
      frame: false,
      url: `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`,
      filename: `${ID}-maxresdefault.jpg`,
    });
    expect(set.variants.filter((v) => v.frame)).toHaveLength(3);
    expect(set.watchUrl).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(set.shortUrl).toBe(`https://youtu.be/${ID}`);
    expect(set.bestKey).toBe("maxres");
  });

  it("uses WebP names and URLs when asked", () => {
    const set = buildThumbnailSet(ID, "webp");
    expect(set.variants[2].url).toBe(`https://i.ytimg.com/vi_webp/${ID}/hqdefault.webp`);
    expect(set.variants[2].filename).toBe(`${ID}-hqdefault.webp`);
  });

  it("returns an empty set carrying the parse error", () => {
    const set = buildThumbnailSet("https://www.youtube.com/playlist?list=PL1");
    expect(set).toEqual({
      parsed: { id: "", kind: "none", error: "playlist", startSeconds: 0 },
      variants: [],
      watchUrl: "",
      shortUrl: "",
      bestKey: "",
    });
  });
});
