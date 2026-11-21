/**
 * DESIGN PROTOTYPE ONLY (b9, never merged): Baiter for friends, fake data.
 *
 * `b9baiter=a` Baiter HQ: the Baiter window gets Invite / Invites / Results tabs.
 * `b9baiter=b` Friends desk: the Friends screen gets a Tests tab
 *              (Invite | Invited me | Results), and a friend's actions "Test my yard".
 *
 * Names are invented; faces are the default critters (no photos).
 */
import { gameIcon } from "@/ui/gameIcon";
import { make, playerRow } from "@/ui/friends/rows";
import "./b9-baiter.css";

interface Person {
  readonly userid: number;
  readonly username: string;
  readonly level: number;
  readonly friend: boolean;
  readonly alliance: boolean;
  readonly online: boolean;
}

const NAMES = [
  "GooGobbler", "TwigTitan", "PuttyPunk", "SlimeQueen", "BoltBaron", "OctoMom", "FangFan", "CrabCakes",
  "ZafZaf", "Wormzilla", "PokeyPal", "DaveDriver", "BrainStorm", "TeraTina", "VorgLord", "IchiGo",
  "EyeRaRa", "BanditoBob", "SiloSam", "SnapperJo", "PebbleKing", "GooGuru", "MoatMaker", "TowerTom",
  "WallWendy", "CannonCal", "SpikeSue", "LockerLou", "HatchHank", "FlingFred", "ShinyShay", "MapMona",
];

export const B9_PEOPLE: readonly Person[] = NAMES.map((username, index) => ({
  userid: 900_100 + index,
  username,
  level: 18 + ((index * 7) % 24),
  friend: index < 22,
  alliance: index >= 14,
  online: index % 5 === 1,
}));

const SELECTED = new Set([900_101, 900_103, 900_116]);

const INVITED: readonly { name: string; left: string; tests: number }[] = [
  { name: "PuttyPunk", left: "21h", tests: 3 },
  { name: "BoltBaron", left: "9h", tests: 0 },
  { name: "VorgLord", left: "2h", tests: 5 },
];

const INVITED_ME: readonly { name: string; userid: number; cap: string; left: string }[] = [
  { name: "SlimeQueen", userid: 900_103, cap: "1,500", left: "23h" },
  { name: "TeraTina", userid: 900_113, cap: "2,250", left: "14h" },
  { name: "MoatMaker", userid: 900_122, cap: "750", left: "40m" },
];

type Result = "held" | "flattened" | "time";

const RESULTS: readonly { name: string; userid: number; ago: string; result: Result; damage: number; time: string; isNew?: boolean }[] = [
  { name: "VorgLord", userid: 900_114, ago: "5m", result: "flattened", damage: 100, time: "2:41", isNew: true },
  { name: "VorgLord", userid: 900_114, ago: "12m", result: "held", damage: 48, time: "5:00", isNew: true },
  { name: "PuttyPunk", userid: 900_102, ago: "1h", result: "held", damage: 31, time: "5:00" },
  { name: "VorgLord", userid: 900_114, ago: "1h", result: "time", damage: 72, time: "5:00" },
  { name: "PuttyPunk", userid: 900_102, ago: "3h", result: "flattened", damage: 100, time: "4:02" },
  { name: "VorgLord", userid: 900_114, ago: "3h", result: "held", damage: 22, time: "3:15" },
  { name: "PuttyPunk", userid: 900_102, ago: "5h", result: "held", damage: 40, time: "5:00" },
  { name: "VorgLord", userid: 900_114, ago: "6h", result: "held", damage: 18, time: "2:09" },
  { name: "VorgLord", userid: 900_114, ago: "8h", result: "time", damage: 66, time: "5:00" },
];

const RESULT_WORDS: Record<Result, string> = { held: "Held", flattened: "Flattened", time: "Time ran out" };

const btn = (label: string, kind: string, className = ""): HTMLButtonElement => {
  const node = make("button", `btn btn--${kind} ${className}`.trim(), label);
  node.type = "button";
  return node;
};

const iconBtn = (icon: Parameters<typeof gameIcon>[0], label: string, kind: string, className = ""): HTMLButtonElement => {
  const node = btn("", kind, `b9b-iconbtn ${className}`);
  node.append(gameIcon(icon, { size: 24, decorative: true }), make("span", "", label));
  return node;
};

const chips = (labels: readonly string[], on = 0): HTMLElement => {
  const row = make("div", "b9b-chips");
  row.setAttribute("role", "tablist");
  labels.forEach((label, index) => {
    const chip = btn(label, index === on ? "primary" : "outline", "b9b-chip");
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(index === on));
    row.append(chip);
  });
  return row;
};

const search = (placeholder: string): HTMLElement => {
  const box = make("label", "b9b-search");
  box.append(gameIcon("find", { size: 24, decorative: true }));
  const input = make("input", "b9b-search__input");
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  box.append(input);
  return box;
};

const person = (userid: number, username: string, level = 30) => ({ userid, username, pic: null, level });

