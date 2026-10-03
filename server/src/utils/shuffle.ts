/**
 * A shuffled copy of a list (Fisher-Yates); the list itself is left alone.
 *
 * @param {T[]} items - The items to shuffle
 * @param {() => number} random - A source of numbers in [0, 1); `Math.random` by default
 * @returns {T[]} The same items in a random order
 */
export const shuffle = <T>(items: readonly T[], random: () => number = Math.random): T[] => {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
