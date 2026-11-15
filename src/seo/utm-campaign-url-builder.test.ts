import { describe, expect, it } from "vitest";
import {
  type UtmCampaignUrlInput,
  buildUtmUrl,
  ga4Channel,
  ga4ChannelForMedium,
} from "./utm-campaign-url-builder.js";

const base: UtmCampaignUrlInput = {
  baseUrl: "https://example.com/landing",
  source: "",
  medium: "",
  campaign: "",
  term: "",
  content: "",
};
const build = (o: Partial<UtmCampaignUrlInput>) => buildUtmUrl({ ...base, ...o });

describe("buildUtmUrl", () => {
  it("returns the invalid empty result for empty or whitespace URL", () => {
    for (const baseUrl of ["", "   "]) {
      expect(build({ baseUrl, source: "x" })).toEqual({
        url: "",
        isValid: false,
        utmParamCount: 0,
        urlLength: 0,
        existingUtm: [],
      });
    }
  });

  it("builds a URL with all params in Google's order (id first)", () => {
    const r = build({
      id: "abc123",
      source: "google",
      medium: "cpc",
      campaign: "spring_sale",
      term: "running shoes",
      content: "logolink",
    });
    const expected =
      "https://example.com/landing?utm_id=abc123&utm_source=google&utm_medium=cpc" +
      "&utm_campaign=spring_sale&utm_term=running%20shoes&utm_content=logolink";
    expect(r.url).toBe(expected);
    expect(r.isValid).toBe(true);
    expect(r.utmParamCount).toBe(6);
    expect(r.urlLength).toBe(expected.length);
  });

  it("omits empty and whitespace-only fields and trims values", () => {
    const r = build({ source: "  newsletter  ", medium: "   ", campaign: "may" });
    expect(r.url).toBe("https://example.com/landing?utm_source=newsletter&utm_campaign=may");
    expect(r.utmParamCount).toBe(2);
  });

  it("returns the bare URL (still valid) when no params are given", () => {
    const r = build({});
    expect(r.url).toBe("https://example.com/landing");
    expect(r.isValid).toBe(true);
    expect(r.utmParamCount).toBe(0);
  });

  it("adds https:// when the scheme is missing", () => {
    expect(build({ baseUrl: "example.com", source: "fb" }).url).toBe(
      "https://example.com/?utm_source=fb",
    );
  });

  it("keeps an http:// scheme", () => {
    expect(build({ baseUrl: "http://example.com/a", source: "x" }).url).toBe(
      "http://example.com/a?utm_source=x",
    );
  });

  it("rejects non-http(s) schemes and hosts without a dot", () => {
    expect(build({ baseUrl: "ftp://example.com", source: "x" }).isValid).toBe(false);
    expect(build({ baseUrl: "mailto://example.com", source: "x" }).isValid).toBe(false);
    expect(build({ baseUrl: "intranet", source: "x" }).isValid).toBe(false);
    expect(build({ baseUrl: "https://exa mple.com", source: "x" }).isValid).toBe(false);
  });

  it("allows localhost", () => {
    expect(build({ baseUrl: "http://localhost:3000/x", source: "t" }).url).toBe(
      "http://localhost:3000/x?utm_source=t",
    );
  });

  it("keeps existing query params and puts the fragment after the query", () => {
    expect(build({ baseUrl: "https://example.com/p?ref=1#top", source: "x" }).url).toBe(
      "https://example.com/p?ref=1&utm_source=x#top",
    );
  });

  it("overwrites an existing utm param instead of duplicating it", () => {
    expect(build({ baseUrl: "https://example.com/?utm_source=old", source: "new" }).url).toBe(
      "https://example.com/?utm_source=new",
    );
  });

  it("percent-encodes Cyrillic, spaces, & and = in values", () => {
    // encodeURIComponent("весна") = %D0%B2%D0%B5%D1%81%D0%BD%D0%B0
    const r = build({ campaign: "весна 2026", content: "a&b=c" });
    expect(r.url).toBe(
      "https://example.com/landing?utm_campaign=%D0%B2%D0%B5%D1%81%D0%BD%D0%B0%202026&utm_content=a%26b%3Dc",
    );
    expect(r.url).not.toContain("+");
  });

  it("encodes a literal plus sign so it is not read back as a space", () => {
    const r = build({ source: "c++" });
    expect(new URL(r.url).searchParams.get("utm_source")).toBe("c++");
  });

  it("round-trips emoji values", () => {
    const r = build({ campaign: "🔥sale" });
    expect(new URL(r.url).searchParams.get("utm_campaign")).toBe("🔥sale");
  });

  it("treats a missing id as empty", () => {
    const r = buildUtmUrl({ ...base, source: "a" });
    expect(r.url).not.toContain("utm_id");
  });

  it("adds the three newer GA4 parameters after utm_content", () => {
    const r = build({
      source: "google",
      content: "hero",
      sourcePlatform: "Search Ads 360",
      creativeFormat: "native",
      marketingTactic: "remarketing",
    });
    expect(r.url).toBe(
      "https://example.com/landing?utm_source=google&utm_content=hero&utm_source_platform=Search%20Ads%20360&utm_creative_format=native&utm_marketing_tactic=remarketing",
    );
    expect(r.utmParamCount).toBe(5);
  });

  // Regression: the whole query was re-serialised (q=a+b → q=a%20b, flag → flag=).
  it("keeps the existing query string byte for byte", () => {
    expect(build({ baseUrl: "https://example.com/p?q=a+b&flag", source: "x" }).url).toBe(
      "https://example.com/p?q=a+b&flag&utm_source=x",
    );
    const signed = "https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Signature=ab%2Fcd&X-Amz-Expires=60";
    expect(build({ baseUrl: signed, source: "x" }).url).toBe(`${signed}&utm_source=x`);
  });

  // Regression: stale utm_* from the pasted URL stayed in the link but not in the counter.
  it("takes old utm_* out of the pasted URL and reports them", () => {
    const r = build({
      baseUrl: "https://example.com/p?utm_source=old&a=1&UTM_Medium=old%20x",
      source: "new",
    });
    expect(r.url).toBe("https://example.com/p?a=1&utm_source=new");
    expect(r.utmParamCount).toBe(1);
    expect(r.existingUtm).toEqual([
      ["utm_source", "old"],
      ["utm_medium", "old x"],
    ]);
  });

  // Regression: utm_reader and other unknown utm_* keys were stripped, though only the nine
  // parameters the form owns can be moved into it.
  it("keeps unknown utm_* keys byte for byte and strips only the nine known ones", () => {
    const r = build({
      baseUrl: "https://example.com/p?utm_reader=feedly&UTM_Brand=A%2Bb&utm_campaign=old&x=1",
      source: "new",
    });
    expect(r.url).toBe(
      "https://example.com/p?utm_reader=feedly&UTM_Brand=A%2Bb&x=1&utm_source=new",
    );
    expect(r.existingUtm).toEqual([["utm_campaign", "old"]]);
  });

  // Regression: mailto:a@b.com became https://b.com/ (the "mailto:a" part read as a login).
  it("rejects mailto:, tel: and other schemes without //, but not host:port", () => {
    for (const baseUrl of [
      "mailto:a@b.com",
      "tel:+123456",
      "javascript:alert(1)",
      "data:text/html,x",
    ]) {
      expect(build({ baseUrl, source: "x" }).isValid, baseUrl).toBe(false);
    }
    expect(build({ baseUrl: "example.com:8080/a", source: "x" }).url).toBe(
      "https://example.com:8080/a?utm_source=x",
    );
  });

  it("keeps a user:password@ part instead of dropping it", () => {
    expect(build({ baseUrl: "https://user:pw@example.com/a", source: "x" }).url).toBe(
      "https://user:pw@example.com/a?utm_source=x",
    );
  });

  it("does not leave a double ? after a bare trailing ?", () => {
    expect(build({ baseUrl: "https://example.com/a?", source: "x" }).url).toBe(
      "https://example.com/a?utm_source=x",
    );
  });
});

