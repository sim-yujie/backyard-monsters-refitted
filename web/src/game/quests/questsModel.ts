import type { EventReward, GrantedReward } from "@/api/events";
import type { QuestsView, QuestView } from "@/api/quests";
import { monsterName } from "@/game/combat/rules/report";
import { shortAmount } from "@/game/events/eventsModel";
import { monsterPortrait, type Portrait } from "@/game/portraits";
import { buttonUrl } from "@/game/yard/buildButtonArt";
import { typeName } from "@/game/yard/planner/summary";

/**
 * The quest window's words and pictures (beta 6, owner decisions 8-13): what
 * each quest kind says, naming the monster, tribe, building or resource it
 * is about, and the painted picture that goes with it (owner: icons over
 * words, painted, never plain line icons). Pure: the panel and its tests
 * read it.
 */

/** Flash's painted pop-up art, served by the game server (proxied in development). */
const POPUP = "/assets/popups/";

/** The four Wild Monster tribes, by the id a quest names them with. */
export const TRIBE_NAMES: Readonly<Record<string, string>> = {
  legionnaire: "Legionnaire",
  kozu: "Kozu",
  abunakki: "Abunakki",
  dreadnaut: "Dreadnaut",
};

const RESOURCE_WORDS = { r1: "Twigs", r2: "Pebbles", r3: "Putty", r4: "Goo" } as const;

/** The weekly loot quests, by kind: the resource each one names. */
const LOOT_KINDS: Readonly<Record<string, keyof typeof RESOURCE_WORDS>> = {
  weeklyLootTwigs: "r1",
  weeklyLootPebbles: "r2",
  weeklyLootPutty: "r3",
  weeklyLootGoo: "r4",
};

/** "Pokey" → "Pokeys"; a name already ending in s, or in a dot or a capital X, is left alone. */
export const plural = (name: string, count: number): string =>
  count === 1 || /(s|\.|X)$/.test(name) ? name : `${name}s`;

/** "a Kozu yard" / "3 Kozu yards". */
const counted = (count: number, one: string, many = `${one}s`): string =>
  count === 1 ? `a ${one}` : `${shortAmount(count)} ${many}`;

/** "" / " 3 times". */
const times = (count: number): string => (count === 1 ? "" : ` ${shortAmount(count)} times`);

/** The building type a quest names (`catapultHit`), or null. */
const buildingType = (quest: Pick<QuestView, "variant">): number | null => {
  const type = Number(quest.variant);
  return Number.isInteger(type) && type > 0 ? type : null;
};

/** What the quest asks, in a few words: "Hatch 3 Pokeys", "Destroy 2 Kozu yards". */
export const questTitle = (quest: Pick<QuestView, "kind" | "variant" | "need">): string => {
  const { need } = quest;
  switch (quest.kind) {
    case "hatchMonster": {
      const name = quest.variant ? monsterName(quest.variant) : "monster";
      return `Hatch ${need} ${plural(name, need)}`;
    }
    case "attackPlayer":
      return need === 1 ? "Attack a player" : `Attack players${times(need)}`;
    case "destroyTribe": {
      const tribe = TRIBE_NAMES[quest.variant ?? ""] ?? "tribe";
      return `Destroy ${counted(need, `${tribe} yard`)}`;
    }
    case "catapultHit": {
      const type = buildingType(quest);
      const name = type === null ? "building" : typeName(type);
      return `Catapult ${need === 1 ? "a" : need} ${plural(name, need)}`;
    }
    case "upgradeResource":
      return `Upgrade ${counted(need, "resource building")}`;
    case "upgradeDefence":
      return `Upgrade ${counted(need, "defence")}`;
    case "mushroom":
      return `Pick ${counted(need, "mushroom")}`;
    case "friendHelp":
      return need === 1 ? "Help a friend's yard" : `Help friends' yards${times(need)}`;
    case "friendGift":
      return need === 1 ? "Send a friend a gift" : `Send friends ${need} gifts`;
    case "feedChampion":
      return need === 1 ? "Feed your champion" : `Feed your champion${times(need)}`;
    case "juice":
      return `Juice ${counted(need, "monster")}`;
    case "weeklyHelpGift":
      return `Help or gift friends${times(need)}`;
    case "weeklyNewFriends":
      return `Make ${counted(need, "new friend")}`;
    case "weeklyFights":
      return `Win ${counted(need, "fight")}`;
    default: {
      const resource = LOOT_KINDS[quest.kind];
      if (resource) return `Loot ${shortAmount(need)} ${RESOURCE_WORDS[resource]}`;
      return "Quest";
    }
  }
};

/** A line under the title where the title alone could leave a doubt; null when it is clear. */
export const questHint = (quest: Pick<QuestView, "kind">): string | null => {
  switch (quest.kind) {
    case "attackPlayer":
      return "Launching counts, win or lose";
    case "catapultHit":
      return "Hits in your attacks";
    case "weeklyFights":
      return "Attacks won or defences held";
    case "weeklyHelpGift":
      return "Any mix of help and gifts";
    case "weeklyNewFriends":
      return "Level 5+, played this week";
    default:
      return LOOT_KINDS[quest.kind] ? "In attacks, tribes too" : null;
  }
};

