import { describe, expect, it, vi } from "vitest";
import type { YardStore, YardStoreAction, YardStoreReader } from "@/game/yard/YardStore";
import { housingSpace } from "@/game/monsters/monsterCatalogue";
import { transferActions, type InfernoTransferApi, type InfernoTransferReport } from "./infernoTransfer";

/** The transfer's request through the main yard's store (Inferno WP 2.6). */

/** A store whose `run` hands back the action, so its check and send can be driven. */
const capture = () => {
  let action: YardStoreAction<InfernoTransferReport> | null = null;
  const store = {
    run: (next: YardStoreAction<InfernoTransferReport>) => {
      action = next;
      return Promise.resolve({ ok: true, report: {}, completed: [] });
    },
  } as unknown as YardStore;
  return { store, action: () => action! };
};

/** A main yard with one level 1 Housing (200 places) and `housed`. */
const readerOf = (housed: Record<string, number>): YardStoreReader =>
  ({
    now: () => 1_000,
    save: {
      buildingdata: { "1": { id: 1, t: 15, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: {},
      storedata: {},
      academy: {},
      monsters: { housed },
    },
  }) as unknown as YardStoreReader;

describe("transferActions", () => {
  it("refuses locally what the Housing cannot take, and sends what it can", async () => {
    const api: InfernoTransferApi = { transfer: vi.fn() };
    const { store, action } = capture();
    await transferActions(store, api).transfer({ IC1: 1 });
    const spurtz = housingSpace("IC1", 1)!;
    const full = Math.floor(200 / spurtz);
    expect(action().check!(readerOf({}))).toBeNull();
    expect(action().check!(readerOf({ IC1: full }))).toMatchObject({ reason: "noRoom", local: true });

    await action().send({} as never);
    expect(api.transfer).toHaveBeenCalledWith({ IC1: 1 });
  });

  it("refuses an empty pick", async () => {
    const { store, action } = capture();
    await transferActions(store, { transfer: vi.fn() }).transfer({ IC1: 0 });
    expect(action().check!(readerOf({}))).toMatchObject({ reason: "badRequest" });
  });
});