describe("ga4ChannelForMedium", () => {
  it("maps the documented mediums to GA4 channels", () => {
    const ch = (m: string) => {
      const v = ga4ChannelForMedium(m);
      return v.kind === "channel" ? v.channel : v.kind;
    };
    expect(ch("cpc")).toBe("paid");
    expect(ch("paid_social")).toBe("paid");
    expect(ch("Social")).toBe("Organic Social");
    expect(ch("email")).toBe("Email");
    expect(ch("cpm")).toBe("Display");
    expect(ch("banner")).toBe("Display");
    expect(ch("affiliate")).toBe("Affiliates");
    expect(ch("referral")).toBe("Referral");
    expect(ch("organic")).toBe("Organic Search");
    expect(ch("audio")).toBe("Audio");
    expect(ch("sms")).toBe("SMS");
    expect(ch("push")).toBe("Mobile Push Notifications");
    expect(ch("retargeting")).toBe("paid");
    expect(ch("paid_video")).toBe("paid");
    expect(ch("  ")).toBe("empty");
  });

  it("flags plausible values GA4 cannot classify", () => {
    for (const m of ["qr", "qrcode", "newsletter", "affiliates", "telegram", "banner_ad", "blog"]) {
      expect(ga4ChannelForMedium(m).kind, m).toBe("unassigned");
    }
  });
});