/** The resource a weekly loot quest names, or null. */
export const lootResource = (kind: string): keyof typeof RESOURCE_WORDS | null => LOOT_KINDS[kind] ?? null;

/** The quest's painted picture: the monster, tribe or building it names, or Flash's own art. */
export const questPicture = (quest: Pick<QuestView, "kind" | "variant">): Portrait => {
  const art = (file: string): Portrait => ({ src: `${POPUP}${file}`, fallback: null });
  switch (quest.kind) {
    case "hatchMonster":
      return quest.variant ? monsterPortrait(quest.variant, "icon") : art("building-hatchery.png");
    case "attackPlayer":
      return art("firstblood.v2.png");
    case "destroyTribe":
      return TRIBE_NAMES[quest.variant ?? ""]
        ? { src: `${POPUP}tribe_${quest.variant}.v2.png`, fallback: `${POPUP}tribe_${quest.variant}.png` }
        : art("military.png");
    case "catapultHit": {
      const type = buildingType(quest);
      return type === null ? art("building-catapult.png") : { src: buttonUrl(type), fallback: `${POPUP}building-catapult.png` };
    }
    case "upgradeResource":
      return { src: buttonUrl(1), fallback: `${POPUP}gatherer.v2.png` };
    case "upgradeDefence":
      return { src: buttonUrl(20), fallback: `${POPUP}levelup.v2.png` };
    case "mushroom":
      return art("goldmushroom.png");
    case "friendHelp":
    case "weeklyHelpGift":
      return art("helpinghand.png");
    case "friendGift":
      return art("monsterparty.png");
    case "weeklyNewFriends":
      return art("friendlymonster.png");
    case "feedChampion":
      return art("burger.png");
    case "juice":
      return art("monsterjuice.v2.png");
    case "weeklyFights":
      return art("military.png");
    default:
      return art(LOOT_KINDS[quest.kind] ? "loot.png" : "completequest.png");
  }
};

/** The all-done bonus's picture. */
export const BONUS_PICTURE: Portrait = { src: `${POPUP}completequest.png`, fallback: null };

/** Progress as figures: "1/3", "450K/1.2M"; a finished quest shows its need twice. */
export const progressText = (quest: Pick<QuestView, "have" | "need">): string =>
  `${shortAmount(Math.min(quest.have, quest.need))}/${shortAmount(quest.need)}`;

/** Progress as a share, 0 to 1. */
export const progressShare = (quest: Pick<QuestView, "have" | "need">): number =>
  quest.need > 0 ? Math.min(1, Math.max(0, quest.have / quest.need)) : 1;

/** Whether the free swap can go on this quest: unfinished, unclaimed, and a swap is left. */
export const canSwap = (quest: Pick<QuestView, "claimed" | "have" | "need">, swapsLeft: number): boolean =>
  swapsLeft > 0 && !quest.claimed && quest.have < quest.need;

/** One login card day. */
export interface LoginDay {
  readonly day: number;
  readonly shiny: number;
  /** `today` = claimable now; `next` = the one tomorrow brings, today's being claimed. */
  readonly state: "claimed" | "today" | "next" | "later";
}

/** The 7 days of the card as the window draws them. */
export const loginDays = (login: QuestsView["login"]): LoginDay[] =>
  login.shiny.map((shiny, index) => {
    const day = index + 1;
    let state: LoginDay["state"] = "later";
    if (day <= login.onCard) state = "claimed";
    else if (!login.claimedToday && day === login.day) state = "today";
    else if (login.claimedToday && day === login.onCard + 1) state = "next";
    return { day, shiny, state };
  });

/** What a claim paid, as rewards to show: resources as they landed after the storage cap. */
export const grantedRewards = (granted: readonly GrantedReward[]): EventReward[] =>
  granted.flatMap((reward): EventReward[] => {
    switch (reward.kind) {
      case "resources":
        return Object.values(reward.credited).some((amount) => (amount ?? 0) > 0)
          ? [{ kind: "resources", amounts: reward.credited }]
          : [];
      case "shiny":
        return [{ kind: "shiny", amount: reward.amount }];
      case "speedup":
        return [{ kind: "speedup", item: reward.item, count: reward.count }];
      case "shopItem":
        return [{ kind: "shopItem", item: reward.item }];
      case "decoration":
        return [{ kind: "decoration", type: reward.type, count: reward.count }];
      case "krallen":
        return [{ kind: "krallen" }];
    }
  });

/** Ready to claim in one tab: the Today tab counts the login day too. */
export const tabClaimable = (view: QuestsView, tab: "today" | "weekly"): number => {
  const set = tab === "today" ? view.daily : view.weekly;
  const quests = set.quests.filter((quest) => quest.ready).length;
  const login = tab === "today" && !view.login.claimedToday ? 1 : 0;
  return quests + (set.bonus.ready ? 1 : 0) + login;
};

/** The UTC day of a unix second, "2026-11-02": the login pop-up shows once per day. */
export const utcDayOf = (now: number): string => new Date(now * 1000).toISOString().slice(0, 10);
