import { Assets, type Texture } from "pixi.js";

/**
 * The waits before each try after the first. Flash's `ImageCache` gave a file
 * five tries before it gave up on it (`Loadable.tryLimit`); so does the yard.
 */
export const RETRY_DELAYS_MS: readonly number[] = [250, 500, 1000, 2000];

/** How many times a yard picture is asked for before it counts as missing. */
export const LOAD_TRIES = RETRY_DELAYS_MS.length + 1;

/**
 * `Assets.load`, asked again when it fails, after waits that double from a
 * quarter of a second: five tries over about four seconds.
 *
 * A first load asks for a hundred pictures at once from a server that may
 * have just started on a slow disk, and one of them can come back broken
 * where the next ask would not. Pixi forgets a failed load, so each try is a
 * fresh request. Once `gone` says the asker has left, it stops asking.
 *
 * @param {string} url - The picture to load.
 * @param {() => boolean} gone - True once nobody wants the picture any more.
 * @returns {Promise<Texture>} The picture, or the last try's error.
 */
export const loadWithRetries = async (url: string, gone: () => boolean = () => false): Promise<Texture> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await Assets.load<Texture>(url);
    } catch (caught) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw caught;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (gone()) throw caught;
    }
  }
};