// Regression: the hint judged utm_medium alone, so vk + cpc read as Paid Search.
describe("ga4Channel", () => {
  const ch = (source: string, medium: string) => {
    const v = ga4Channel(source, medium);
    return v.kind === "channel" ? v.channel : v.kind;
  };

  it("needs a search source for Paid Search and a social source for Paid Social", () => {
    expect(ch("google", "cpc")).toBe("Paid Search");
    expect(ch("www.google.com", "ppc")).toBe("Paid Search");
    expect(ch("Yandex", "cpc")).toBe("Paid Search");
    expect(ch("bing", "paid_search")).toBe("Paid Search");
    expect(ch("go.mail.ru", "cpc")).toBe("Paid Search");
    expect(ch("vk", "cpc")).toBe("Paid Social");
    expect(ch("facebook", "paid_social")).toBe("Paid Social");
    expect(ch("m.facebook.com", "cpc")).toBe("Paid Social");
    expect(ch("telegram", "cpc")).toBe("Paid Social");
    expect(ch("x", "cpc")).toBe("Paid Social");
    expect(ch("youtube", "cpc")).toBe("Paid Video");
    expect(ch("amazon", "cpc")).toBe("Paid Shopping");
    // A search engine with a social medium is not Paid Social.
    expect(ch("google", "paid_social")).toBe("Paid Search");
  });

  it("leaves a paid medium from an unknown or empty source undecided", () => {
    expect(ch("", "cpc")).toBe("paid");
    expect(ch("newsletter_partner", "cpc")).toBe("paid");
    expect(ch("googleads_typo", "cpc")).toBe("paid");
  });

  it("puts display mediums in Display unless a search source makes cpm Paid Search", () => {
    expect(ch("adsense", "display")).toBe("Display");
    expect(ch("", "cpm")).toBe("Display");
    expect(ch("google", "cpm")).toBe("Paid Search");
  });

  it("uses the source for the organic channels", () => {
    expect(ch("instagram", "social")).toBe("Organic Social");
    expect(ch("vk", "post")).toBe("Organic Social");
    expect(ch("youtube", "video")).toBe("Organic Video");
    expect(ch("youtube", "social")).toBe("Organic Social");
    expect(ch("google", "organic")).toBe("Organic Search");
    expect(ch("google", "newsletter")).toBe("Organic Search");
    expect(ch("email", "newsletter")).toBe("Email");
    expect(ch("newsletter", "email")).toBe("Email");
    expect(ch("sms", "text")).toBe("SMS");
    expect(ch("firebase", "x")).toBe("Mobile Push Notifications");
    expect(ch("flyer", "qr")).toBe("unassigned");
    expect(ch("google", "")).toBe("empty");
  });

  it("does not read a source that merely contains a known name as that site", () => {
    expect(ch("okko", "social")).toBe("Organic Social");
    expect(ch("okko", "cpc")).toBe("paid");
    expect(ch("xbox", "cpc")).toBe("paid");
    expect(ch("googlexcom", "cpc")).toBe("paid");
  });
});
