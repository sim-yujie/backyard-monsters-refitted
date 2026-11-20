import { Assets } from "pixi.js";

/**
 * Beta 8 (owner, 19 Nov 2026): the game's pictures load as plain `<img>`
 * pictures on every browser, not as ImageBitmaps.
 *
 * Pixi's texture loader by default decodes each picture into an ImageBitmap
 * (`createImageBitmap`) and keeps it open for as long as the texture lives, as
 * well as uploading a copy to the graphics card: every picture held twice. An
 * `<img>` leaves the decoded copy to the browser, which may drop it once the
 * picture is on the card and decode it again if it is needed (a lost graphics
 * context, a texture uploaded again). Measured on 19 Nov: the worst moment of
 * WebKit at iPhone size went from about 4.6 GB to 1.9 GB, Android-size Chrome
 * from 1,356 to 1,073 MB, with the same art. The cost: a picture is decoded
 * on the page's own thread when it first goes to the card, so the first yard
 * load has longer pauses.
 *
 * Pictures are fetched by the page, not by Pixi's worker pool (it only makes
 * ImageBitmaps anyway). The pool fetched one picture per worker, one worker
 * per processor core, newest request first: a yard asking for a hundred
 * pictures at once waited in a queue of four to twelve, its walls (asked for
 * first) served last, and a 10 MB monster sheet held a worker the whole time.
 *
 * `crossOrigin: "anonymous"` (Pixi's default, set here so it stays): the art
 * comes from another address when `VITE_ART_URL` is set (Cloudflare, which
 * answers `access-control-allow-origin: *`), and the game reads some pictures
 * back through a canvas (strip cuts, yard and map ground, clouds, tribe
 * avatars), which a picture loaded without it would block.
 *
 * Call before the first `Assets.load`.
 */
export const usePlainPictures = (): void => {
  Assets.setPreferences({ preferWorkers: false, preferCreateImageBitmap: false, crossOrigin: "anonymous" });
};
