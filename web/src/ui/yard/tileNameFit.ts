/**
 * How wide a Build tile's name is, so a long word can shrink to fit its tile
 * instead of breaking in the middle ("Observator" / "y"; lead, 11 Nov).
 *
 * The tile's name breaks only between words (`build-menu.css`). Its font
 * size is `min(normal size, room / NAME_FIT_EM)`, where the room is the
 * tile's own width (a container query unit), so the widest word always fits
 * on one line, at any window size and in either look.
 *
 * `ADVANCE` is each letter's width in em: the wider of Titan One and
 * Atkinson Hyperlegible Bold (the two `--font-display` faces), read from the
 * fonts in `public/fonts` (`hmtx`, units per em 1000), in hundredths. Kerning
 * only narrows a word, so this never under-measures.
 */
const FIRST = 33;
// prettier-ignore
const ADVANCE = [
  33, 52, 81, 66, 98, 78, 26, 45, 45, 56, 62, 29, 55, 29, 44, // ! " # $ % & ' ( ) * + , - . /
  73, 45, 61, 61, 63, 61, 66, 54, 66, 66, // 0-9
  29, 29, 57, 62, 57, 61, 79, // : ; < = > ? @
  74, 70, 67, 73, 61, 59, 72, 73, 46, 56, 71, 54, 88, 73, 76, 71, 78, 72, 65, 65, 73, 73, 102, 72, 70, 63, // A-Z
  47, 44, 47, 59, 59, 38, // [ \ ] ^ _ `
  66, 67, 55, 66, 64, 56, 66, 66, 35, 40, 64, 34, 98, 67, 68, 66, 66, 59, 61, 48, 68, 68, 98, 68, 66, 58, // a-z
  47, 28, 47, 56, // { | } ~
];
/** A letter outside the table (accents, other scripts): as wide as "M". */
const OTHER = 0.88;
/** Room for the browser's own rounding, so a word that just fits stays on one line. */
const MARGIN = 1.04;

/** One word's width in em, at most. */
export const wordEm = (word: string): number => {
  let em = 0;
  for (const letter of word) {
    const advance = ADVANCE[(letter.codePointAt(0) ?? 0) - FIRST];
    em += advance === undefined ? OTHER : advance / 100;
  }
  return em;
};

/**
 * The width in em the tile must hold on one line: the name's widest word
 * (a hyphenated word counted whole), with a little to spare.
 */
export const nameFitEm = (name: string): number => {
  const widest = Math.max(0, ...name.split(/\s+/).map(wordEm));
  // Never under 1, so the CSS never divides by nothing.
  return Math.max(1, Math.round(widest * MARGIN * 100) / 100);
};
