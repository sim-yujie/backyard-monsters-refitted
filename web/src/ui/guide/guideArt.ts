/**
 * Bob's art (issue #227, `docs/design/tutorial.md` §3): design A, "Round
 * buddy", painted with Gemini like the portraits and approved by the owner.
 * `web/public/guide/`, written by `web/tools/gen-guide-art.py`, at twice the
 * size it is drawn.
 */

const guideFile = (file: string): string => `${import.meta.env.BASE_URL}guide/${file}.webp`;

/** Bob's moods. */
export type BobMood = "happy" | "worried";

/** Bob's bust for a mood: 240 px, drawn at 120 (80 on a phone). */
export const bobBust = (mood: BobMood = "happy"): string =>
  guideFile(mood === "worried" ? "bob-worried" : "bob");

/** Bob's head, for screen tips: 96 px, drawn at 48. */
export const BOB_ICON = guideFile("bob-icon");

/** Bob's pointing hand, the pointer: 200x93, drawn 100 wide, pointing right. */
export const BOB_HAND = guideFile("hand");

/** Every guide file, for the test that checks they exist. */
export const GUIDE_FILES = ["bob", "bob-worried", "bob-icon", "hand"] as const;
