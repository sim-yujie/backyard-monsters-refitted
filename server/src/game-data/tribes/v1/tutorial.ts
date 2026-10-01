import type { SaveData } from "../../../types/EntityData.js";

// Baseid 1 (L_IDS): Flash's tutorial camp id, now the guided start's private
// practice camp (`docs/design/tutorial.md` §5.1, issue #227). Served only to
// the one player whose `onboarding.camp` is open (`practiceCamp.ts`), and
// removed when they win or skip.
//
// Tuned so 15 level 1 Pokeys flung anywhere in the drop box (X 300 to 420,
// Y -60 to 60, east of the tower) always win: one level 1 Sniper Tower, the
// loot buildings, and eight level 1 walls behind the Town Hall on the far
// side, seen but never in the way. No monsters. `practiceCamp.test.ts`
// replays the real engine over every box point and seed to prove it; if it
// fails after a combat change, retune the camp, not the test.
//
// Loot (3,000 / 3,000 / 1,000 / 1,000) is a placeholder (Q17).
export const tutorial: SaveData = {
  baseid: "1",
  type: "tribe",
  userid: 0,
  wmid: 1,
  createtime: 0,
  savetime: 0,
  seed: 0,
  saveuserid: 0,
  bookmarked: 0,
  fan: 0,
  emailshared: 1,
  unreadmessages: 0,
  giftsentcount: 0,
  id: 0,
  canattack: false,
  cellid: 0,
  baseid_inferno: 0,
  fbid: "",
  fortifycellid: 0,
  name: "Practice camp",
  level: 1,
  catapult: 0,
  flinger: 0,
  destroyed: 0,
  damage: 0,
  locked: 0,
  protected: 1,
  lastupdate: 0,
  usemap: 0,
  credits: 0,
  champion: [],
  empiredestroyed: 1,
  worldid: "0",
  event_score: 0,
  resources: {
    r1: 3000,
    r2: 3000,
    r3: 1000,
    r4: 1000,
    r1max: 10000,
    r2max: 10000,
    r3max: 10000,
    r4max: 10000,
  },
  monsters: {},
  storedata: {},
  buildingdata: {
    "0": { X: -65, Y: -65, t: 14, id: 0 },
    "1": { X: 110, Y: -35, t: 21, id: 1 },
    "2": { X: -35, Y: 95, t: 1, id: 2 },
    "3": { X: -35, Y: -165, t: 2, id: 3 },
    "4": { X: -195, Y: -40, t: 6, id: 4 },
    "5": { X: -105, Y: -80, t: 17, id: 5 },
    "6": { X: -105, Y: -60, t: 17, id: 6 },
    "7": { X: -105, Y: -40, t: 17, id: 7 },
    "8": { X: -105, Y: -20, t: 17, id: 8 },
    "9": { X: -105, Y: 0, t: 17, id: 9 },
    "10": { X: -105, Y: 20, t: 17, id: 10 },
    "11": { X: -105, Y: 40, t: 17, id: 11 },
    "12": { X: -105, Y: 60, t: 17, id: 12 },
  },
};
