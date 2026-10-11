import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { SITE } from "../config";

const day = (date: Date) => date.toISOString().slice(0, 10);
const newest = (dates: Date[]) => new Date(Math.max(...dates.map((d) => d.getTime())));

/**
 * A plain sitemap of every page, built with the site. `lastmod` comes from
 * the content itself: a guide's `updated` date, and the newest changelog
 * entry for the pages that show the changelog. Pages without a reliable date
 * leave it out rather than guess.
 */
export const GET: APIRoute = async () => {
  const guides = await getCollection("guides", ({ data }) => !data.draft);
  const changelog = await getCollection("changelog", ({ data }) => !data.draft);
  const latestNews = changelog.length ? day(newest(changelog.map((e) => e.data.date))) : undefined;
  const latestGuide = guides.length ? day(newest(guides.map((g) => g.data.updated))) : undefined;
  const pages: { path: string; lastmod?: string }[] = [
    { path: "/", lastmod: latestNews },
    { path: "/guides/", lastmod: latestGuide },
    { path: "/changelog/", lastmod: latestNews },
    { path: "/support/" },
    { path: "/credits/" },
    ...guides.map((g) => ({ path: `/guides/${g.id}/`, lastmod: day(g.data.updated) })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages
      .map(({ path, lastmod }) => {
        const date = lastmod ? `<lastmod>${lastmod}</lastmod>` : "";
        return `  <url><loc>${new URL(path, SITE.url).href}</loc>${date}</url>`;
      })
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
