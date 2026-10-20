/**
 * Supporter names for the Thank-you page (/support/thanks/) and the short
 * preview on the Support page.
 *
 * HOW TO ADD A NAME: put it in quotes with a comma after it, one name per
 * line, inside the list for that supporter, e.g.
 *   export const labPartners: string[] = [
 *     "Alex",
 *     "Mo the Great",
 *   ];
 *
 * - Only list people who said yes to being shown publicly, using the name or
 *   nickname they asked for.
 * - Names only: never amounts, emails or dates.
 * - labPartners and labAssistants are the Patreon tiers. Refresh both lists
 *   in full each month from the Patreon member export, so people who left
 *   drop off.
 * - oneTime is for one-time gifts on Ko-fi.
 *
 * Empty lists stay hidden. While all three are empty, the Thank-you page asks
 * visitors to be the first supporter instead.
 */
export const labPartners: string[] = [
];

export const labAssistants: string[] = [
];

export const oneTime: string[] = [
];

/** The groups in the order they are shown, leaving out empty ones. */
export const supporterGroups = [
  { title: "Lab Partners", note: "Monthly supporters on Patreon, Lab Partner tier.", names: labPartners },
  { title: "Lab Assistants", note: "Monthly supporters on Patreon, Lab Assistant tier.", names: labAssistants },
  { title: "One-time supporters", note: "Gave a one-time gift on Ko-fi.", names: oneTime },
].filter((group) => group.names.length > 0);

/** Every listed name, Lab Partners first. */
export const allSupporters = supporterGroups.flatMap((group) => group.names);
