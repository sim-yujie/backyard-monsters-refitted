import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { SITE } from "../config";

/** A plain sitemap of every page, built with the site. */
export const GET: APIRoute = async () => {
  const guides = await getCollection("guides", ({ data }) => !data.draft);
  const paths = ["/", "/guides/", "/changelog/", "/support/", "/credits/", ...guides.map((g) => `/guides/${g.id}/`)];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${new URL(p, SITE.url).href}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
