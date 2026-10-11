/**
 * Site-wide settings. Change a link here and every page picks it up.
 */
export const SITE = {
  name: "Backyard Monsters Revamped",
  shortName: "BYM Revamped",
  url: "https://bymrevamped.com",
  description:
    "A free, fan-made revamp of Backyard Monsters. Build your yard, hatch monsters and raid wild tribes and other players in your browser. No Flash, no download.",
  gameUrl: "https://play.bymrevamped.com",
  privacyUrl: "https://play.bymrevamped.com/privacy",
  termsUrl: "https://play.bymrevamped.com/terms",
  patreonUrl: "https://www.patreon.com/c/TheMonsterLab",
  refittedUrl: "https://bymrefitted.com",
  licenceUrl: "https://polyformproject.org/licenses/noncommercial/1.0.0/",
  /**
   * The community Discord invite. Leave it empty and every Discord button
   * stays hidden; paste the invite link here once the server is ready.
   */
  discordUrl: "",
  /**
   * Where players send bug reports until the Discord exists. Shown as plain
   * text with a mailto link on the Support page and the home page's beta notice.
   */
  bugEmail: "simyujie@gmail.com",
  /**
   * The muted, looping gameplay clip on the home page (files under public/).
   * To swap in another clip, drop the MP4 (H.264, about 1280x720, a few MB)
   * and a still from it into public/video/ and change these two paths.
   * Set `src` to "" to show only the still. `uploaded` and `seconds` describe
   * the clip to search engines: update them with the clip.
   */
  showcaseVideo: {
    src: "/video/raid-loop.mp4",
    poster: "/video/raid-loop-poster.webp",
    uploaded: "2026-10-11",
    seconds: 14,
  },
} as const;
