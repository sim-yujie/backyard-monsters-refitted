import { describe, expect, test } from "bun:test";
import { NO_VOUCHER, readVoucher, voucherCovers } from "./voucher.js";

/**
 * The voucher table of `docs/design/economy-save-validation.md` §2.4, key by
 * key. A key this audit does not recognise has to excuse nothing at all: the
 * whole model rests on a save carrying at most one purchase and that purchase
 * buying exactly one named thing.
 */

describe("readVoucher", () => {
  test("an absent purchase excuses nothing", () => {
    expect(readVoucher(undefined)).toEqual(NO_VOUCHER);
    expect(readVoucher(null)).toEqual(NO_VOUCHER);
    expect(readVoucher([])).toEqual(NO_VOUCHER);
  });

  test("IB is an instant build", () => {
    const voucher = readVoucher(["IB", 17]);

    expect(voucher.kind).toBe("instantBuild");
    expect(voucher.quantity).toBe(17);
    expect(voucher.uses).toBe(1);
    expect(voucher.speedup).toBe(0);
  });

  test("IU is an instant upgrade", () => {
    expect(readVoucher(["IU", 35]).kind).toBe("instantUpgrade");
  });

  test("IF is an instant fortify", () => {
    expect(readVoucher(["IF", 4]).kind).toBe("instantFortify");
  });

  test("SP1 finishes a job of five minutes or less", () => {
    const voucher = readVoucher(["SP1", 1]);

    expect(voucher.kind).toBe("speedUp");
    expect(voucher.speedup).toBe(300);
  });

  test("SP2 and SP3 knock an hour and two hours off", () => {
    expect(readVoucher(["SP2", 20]).speedup).toBe(3600);
    expect(readVoucher(["SP3", 40]).speedup).toBe(7200);
  });

  test("SP4 finishes a countdown of any length", () => {
    expect(readVoucher(["SP4", 277]).speedup).toBe(Number.POSITIVE_INFINITY);
  });

  test("an SP bundle excuses one countdown per unit it sells", () => {
    expect(readVoucher(["SP3x2", 80]).uses).toBe(2);
    expect(readVoucher(["SP4x3", 1]).speedup).toBe(Number.POSITIVE_INFINITY);
    expect(readVoucher(["SP4x3", 1]).uses).toBe(3);
  });

  test("BLK carries the wall level it takes every block to", () => {
    const voucher = readVoucher(["BLK4", 1]);

    expect(voucher.kind).toBe("blockUpgrade");
    expect(voucher.target).toBe(4);
    expect(voucher.uses).toBe(Number.POSITIVE_INFINITY);
  });

  test("BRTOPUP is the shortfall top-up", () => {
    const voucher = readVoucher(["BRTOPUP", 25]);

    expect(voucher.kind).toBe("resourceTopup");
    expect(voucher.quantity).toBe(25);
  });

  test("BUILDING<t> carries the decoration type it bought", () => {
    const voucher = readVoucher(["BUILDING57", 1]);

    expect(voucher.kind).toBe("decoration");
    expect(voucher.target).toBe(57);
  });

  test("every other key excuses nothing", () => {
    for (const key of ["POD", "FIX", "PRO1", "BEW", "BR13", "MUSK", "nonsense"]) {
      expect(readVoucher([key, 1]).kind).toBe("other");
      expect(readVoucher([key, 1]).speedup).toBe(0);
    }
  });

  test("a purchase this audit cannot read excuses nothing", () => {
    expect(readVoucher([42, 1] as unknown as readonly unknown[])).toEqual(NO_VOUCHER);
    expect(readVoucher(["IB", "many"]).quantity).toBe(0);
  });
});

describe("voucherCovers", () => {
  test("a quantity at or above the derived price covers it", () => {
    expect(voucherCovers(readVoucher(["IU", 35]), 35)).toBe(true);
    expect(voucherCovers(readVoucher(["IU", 36]), 35)).toBe(true);
  });

  test("a quantity below the derived price does not", () => {
    expect(voucherCovers(readVoucher(["IU", 34]), 35)).toBe(false);
  });

  test("a free voucher covers a free price", () => {
    expect(voucherCovers(readVoucher(["SP1", 0]), 0)).toBe(true);
  });
});
