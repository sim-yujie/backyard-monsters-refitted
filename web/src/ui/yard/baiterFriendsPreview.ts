import type { BaiterTestsApi, BaiterTestsResponse, FriendTestRow } from "@/api/baiterTests";
import type { BaseLoadResponse } from "@/api/types";
import type { BaiterView } from "@/game/yard/yardIntent";
import { BaiterPanel } from "./BaiterPanel";

/**
 * The layout check's way to the Baiter window's friend tabs (web/e2e/layout,
 * beta 9 #4): the real window at its busiest, filled with a fixed list (17
 * people to invite, four open invites, three invites received, nine
 * results), with no server; every call is answered here and nothing runs.
 * Installed as `window.__baiterWindow(view)` and `window.__baiterFriendTest()`
 * in a dev build or one built with VITE_LAYOUT_CHECK=1, never in a release.
 */

const NOW = 1_800_000_000;
const NAMES = [
  "GooGobbler", "TwigTitan", "PuttyPunk", "SlimeQueen", "BoltBaron", "OctoMom", "FangFan", "CrabCakes",
  "ZafZaf", "Wormzilla", "PokeyPal", "DaveDriver", "BrainStorm", "TeraTina", "VorgLord", "IchiGo", "MoatMaker",
];

const person = (index: number) => ({
  userid: 900_100 + index,
  username: NAMES[index] ?? `Player${index}`,
  pic: null,
  level: 18 + ((index * 7) % 24),
});

const result = (index: number, tester: number, extra: Partial<FriendTestRow>): FriendTestRow => ({
  id: index + 1,
  tester: { userid: 900_100 + tester, name: NAMES[tester] ?? "", pic: null, level: 30 },
  foughtAt: NOW - (index + 1) * 1_700,
  damage: 20 + ((index * 17) % 80),
  result: "held",
  seconds: 300,
  rulesVersion: "preview",
  hasReport: true,
  hasReplay: true,
  playable: true,
  ...extra,
});

const BUSY: BaiterTestsResponse = {
  error: 0,
  now: NOW,
  baiterLevel: 5,
  cap: 2_100,
  inviteSeconds: 86_400,
  keepSeconds: 604_800,
  maxPerSend: 25,
  candidates: NAMES.map((_, index) => ({ ...person(index), friend: index < 12, alliance: index >= 9 })),
  invited: [2, 4, 14, 1].map((index, at) => ({ ...person(index), expiresAt: NOW + (21 - at * 6) * 3_600, tests: at * 2 })),
  invitedMe: [3, 13, 16].map((index, at) => ({ ...person(index), expiresAt: NOW + (23 - at * 9) * 3_600, cap: [4_800, 3_200, 2_100][at]! })),
  results: [
    result(0, 14, { result: "flattened", damage: 100, seconds: 161 }),
    result(1, 14, {}),
    result(2, 2, { result: "time" }),
    result(3, 14, {}),
    result(4, 2, { result: "flattened", damage: 100, seconds: 242 }),
    result(5, 14, { result: "stopped", seconds: 129 }),
    result(6, 2, { playable: false }),
    result(7, 14, {}),
    result(8, 4, { result: "time" }),
  ],
};

const api: BaiterTestsApi = {
  list: async () => BUSY,
  invite: async (userids) => ({ invited: userids.length, skipped: 0 }),
  cancel: async () => undefined,
  start: () => Promise.reject(new Error("preview")),
  finish: () => Promise.reject(new Error("preview")),
  replay: () => Promise.reject(new Error("preview")),
};

const SAVE = {
  baseid: "preview",
  buildingdata: {},
  academy: {},
  lockerdata: { C1: { t: 2 }, C2: { t: 2 }, C3: { t: 2 }, C4: { t: 2 } },
  monsters: { housed: { C1: 40, C4: 3 } },
} as unknown as BaseLoadResponse;

/** Opens the Baiter window on `view` over `modal`; returns its close. */
export const previewBaiterWindow = (modal: HTMLElement, view: BaiterView = "invite"): (() => void) => {
  const panel = new BaiterPanel({
    level: 5,
    save: () => SAVE,
    blocked: null,
    onRun: () => undefined,
    recent: [],
    friends: { onTest: () => undefined, onWatch: () => undefined, onReport: () => undefined, api, now: () => NOW },
    view,
  }).mount(modal);
  return () => panel.destroy();
};

/** Opens the army window for a friend's yard over `modal`; returns its close. */
export const previewFriendTest = (modal: HTMLElement): (() => void) => {
  const panel = new BaiterPanel({
    level: 1,
    save: () => SAVE,
    blocked: null,
    onRun: () => undefined,
    host: { inviter: 900_103, name: "SlimeQueen", cap: 4_800, expiresAt: NOW + 22 * 3_600, now: () => NOW, start: async () => "preview" },
  }).mount(modal);
  return () => panel.destroy();
};
