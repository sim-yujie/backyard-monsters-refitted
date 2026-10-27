import type { GoalDef } from "./goals.js";

// The line numbers below are each quest's `"id"` line in `INFERNO_QUESTS.as`.

/**
 * The Inferno's quests (`docs/design/inferno.md` §2.8, WP 4.1): Flash's 38
 * (`client/scripts/INFERNO_QUESTS.as`), the list `QUESTS._quests` answers
 * while the player is in the Inferno yard (`QUESTS.as:1679-1681`). Read out
 * of the Flash file by a script: `order`, `reward` (Bone, Coal, Sulfur,
 * Magma; Flash's fifth slot, Shiny, is 0 on all 38), `monster_reward` /
 * `reward_creatureid`, and the rule, mapped to a {@link GoalDef} condition:
 * `b<type>lvl` a building, `UNLOCK` a monster unlocked in the Strongbox,
 * `singleclickbank` the most one bank paid on the Inferno yard. Names and
 * descriptions are Flash's `q_*` strings with the Inferno's names
 * (`server/public/gamestage/assets/english.json`), "Build a Incubator" said
 * "Build an Incubator".
 *
 * Kept as Flash had it (§2.8): **no prereq gating.** Flash's Quests window
 * lists every quest not yet claimed (`QUESTSPOPUP.as:174-183`), so `prereq`
 * is not carried (three name quests that do not exist: IS1, IUC9, IUC13).
 * Each entry's comment says what Flash had.
 *
 * Fixed (owner approved 27 Oct):
 * - **IUC5 "Unlock Valgos" checks Valgos (IC4).** Flash checked Balthazar
 *   (IC5), as IUC10 does, so unlocking Valgos completed no quest. It still
 *   pays 2 Valgos.
 * - **IS2 reads "Level 2".** Flash's `v2` said "3" while its rule checked
 *   `b6lvl: 2`, so it and IS3 shared a name.
 *
 * **Shiny (owner decision R12, owner approved 27 Oct).** Flash gives none;
 * the five biggest resource quests add a few, 85 in all, paid once to the
 * player's shared Shiny with the claim.
 *
 * Each condition is checked on the server only, against the Inferno yard's
 * own buildings and Strongbox (`services/goals/goalRules.ts`).
 */
