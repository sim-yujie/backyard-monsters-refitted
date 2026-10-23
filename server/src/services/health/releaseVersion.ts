import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Which release the server is running, for the dashboard.
 *
 * `config/release-stamp.txt` holds git placeholders that `git archive` fills
 * in (`export-subst` in .gitattributes): the live server is updated from
 * `git archive release` at the version tag (docs/deploy.md), so there it reads
 * e.g. `v2.0.0-beta.4 1a2b3c4d`. In a checkout the placeholders are left as
 * they are, and the version reads as null ("not a release copy").
 */
const STAMP = fileURLToPath(new URL("../../config/release-stamp.txt", import.meta.url));

export interface ReleaseVersion {
  /** The release tag, or `tag-N-gHASH` when N commits past it; null outside a release copy. */
  readonly release: string | null;
  /** The short commit hash; null outside a release copy. */
  readonly commit: string | null;
}

/** Reads a stamp's text; placeholders still in it mean it was never filled in. */
export const parseReleaseStamp = (text: string): ReleaseVersion => {
  if (text.includes("$Format:")) return { release: null, commit: null };
  const [release, commit] = text.trim().split(/\s+/);
  return { release: release || null, commit: commit || null };
};

const read = (): ReleaseVersion => {
  try {
    return parseReleaseStamp(readFileSync(STAMP, "utf8"));
  } catch {
    return { release: null, commit: null };
  }
};

/** Read once, at start-up: the code cannot change while the server runs. */
export const RELEASE_VERSION: ReleaseVersion = read();
