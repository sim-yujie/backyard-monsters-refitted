/**
 * One release's "What's new" cards (`ui/events/WhatsNewDialog.ts`). Each
 * release is one file in this folder; `index.ts` lists them newest first.
 */

export interface ChangelogCard {
  /** A picture under web/public, e.g. `/whats-new/beta4-events.png` (16:9 reads best). */
  readonly image: string;
  readonly title: string;
  /** One or two short sentences, in everyday words. */
  readonly text: string;
}

export interface ChangelogRelease {
  /** The release name the server records as seen, e.g. `2.0.0-beta.4`. */
  readonly version: string;
  /** What the dialog's heading says, e.g. "Beta 4". */
  readonly title: string;
  readonly cards: readonly ChangelogCard[];
}
