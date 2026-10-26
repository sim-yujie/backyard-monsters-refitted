# bymrevamped.com

The public website for Backyard Monsters Revamped: landing page, changelog, guides, support and credits. The game itself is in `web/` and lives at play.bymrevamped.com; this folder is a separate Astro project and nothing in `web/` depends on it.

```sh
cd site
bun install
bun run dev      # local preview at http://localhost:4321
bun run build    # static site in site/dist/
```

Vercel: root directory `site`, build command `bun run build`, output directory `dist` (Astro preset).

## Adding content

- **Changelog entry:** add `src/content/changelog/<yyyy-mm-dd>-<short-name>.md` with `title` and `date` in the front matter, then plain Markdown. Newest entries show first; the home page lists the latest two.
- **Guide:** add `src/content/guides/<address>.md` with `title`, `description`, `order` (position on the list), `updated` (the day you last changed it, `yyyy-mm-dd`; it feeds the sitemap and search data) and optionally `icon` (an image under `public/images/`). The file name becomes `/guides/<address>/`.
- Either kind can carry `draft: true` to keep it off the built site.

## Search engines

Every page carries structured data (JSON-LD, built from `src/data/schema.ts`) describing the site, and the home page also describes the game, the raid clip and the FAQ. The FAQ questions and answers live in `src/data/faq.ts`, which fills both the visible section and the data. `/sitemap.xml` and `/llms.txt` (a plain summary for AI answer engines) are built from the same settings and guides, so they stay current.

## Settings

`src/config.ts` holds every outside link (game, Patreon, Privacy, Terms). `discordUrl` is the community invite; set it to `""` and every Discord button and link is hidden.

## Images

All images are pre-sized WebP files in `public/images/` (screenshots 1280x720 in `shots/`). A `<Shot name="...">` on the home page shows `public/images/shots/<name>.webp`, or a "Screenshot coming soon" box until that file exists. `public/og.jpg` is the 1200x630 share picture.

## Font

Headings and buttons use Titan One by Rodrigo Fuenzalida, the same file as the game (`public/fonts/titan-one/`), under the SIL Open Font License 1.1 (`OFL.txt` beside it), which allows web use and self-hosting. Body text uses the reader's system font.
