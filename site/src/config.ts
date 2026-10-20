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
   * The Ko-fi page for one-time gifts. Leave it empty and every Ko-fi button
   * and all "one-time gift" wording stays hidden; paste the page link here
   * (e.g. "https://ko-fi.com/yourname") once it exists.
   */
  kofiUrl: "",
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
  /**
   * The trailer at the top of the home page. It plays muted on a loop, with a
   * "Play with sound" button, and only loads once the page has settled. Drop
   * the finished trailer (MP4, H.264 + AAC, 1280x720 or 1920x1080, ideally
   * under 15 MB) in at `src`. Until that file exists, or if it fails to load,
   * visitors simply see the poster still and no buttons.
   */
  trailer: {
    src: "/video/trailer-beta3.mp4",
    poster: "/video/trailer-beta3-poster.webp",
  },
  showcaseVideo: {
    src: "/video/raid-loop.mp4",
    poster: "/video/raid-loop-poster.webp",
    uploaded: "2026-10-11",
    seconds: 14,
  },
} as const;
