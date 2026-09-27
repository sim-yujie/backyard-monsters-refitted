/**
 * The attack damage percentage as `save.damage` holds it: a whole number, cut
 * down, never rounded up (issue #72).
 *
 * The column is an integer (`damage integer` in Postgres), while the web client
 * sends the percentage to two decimals and the abandoned-attack replay works it
 * out to two decimals too. Written as is, Postgres rounds the fraction to the
 * nearest whole number on the way in: 99.95 is stored as 100, and 89.5 as 90,
 * which the stored-damage checks read as a win the attack never earned
 * (`takeoverCell.ts` lets a cell at `damage >= 90` be taken over; the map
 * shows it as destroyed). The Flash client never sent a fraction: its
 * `BASE._percentDamaged` is an `int`, and assigning the Number
 * `100 - 100 / max * hp` to it truncates (`client/scripts/BFOUNDATION.as:468`,
 * `BASE.as:243`, sent as `saveData.damage` at `BASE.as:3312`).
 *
 * So the server truncates before it stores, and every check made in the same
 * request (the takeover's `>= 90`) sees the number that is stored. A value
 * that is not a finite number is refused as null, and the caller keeps what
 * the save held.
 */
export const storedDamage = (value: unknown): number | null => {
  const damage = typeof value === "string" ? Number(value) : value;
  if (typeof damage !== "number" || !Number.isFinite(damage)) return null;
  return Math.min(100, Math.max(0, Math.trunc(damage)));
};
