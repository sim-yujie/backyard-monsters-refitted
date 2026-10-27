import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Looking at another player's Inferno yard from the Inferno map (WP 3.4,
 * `docs/design/inferno.md` §2.7): Flash's read-only `iview`, masked as any
 * look at someone else's yard is, and refused for anything but another real
 * player's live Inferno yard, and while it is being attacked.
 */

const VIEWER = 3601;
const OWNER = 4601;
const YARD_BASEID = "7100";
const BOOBY_TRAP = 24;

let yard: Record<string, any>;
let ownerMain: Record<string, any>;

const em = {
  findOne: async (entity: { name: string }, where: Record<string, any>) => {
    if (entity.name === "User") return { userid: where.userid, username: "keeper" };
    if (entity.name === "Bot") return null;
    if (where.type === "main") return where.userid === OWNER ? ownerMain : null;
    return String(where.baseid) === YARD_BASEID ? yard : null;
  },
  getContext: () => ({ global: true, findOne: em.findOne }),
};

mock.module("../../server.js", () => ({ postgres: { em }, redis: {} }));

const { viewInfernoYard } = await import("./infernoView.js");
const { BaseType } = await import("../../enums/Base.js");
const { Save } = await import("../../database/models/save.model.js");
const { infernoStartBuildingData } = await import("../../services/inferno/infernoYard.js");

const viewer = () => ({ userid: VIEWER, username: "looker", save: { userid: VIEWER } }) as never;
const now = () => Math.floor(Date.now() / 1000);

const refusalOf = async (baseid = YARD_BASEID): Promise<unknown> => {
  try {
    await viewInfernoYard(em as never, viewer(), baseid, now());
    return "none";
  } catch (err) {
    return (err as { data?: { reason?: string } }).data?.reason ?? String(err);
  }
};

beforeEach(() => {
  // A real row: only a Save's front-end keys go on the wire.
  yard = Object.assign(new Save(), {
    baseid: YARD_BASEID,
    basesaveid: 71,
    type: BaseType.INFERNO,
    userid: OWNER,
    saveuserid: OWNER,
    attackid: 0,
    attacks: [],
    points: "0",
    basevalue: "0",
    buildingdata: {
      ...infernoStartBuildingData(),
      "60": { t: BOOBY_TRAP, id: 60, l: 1, X: 100, Y: 100 },
    },
    buildinghealthdata: {},
    monsters: { housed: { IC1: 4 } },
    credits: 500,
  });
  ownerMain = { userid: OWNER, type: "main", baseid_inferno: YARD_BASEID };
});

describe("another player's Inferno yard, looked at", () => {
  test("comes masked: no trap, no Shiny, the yard's level and owner", async () => {
    const body = await viewInfernoYard(em as never, viewer(), YARD_BASEID, now());
    const types = Object.values(body.buildingdata as Record<string, { t: number }>).map((one) => one.t);
    expect(types).not.toContain(BOOBY_TRAP);
    expect(body.credits).toBe(0);
    expect(body.type).toBe(BaseType.INFERNO);
    expect(body.ownername).toBe("keeper");
    expect(body.level).toBeGreaterThanOrEqual(1);
  });

  test("not another player's live Inferno yard: refused", async () => {
    expect(await refusalOf("999")).toBe("notInfernoPlayer");
    yard.userid = VIEWER;
    expect(await refusalOf()).toBe("notInfernoPlayer");
    yard.userid = OWNER;
    ownerMain.baseid_inferno = "1"; // an old yard its owner no longer plays
    expect(await refusalOf()).toBe("notInfernoPlayer");
  });

  test("being attacked: refused, as Flash greyed View out", async () => {
    yard.attackid = 55;
    yard.attacks = [{ name: "raider", starttime: now() }];
    expect(await refusalOf()).toBe("targetUnderAttack");
  });
});
