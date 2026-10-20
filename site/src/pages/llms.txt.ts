import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { SITE } from "../config";
import { faq } from "../data/faq";

const abs = (path: string) => new URL(path, SITE.url).href;

/**
 * /llms.txt: a short plain-text summary of the site for AI answer engines
 * (see llmstxt.org). Built from the same settings, guides and FAQ as the
 * pages, so it never drifts from them.
 */
export const GET: APIRoute = async () => {
  const guides = (await getCollection("guides", ({ data }) => !data.draft)).sort((a, b) => a.data.order - b.data.order);
  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.name} is a free, unofficial fan-made revamp of Backyard Monsters, the yard-building monster strategy game. ` +
      `It runs in a web browser at ${SITE.gameUrl}, with no Flash and nothing to download. ` +
      "It is not made by, affiliated with, endorsed by or sponsored by Kixeye, who created the original game.",
    "",
    "The game is in open beta: it is live and free to play, but still being built, and progress may be reset before the full launch. " +
      `It is run by one fan, and its server is based on Backyard Monsters Refitted (${SITE.refittedUrl}).`,
    "",
    "## Play",
    "",
    `- [Play ${SITE.name}](${SITE.gameUrl}): sign up with a username, email and password and play in your browser.`,
    "",
    "## Guides",
    "",
    ...guides.map((g) => `- [${g.data.title}](${abs(`/guides/${g.id}/`)}): ${g.data.description}`),
    "",
    "## Questions",
    "",
    ...faq.flatMap(({ q, a }) => [`### ${q}`, "", a, ""]),
    "## More",
    "",
    `- [Home page](${abs("/")}): what the game is, screenshots, a gameplay clip and these questions.`,
    `- [Changelog](${abs("/changelog/")}): every update, in plain language.`,
    `- [Support us](${abs("/support/")}): what running the game costs and how to help.`,
    `- [Thank you](${abs("/support/thanks/")}): the supporters who help keep the game online.`,
    `- [Credits](${abs("/credits/")}): the Backyard Monsters Refitted server, the licence, the art and the font.`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