/** Send invites: who to pick (friends and alliance once each), who is invited, Send. */
export const invitePane = (): HTMLElement => {
  const pane = make("div", "b9b-pane b9b-invite");
  const pick = make("section", "b9b-col b9b-col--pick");
  const friends = B9_PEOPLE.filter((one) => one.friend).length;
  const mates = B9_PEOPLE.filter((one) => one.alliance).length;
  pick.append(chips([`All ${B9_PEOPLE.length}`, `Friends ${friends}`, `Alliance ${mates}`]), search("Find a name"));
  const list = make("ul", "b9b-list friends-list");
  for (const one of B9_PEOPLE) {
    const invited = INVITED.some((row) => row.name === one.username);
    const tick = make("button", `b9b-tick${SELECTED.has(one.userid) ? " b9b-tick--on" : ""}`, SELECTED.has(one.userid) ? "✓" : "");
    tick.type = "button";
    tick.setAttribute("role", "checkbox");
    tick.setAttribute("aria-checked", String(SELECTED.has(one.userid)));
    tick.setAttribute("aria-label", `Invite ${one.username}`);
    const marks: HTMLElement[] = [];
    if (one.alliance) marks.push(gameIcon("alliance", { size: 16, label: "Alliance mate" }) as unknown as HTMLElement);
    const row = playerRow(person(one.userid, one.username, one.level), {
      online: one.online,
      marks,
      ...(invited ? { note: "Invited" } : {}),
      actions: invited ? [] : [tick],
    });
    if (SELECTED.has(one.userid)) row.classList.add("b9b-row--on");
    list.append(row);
  }
  pick.append(list);

  const side = make("section", "b9b-col b9b-col--active");
  const head = make("h3", "b9b-head");
  head.append(gameIcon("time", { size: 24, decorative: true }), `Invited (${INVITED.length})`);
  const active = make("ul", "b9b-list");
  for (const row of INVITED) {
    const cancel = btn("✕", "ghost", "b9b-cancel");
    cancel.setAttribute("aria-label", `Cancel ${row.name}'s invite`);
    active.append(
      playerRow(person(900_100 + NAMES.indexOf(row.name), row.name), {
        note: `${row.left} left · ${row.tests} tests`,
        actions: [cancel],
      }),
    );
  }
  side.append(head, active);

  const foot = make("footer", "b9b-foot");
  foot.append(
    make("span", "b9b-foot__note", `${SELECTED.size} picked · 24 h, any number of tests`),
    iconBtn("mail", `Send ${SELECTED.size}`, "primary", "b9b-send"),
  );
  pane.append(pick, side, foot);
  return pane;
};

/** The friend's side: who invited me, with Test. */
export const invitedMePane = (onTest?: (name: string, cap: string, left: string) => void): HTMLElement => {
  const pane = make("div", "b9b-pane b9b-received");
  pane.append(make("p", "b9b-note", "Test their main yard with a free made-up army. Nothing is lost."));
  const list = make("ul", "b9b-list");
  for (const row of INVITED_ME) {
    const test = iconBtn("swords", "Test", "primary", "b9b-test");
    test.addEventListener("click", () => onTest?.(row.name, row.cap, row.left));
    const cap = make("span", "b9b-cap");
    cap.append(gameIcon("housing", { size: 16, label: "Army cap" }), row.cap);
    const left = make("span", "b9b-left");
    left.append(gameIcon("time", { size: 16, label: "Time left" }), row.left);
    list.append(playerRow(person(row.userid, row.name), { marks: [cap, left], actions: [test] }));
  }
  pane.append(list);
  return pane;
};

/** The owner's side: every test of my yard, newest first. */
export const resultsPane = (): HTMLElement => {
  const pane = make("div", "b9b-pane b9b-results");
  const people = [...new Set(RESULTS.map((one) => one.name))];
  pane.append(chips([`All ${RESULTS.length}`, ...people.map((name) => `${name} ${RESULTS.filter((one) => one.name === name).length}`)]));
  const list = make("ul", "b9b-list");
  for (const row of RESULTS) {
    const result = make("span", `b9b-result b9b-result--${row.result}`, RESULT_WORDS[row.result]);
    const damage = make("span", "b9b-damage");
    damage.append(gameIcon("yarddamage", { size: 16, label: "Damage" }), `${row.damage}%`);
    const watch = iconBtn("camera", "Watch", "outline", "b9b-watch");
    const report = iconBtn("report", "Report", "ghost", "b9b-report");
    report.title = "The battle report";
    const item = playerRow(person(row.userid, row.name), {
      note: `${row.ago} ago · ${row.time}`,
      marks: [result, damage],
      actions: [watch, report],
    });
    if (row.isNew) item.classList.add("b9b-row--new");
    list.append(item);
  }
  pane.append(list, make("p", "b9b-note", "Kept 7 days. Real attacks stay in Defences."));
  return pane;
};

/** A row of segment buttons that swaps panes, for the Friends desk's Tests tab. */
export const testsTab = (open: "invite" | "invited" | "results"): HTMLElement => {
  const box = make("div", "b9b-tests");
  const panes = { invite: invitePane(), invited: invitedMePane(), results: resultsPane() };
  const labels: [keyof typeof panes, string][] = [
    ["invite", "Invite"],
    ["invited", `Invited me ${INVITED_ME.length}`],
    ["results", `Results ${RESULTS.length}`],
  ];
  const seg = make("div", "b9b-seg");
  const show = (id: keyof typeof panes): void => {
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== id;
    seg.querySelectorAll("button").forEach((one) => {
      const on = one.dataset["id"] === id;
      one.classList.toggle("btn--primary", on);
      one.classList.toggle("btn--outline", !on);
      one.setAttribute("aria-pressed", String(on));
    });
  };
  for (const [id, label] of labels) {
    const b = btn(label, "outline", "b9b-seg__tab");
    b.dataset["id"] = id;
    b.addEventListener("click", () => show(id));
    seg.append(b);
  }
  box.append(seg, ...Object.values(panes));
  show(open);
  return box;
};

export const B9_COUNTS = { invitedMe: INVITED_ME.length, results: RESULTS.length, fresh: 2 };