const LIST: readonly GoalDef[] = [
  // INFERNO_QUESTS.as:8
  {
    id: "IT1",
    order: 2,
    name: "Build Sharpshooter",
    description: "Build a Sharpshooter.",
    reward: { r1: 2_000, r2: 2_000, r3: 0, r4: 0 },
    condition: { kind: "building", type: 21, level: 1 },
  },
  // INFERNO_QUESTS.as:28
  {
    id: "ICR3",
    order: 3,
    name: "Build Compound",
    description: "Build a Compound.",
    reward: { r1: 2_000, r2: 2_000, r3: 2_000, r4: 2_000 },
    condition: { kind: "building", type: 128, level: 1 },
  },
  // INFERNO_QUESTS.as:48
  {
    id: "ICR2",
    order: 4,
    name: "Build Incubator",
    description: "Build an Incubator.",
    reward: { r1: 1_000, r2: 1_000, r3: 0, r4: 1_000 },
    condition: { kind: "building", type: 13, level: 1 },
  },
  // INFERNO_QUESTS.as:68
  {
    id: "IC3",
    order: 5,
    name: "Next Level II",
    description: "Upgrade one of each resource building to level 2.",
    reward: { r1: 8_000, r2: 8_000, r3: 8_000, r4: 8_000 },
    condition: { kind: "buildings", types: [1, 2, 3, 4], level: 2 },
  },
  // INFERNO_QUESTS.as:88
  {
    id: "IT2",
    order: 6,
    name: "Build Blast Tower",
    description: "Build a Blast Tower.",
    reward: { r1: 2_000, r2: 2_000, r3: 0, r4: 0 },
    condition: { kind: "building", type: 130, level: 1 },
  },
  // INFERNO_QUESTS.as:108
  {
    id: "IC13",
    order: 8,
    name: "Upgrade Under Hall to Level 2",
    description: "Upgrade Under Hall to Level 2.",
    reward: { r1: 4_000, r2: 4_000, r3: 0, r4: 500 },
    condition: { kind: "building", type: 14, level: 2 },
  },
  // INFERNO_QUESTS.as:129; Flash prereq IC13, never read
  {
    id: "ICR1",
    order: 9,
    name: "Upgrade Strongbox to Level 1",
    description: "Build a Strongbox.",
    reward: { r1: 1_000, r2: 1_000, r3: 5_000, r4: 0 },
    condition: { kind: "building", type: 8, level: 1 },
  },
  // INFERNO_QUESTS.as:150; Flash prereq ICR1, never read
  {
    id: "IUC2",
    order: 10,
    name: "Unlock Zagnoid",
    description: "Unlock Zagnoid in the Strongbox.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC2", count: 10 },
    condition: { kind: "unlocked", monster: "IC2" },
  },
  // INFERNO_QUESTS.as:169; Flash prereq IUC2, never read
  {
    id: "IUC3",
    order: 11,
    name: "Unlock Malphus",
    description: "Unlock Malphus in the Strongbox.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC3", count: 10 },
    condition: { kind: "unlocked", monster: "IC3" },
  },
  // INFERNO_QUESTS.as:187
  {
    id: "IC9",
    order: 12,
    name: "Upgrade Bone Cruncher to Level 3",
    description: "Upgrade Bone Cruncher to Level 3.",
    reward: { r1: 10_000, r2: 0, r3: 0, r4: 0 },
    condition: { kind: "building", type: 1, level: 3 },
  },
  // INFERNO_QUESTS.as:207
  {
    id: "IC10",
    order: 13,
    name: "Upgrade Coal Extractor to Level 3",
    description: "Upgrade Coal Extractor to Level 3.",
    reward: { r1: 0, r2: 10_000, r3: 0, r4: 0 },
    condition: { kind: "building", type: 2, level: 3 },
  },
  // INFERNO_QUESTS.as:227
  {
    id: "IC11",
    order: 14,
    name: "Upgrade Sulfur Swirler to Level 3",
    description: "Upgrade Sulfur Swirler to Level 3.",
    reward: { r1: 0, r2: 0, r3: 2_500, r4: 0 },
    condition: { kind: "building", type: 3, level: 3 },
  },
  // INFERNO_QUESTS.as:247
  {
    id: "IC12",
    order: 15,
    name: "Upgrade Magma Pump to Level 3",
    description: "Upgrade Magma Pump to Level 3.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 2_000 },
    condition: { kind: "building", type: 4, level: 3 },
  },
  // INFERNO_QUESTS.as:268; Flash prereq IS1, never read; Flash's name said Level 3
  {
    id: "IS2",
    order: 16,
    name: "Upgrade Resource Pod to Level 2",
    description: "Upgrade Resource Pod to Level 2.",
    reward: { r1: 4_000, r2: 4_000, r3: 2_000, r4: 2_000 },
    condition: { kind: "building", type: 6, level: 2 },
  },
  // INFERNO_QUESTS.as:288
  {
    id: "IBK1",
    order: 17,
    name: "Resource Gatherer",
    description: "Bank 1,000 resources with a single click.",
    reward: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 },
    condition: { kind: "counter", counter: "infernoBestBank", target: 1_000 },
  },
  // INFERNO_QUESTS.as:304; Flash prereq IC9, never read
  {
    id: "IC4",
    order: 18,
    name: "Upgrade Bone Cruncher to Level 4",
    description: "Upgrade Bone Cruncher to Level 4.",
    reward: { r1: 20_000, r2: 0, r3: 0, r4: 0 },
    condition: { kind: "building", type: 1, level: 4 },
  },
  // INFERNO_QUESTS.as:325; Flash prereq IC10, never read
  {
    id: "IC5",
    order: 19,
    name: "Upgrade Coal Extractor to Level 4",
    description: "Upgrade Coal Extractor to Level 4.",
    reward: { r1: 0, r2: 20_000, r3: 0, r4: 0 },
    condition: { kind: "building", type: 2, level: 4 },
  },
  // INFERNO_QUESTS.as:346; Flash prereq IC11, never read
  {
    id: "IC6",
    order: 20,
    name: "Upgrade Sulfur Swirler to Level 4",
    description: "Upgrade Sulfur Swirler to Level 4.",
    reward: { r1: 0, r2: 0, r3: 10_000, r4: 0 },
    condition: { kind: "building", type: 3, level: 4 },
  },
  // INFERNO_QUESTS.as:367; Flash prereq IC12, never read
  {
    id: "IC7",
    order: 21,
    name: "Upgrade Magma Pump to Level 4",
    description: "Upgrade Magma Pump to Level 4.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 10_000 },
    condition: { kind: "building", type: 4, level: 4 },
  },
  // INFERNO_QUESTS.as:388; Flash prereq IS2, never read
  {
    id: "IS3",
    order: 22,
    name: "Upgrade Resource Pod to Level 3",
    description: "Upgrade Resource Pod to Level 3.",
    reward: { r1: 8_000, r2: 8_000, r3: 4_000, r4: 4_000 },
    condition: { kind: "building", type: 6, level: 3 },
  },
  // INFERNO_QUESTS.as:409; Flash prereq IC13, never read
  {
    id: "IC14",
    order: 23,
    name: "Upgrade Under Hall to Level 3",
    description: "Upgrade Under Hall to Level 3.",
    reward: { r1: 5_000, r2: 5_000, r3: 2_500, r4: 2_500 },
    condition: { kind: "building", type: 14, level: 3 },
  },
  // INFERNO_QUESTS.as:430; Flash prereq IS3, never read
  {
    id: "IS4",
    order: 24,
    name: "Upgrade Resource Pod to Level 4",
    description: "Upgrade Resource Pod to Level 4.",
    reward: { r1: 16_000, r2: 16_000, r3: 8_000, r4: 8_000 },
    condition: { kind: "building", type: 6, level: 4 },
  },
  // INFERNO_QUESTS.as:451; Flash prereq IS4, never read
  {
    id: "IS5",
    order: 25,
    name: "Upgrade Resource Pod to Level 5",
    description: "Upgrade Resource Pod to Level 5.",
    reward: { r1: 32_000, r2: 32_000, r3: 16_000, r4: 16_000 },
    shiny: 15,
    condition: { kind: "building", type: 6, level: 5 },
  },
  // INFERNO_QUESTS.as:471
  {
    id: "IC17",
    order: 26,
    name: "Build Infernal Academy",
    description: "Build an Infernal Academy.",
    reward: { r1: 0, r2: 0, r3: 5_000, r4: 0 },
    condition: { kind: "building", type: 26, level: 1 },
  },
  // INFERNO_QUESTS.as:491; Flash prereq IC14, never read; Flash checked IC5
  {
    id: "IUC5",
    order: 27,
    name: "Unlock Valgos",
    description: "Unlock Valgos in the Strongbox.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC4", count: 2 },
    condition: { kind: "unlocked", monster: "IC4" },
  },
  // INFERNO_QUESTS.as:510; Flash prereq IUC5, never read
  {
    id: "IUC6",
    order: 28,
    name: "Unlock Grokus",
    description: "Unlock Grokus in the Strongbox.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC6", count: 15 },
    condition: { kind: "unlocked", monster: "IC6" },
  },
  // INFERNO_QUESTS.as:528
  {
    id: "IT3",
    order: 29,
    name: "Build Magma Tower",
    description: "Build a Magma Tower.",
    reward: { r1: 30_000, r2: 20_000, r3: 20_000, r4: 20_000 },
    shiny: 10,
    condition: { kind: "building", type: 132, level: 1 },
  },
  // INFERNO_QUESTS.as:548
  {
    id: "IQT1",
    order: 30,
    name: "Build Quake Tower",
    description: "Build a Quake Tower.",
    reward: { r1: 30_000, r2: 20_000, r3: 20_000, r4: 20_000 },
    shiny: 10,
    condition: { kind: "building", type: 129, level: 1 },
  },
  // INFERNO_QUESTS.as:569; Flash prereq IBK1, never read
  {
    id: "IBK2",
    order: 31,
    name: "Resource Collector",
    description: "Bank 20,000 resources with a single click.",
    reward: { r1: 2_000, r2: 2_000, r3: 2_000, r4: 2_000 },
    condition: { kind: "counter", counter: "infernoBestBank", target: 20_000 },
  },
  // INFERNO_QUESTS.as:585; Flash prereq IC14, never read
  {
    id: "IC15",
    order: 32,
    name: "Upgrade Under Hall to Level 4",
    description: "Upgrade Under Hall to Level 4.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC4", count: 20 },
    condition: { kind: "building", type: 14, level: 4 },
  },
  // INFERNO_QUESTS.as:608; Flash prereq IUC9, never read
  {
    id: "IUC10",
    order: 33,
    name: "Unlock Balthazar",
    description: "Unlock Balthazar in the Strongbox.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC5", count: 20 },
    condition: { kind: "unlocked", monster: "IC5" },
  },
  // INFERNO_QUESTS.as:627; Flash prereq IUC10, never read
  {
    id: "IUC11",
    order: 34,
    name: "Unlock Sabnox",
    description: "Unlock Sabnox in the Strongbox.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC7", count: 5 },
    condition: { kind: "unlocked", monster: "IC7" },
  },
  // INFERNO_QUESTS.as:646; Flash prereq IT3, never read
  {
    id: "IUT3",
    order: 35,
    name: "Upgrade Magma Tower to Level 3",
    description: "Upgrade Magma Tower to Level 3.",
    reward: { r1: 60_000, r2: 40_000, r3: 40_000, r4: 40_000 },
    shiny: 25,
    condition: { kind: "building", type: 132, level: 3 },
  },
  // INFERNO_QUESTS.as:667; Flash prereq IQT1, never read
  {
    id: "IQT3",
    order: 36,
    name: "Upgrade Quake Tower to Level 3",
    description: "Upgrade Quake Tower to Level 3.",
    reward: { r1: 60_000, r2: 40_000, r3: 40_000, r4: 40_000 },
    shiny: 25,
    condition: { kind: "building", type: 129, level: 3 },
  },
  // INFERNO_QUESTS.as:688; Flash prereq IC14, never read
  {
    id: "IC16",
    order: 37,
    name: "Upgrade Under Hall to Level 5",
    description: "Upgrade Under Hall to Level 5.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC7", count: 5 },
    condition: { kind: "building", type: 14, level: 5 },
  },
  // INFERNO_QUESTS.as:711; Flash prereq IUC13, never read
  {
    id: "IUC12",
    order: 38,
    name: "Unlock King Wormzer",
    description: "Unlock King Wormzer in the Strongbox.",
    reward: { r1: 0, r2: 0, r3: 0, r4: 0 },
    monsters: { id: "IC8", count: 2 },
    condition: { kind: "unlocked", monster: "IC8" },
  },
  // INFERNO_QUESTS.as:730; Flash prereq IBK2, never read
  {
    id: "IBK3",
    order: 39,
    name: "Resource Trader",
    description: "Bank 100,000 resources with a single click.",
    reward: { r1: 10_000, r2: 10_000, r3: 10_000, r4: 10_000 },
    condition: { kind: "counter", counter: "infernoBestBank", target: 100_000 },
  },
  // INFERNO_QUESTS.as:746; Flash prereq IBK3, never read
  {
    id: "IBK4",
    order: 40,
    name: "Resource Mogul",
    description: "Bank 500,000 resources with a single click.",
    reward: { r1: 50_000, r2: 50_000, r3: 50_000, r4: 50_000 },
    condition: { kind: "counter", counter: "infernoBestBank", target: 500_000 },
  },
];

/** Every Inferno quest, in display order. */
export const INFERNO_GOALS: readonly GoalDef[] = LIST.map((goal, index) => ({ goal, index }))
  .sort((a, b) => a.goal.order - b.goal.order || a.index - b.index)
  .map(({ goal }) => goal);

const BY_ID = new Map(INFERNO_GOALS.map((goal) => [goal.id, goal]));

/** An Inferno quest by id, or undefined. */
export const infernoGoalById = (id: string): GoalDef | undefined => BY_ID.get(id);
