import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * One Markdown file per update, in src/content/changelog/. The file name is
 * the entry's link anchor (e.g. 2026-10-10-open-beta.md -> #2026-10-10-open-beta).
 */
const changelog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/changelog" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    /** Set to true to keep an entry out of the built site. */
    draft: z.boolean().default(false),
  }),
});

/**
 * One Markdown file per guide, in src/content/guides/. The file name is the
 * page address (getting-started.md -> /guides/getting-started/).
 */
const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string(),
    /** One sentence, shown on the guides list and in search results. */
    description: z.string(),
    /** Position on the guides list, lowest first. */
    order: z.number(),
    /** A monster portrait from /images/ to show on the guide's card. */
    icon: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { changelog, guides };
