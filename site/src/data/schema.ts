import { SITE } from "../config";

/**
 * Structured data (schema.org JSON-LD) that tells search engines and AI
 * answer engines what the site and the game are. Base.astro always adds the
 * website and the organisation; a page passes anything else it describes.
 */
export type Thing = Record<string, unknown>;

const abs = (path: string) => new URL(path, SITE.url).href;

export const ids = {
  website: abs("/#website"),
  organization: abs("/#organization"),
  game: abs("/#game"),
};

export const website: Thing = {
  "@type": "WebSite",
  "@id": ids.website,
  name: SITE.name,
  alternateName: SITE.shortName,
  url: abs("/"),
  inLanguage: "en",
  publisher: { "@id": ids.organization },
};

export const organization: Thing = {
  "@type": "Organization",
  "@id": ids.organization,
  name: SITE.name,
  url: abs("/"),
  logo: abs("/apple-touch-icon.png"),
  email: SITE.bugEmail,
  description: "An unofficial fan project that runs Backyard Monsters Revamped. Not affiliated with Kixeye.",
};

export const videoGame: Thing = {
  "@type": "VideoGame",
  "@id": ids.game,
  name: SITE.name,
  alternateName: SITE.shortName,
  description:
    "A free, unofficial fan-made revamp of Backyard Monsters. Build a yard, hatch an army of monsters and raid wild tribes and other players, right in your web browser. No Flash, no download.",
  url: SITE.gameUrl,
  image: abs("/og.jpg"),
  genre: ["Strategy", "Base building"],
  gamePlatform: "Web browser",
  applicationCategory: "Game",
  operatingSystem: "Any (web browser)",
  playMode: "MultiPlayer",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: 0, priceCurrency: "USD", url: SITE.gameUrl },
  publisher: { "@id": ids.organization },
  isBasedOn: {
    "@type": "VideoGame",
    name: "Backyard Monsters",
    description: "The original game by Kixeye. Backyard Monsters Revamped is an unofficial fan project, not made by or affiliated with Kixeye.",
    publisher: { "@type": "Organization", name: "Kixeye" },
  },
};

/** The looping raid clip on the home page. */
export const raidVideo: Thing = {
  "@type": "VideoObject",
  name: "Backyard Monsters Revamped gameplay: Teratorns raid a wild tribe camp",
  description: "Teratorns tear into a Kozu Tribe camp in Backyard Monsters Revamped. Every raid plays out live in your browser.",
  thumbnailUrl: abs(SITE.showcaseVideo.poster),
  contentUrl: abs(SITE.showcaseVideo.src),
  uploadDate: SITE.showcaseVideo.uploaded,
  duration: `PT${SITE.showcaseVideo.seconds}S`,
  isFamilyFriendly: true,
};

export function faqPage(items: { q: string; a: string }[]): Thing {
  return {
    "@type": "FAQPage",
    "@id": abs("/#faq"),
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

export function breadcrumbs(trail: { name: string; path: string }[]): Thing {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: abs(step.path),
    })),
  };
}

export function guideArticle(guide: { title: string; description: string; path: string; updated: Date }): Thing {
  const date = guide.updated.toISOString().slice(0, 10);
  return {
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    url: abs(guide.path),
    mainEntityOfPage: abs(guide.path),
    // The share picture: guide icons are too small for search previews.
    image: abs("/og.jpg"),
    datePublished: date,
    dateModified: date,
    inLanguage: "en",
    author: { "@id": ids.organization },
    publisher: { "@id": ids.organization },
    about: { "@type": "VideoGame", "@id": ids.game, name: SITE.name, url: SITE.gameUrl },
    isPartOf: { "@id": ids.website },
  };
}

/** One JSON-LD graph, safe to put inside a script tag. */
export function toJsonLd(things: Thing[]): string {
  return JSON.stringify({ "@context": "https://schema.org", "@graph": things }).replace(/</g, "\\u003c");
}
