/**
 * The one purchase a save may carry, read as a voucher the audit can spend.
 *
 * `saveData.purchase` is a single `[itemKey, quantity]`
 * (`schemas/BaseSaveSchema.ts:30-35`) and a pending purchase forces an
 * immediate flush (`client/scripts/BASE.as:2609-2611`), so a save never carries
 * more than one. That is what makes it usable as a voucher: at most one level
 * jump, one countdown, one free building or one resource top-up in a save can
 * be explained by shiny, and everything else has to add up on its own
 * (`docs/design/economy-save-validation.md` §2.4).
 *
 * This file only reads the purchase. `purchaseHandler` is untouched: it still
 * records the item and debits the shiny
 * (`controllers/base/save/handlers/purchaseHandler.ts:19-52`), and the shiny
 * price itself is out of scope (§1.4).
 */

/** What a voucher excuses. */
export type VoucherKind =
  /** No purchase on this save. */
  | "none"
  /** `IB`: one new building finished with no countdown and no resource charge. */
  | "instantBuild"
  /** `IU`: one level step with no countdown and no resource charge. */
  | "instantUpgrade"
  /** `IF`: one fortification step. Unpriced until a fortify ladder exists. */
  | "instantFortify"
  /** `SP1`..`SP4`: one countdown shortened or finished. */
  | "speedUp"
  /** `BLK2`..`BLK5`: every wall to that level. */
  | "blockUpgrade"
  /** `BRTOPUP`: a positive delta equal to the shortfall of the step being started. */
  | "resourceTopup"
  /** `BUILDING<t>`: one new decoration of type `t`. */
  | "decoration"
  /** A purchase this audit knows nothing about. It excuses nothing. */
  | "other";

/** A purchase, read for what it excuses. */
export interface Voucher {
  /** The raw item key, or `""` when the save carried no purchase. */
  readonly key: string;
  /** The quantity the client sent. For `IB`/`IU` this is the shiny price it claims to have paid. */
  readonly quantity: number;
  readonly kind: VoucherKind;
  /**
   * The number the key carries: the wall level for `BLK<n>`, the building type
   * for `BUILDING<t>`, and `null` for every other kind.
   */
  readonly target: number | null;
  /**
   * Seconds this voucher can take off one countdown. `Infinity` finishes it
   * outright (`SP4`), 3600 for `SP2`, 7200 for `SP3`, 300 for `SP1` (the free
   * "close enough" finish), 0 for everything else
   * (`client/scripts/STORE.as:2043-2055`).
   */
  readonly speedup: number;
  /**
   * How many separate buildings this voucher can excuse. One for almost
   * everything; `Infinity` for `BLK<n>`, which takes every wall in the yard at
   * once (`client/scripts/STORE.as:1993-2026`).
   */
  readonly uses: number;
}

/** The voucher a save with no purchase carries: one that excuses nothing. */
export const NO_VOUCHER: Voucher = {
  key: "",
  quantity: 0,
  kind: "none",
  target: null,
  speedup: 0,
  uses: 0,
};

/** `SP1` finishes a job with five minutes or less left, for free (`STORE.as:1071-1073`). */
const SP1_SECONDS = 300;
/** `SP2` knocks an hour off (`STORE.as:2046-2055`). */
const SP2_SECONDS = 3600;
/** `SP3` knocks two hours off. */
const SP3_SECONDS = 7200;

/**
 * The speed-up keys, including the `xN` bundles the store sells
 * (`game-data/store/storeItems.ts`, `SP2x1` through `SP4x3`). The bundle sells
 * N uses of the same effect, so it excuses N countdowns rather than one.
 */
const SPEED_UP = /^SP([1-4])(?:x([1-3]))?$/;

/** `BLK2`..`BLK5`, and the Inferno `BLK2I`/`BLK3I` variants of the same item. */
const BLOCK_UPGRADE = /^BLK([2-5])I?$/;

/** `BUILDING<t>`: a decoration bought from the store and placed from inventory. */
const DECORATION = /^BUILDING(\d+)$/;

/**
 * The resource top-up. `BASE.Purchase("BRTOPUP", cost, ...)` is the literal key
 * the client sends when the player pays shiny to cover a shortfall
 * (`client/scripts/BUILDINGOPTIONSPOPUP.as:687`, `:730`); the `BR11`..`BR43`
 * store rows are the separate "buy resources" bundles and are not this.
 */
const RESOURCE_TOPUP = "BRTOPUP";

/** How many seconds an `SP<n>` key takes off one countdown. */
const speedUpSeconds = (step: number): number => {
  if (step === 1) return SP1_SECONDS;
  if (step === 2) return SP2_SECONDS;
  if (step === 3) return SP3_SECONDS;
  return Number.POSITIVE_INFINITY;
};

/**
 * Reads the save's `purchase` field.
 *
 * A malformed purchase is {@link NO_VOUCHER} rather than an error: the schema
 * has already parsed the JSON, and a purchase this audit cannot read simply
 * excuses nothing, which is the strict reading.
 */
export const readVoucher = (
  purchase: readonly [string, number] | readonly unknown[] | null | undefined
): Voucher => {
  if (!Array.isArray(purchase) || purchase.length === 0) return NO_VOUCHER;

  const key = typeof purchase[0] === "string" ? purchase[0] : "";
  if (key.length === 0) return NO_VOUCHER;

  const raw = Number(purchase[1]);
  const quantity = Number.isFinite(raw) ? raw : 0;
  const base = { key, quantity, target: null, speedup: 0, uses: 1 } as const;

  if (key === "IB") return { ...base, kind: "instantBuild" };
  if (key === "IU") return { ...base, kind: "instantUpgrade" };
  if (key === "IF") return { ...base, kind: "instantFortify" };
  if (key === RESOURCE_TOPUP) return { ...base, kind: "resourceTopup" };

  const speedUp = SPEED_UP.exec(key);
  if (speedUp) {
    return {
      ...base,
      kind: "speedUp",
      speedup: speedUpSeconds(Number(speedUp[1])),
      uses: speedUp[2] ? Number(speedUp[2]) : 1,
    };
  }

  const block = BLOCK_UPGRADE.exec(key);
  if (block) {
    return {
      ...base,
      kind: "blockUpgrade",
      target: Number(block[1]),
      uses: Number.POSITIVE_INFINITY,
    };
  }

  const decoration = DECORATION.exec(key);
  if (decoration) {
    return { ...base, kind: "decoration", target: Number(decoration[1]) };
  }

  return { ...base, kind: "other" };
};

/**
 * Whether a voucher's quantity covers the price the server derived for what it
 * is being asked to excuse.
 *
 * The quantity is the shiny the client says it paid
 * (`client/scripts/BFOUNDATION.as:2134`), so a quantity below the derived price
 * is a client that under-reported the purchase: rule `voucherShort`.
 */
export const voucherCovers = (voucher: Voucher, needed: number): boolean =>
  voucher.quantity >= needed;
