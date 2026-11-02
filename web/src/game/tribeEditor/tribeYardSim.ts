import { ApiError, type FormBody, type HttpMethod, type JsonBody, type LocalRoute } from "@/api/http";
import {
  YARD_STATE_KEYS,
  type ApiEnvelope,
  type BaseLoadResponse,
  type BuildingData,
  type BuildingDataMap,
  type LayoutPayload,
  type TrapPlacement,
  type YardResponse,
} from "@/api/types";
import { maxLevel } from "@/game/yard/buildingCosts";

/**
 * The tribe yard editor's stand-in for the server's yard routes
 * (LOCAL game only, `docs` in `api/tribeEditor.ts`).
 *
 * While a tribe camp's yard is open in the editor, every request under
 * `/bm/yard/` and `/bm/yardplanner/` is answered here, in the browser, from a
 * copy of that camp's yard. Nothing reaches the server, so the player's own
 * yard is never touched; "Save as <Tribe> level <N>" sends {@link saveBody}
 * to the editor's own save route.
 *
 * Wild monster tribes do not follow the player's rules (owner, 2 Nov 2026):
 * building is free and instant, with no count limits, any level up to the
 * type's maximum, and bunkers hold whatever the editor puts in them.
 */

const ZERO_COST = { r1: 0, r2: 0, r3: 0, r4: 0 } as const;
/** More than anything costs, so no client-side check runs short. */
const PLENTY = 1_000_000_000;

/** The refusal for a yard route the editor does not stand in for. */
export const NOT_IN_EDITOR = "tribeEditor";

const refuse = (message: string, status = 409): ApiError =>
  new ApiError(message, { status, code: message, body: { error: message, reason: NOT_IN_EDITOR } });

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** A field that may arrive as JSON text (a form body) or as the value itself. */
const parsed = <T>(value: unknown): T | undefined => {
  if (typeof value !== "string") return value as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const levelOf = (building: BuildingData): number => (building.l === undefined ? 1 : num(building.l, 1));

/** Strips a path to what follows `/bm/`, or null for a route outside it. */
const bmRoute = (path: string): string | null => {
  const at = path.indexOf("/bm/");
  return at < 0 ? null : path.slice(at + 4).replace(/\/+$/, "");
};

export class TribeYardSim {
  private readonly save: BaseLoadResponse;
  private readonly clock: () => number;

  constructor(yard: BaseLoadResponse, clock: () => number = () => Math.floor(Date.now() / 1000)) {
    this.save = structuredClone(yard);
    this.clock = clock;
    const buildings = (this.save.buildingdata ?? {}) as BuildingDataMap;
    // A camp yard has no jobs: anything mid-countdown is shown finished.
    for (const building of Object.values(buildings)) {
      for (const key of ["cB", "cU", "cR", "cF", "cL", "hp", "rE"]) delete building[key];
    }
    this.save.buildingdata = buildings;
    this.save.buildinghealthdata = {};
    this.save.monsters = (this.save.monsters ?? {}) as NonNullable<BaseLoadResponse["monsters"]>;
  }

  /* ── What the editor panel reads and changes ─────────────────────────── */

  /** The yard as it stands now (a copy). */
  yard(): BaseLoadResponse {
    return structuredClone(this.save);
  }

  buildings(): BuildingDataMap {
    return this.save.buildingdata as BuildingDataMap;
  }

  building(id: number): BuildingData | null {
    return this.buildings()[String(id)] ?? null;
  }

  /** Sets a building's level, 1 to the type's maximum (any Town Hall level included). */
  setLevel(id: number, level: number): number {
    const building = this.building(id);
    if (!building) throw refuse("That building is not in this yard.", 400);
    const top = Math.max(1, maxLevel(building.t));
    const next = Math.min(Math.max(1, Math.round(level)), top);
    if (next === 1) delete building.l;
    else building.l = next;
    return next;
  }

  /** Takes a building out, the Town Hall included. */
  remove(id: number): void {
    const key = String(id);
    if (!(key in this.buildings())) throw refuse("That building is not in this yard.", 400);
    delete this.buildings()[key];
  }

  /** Sets one monster's count in a bunker (0 takes it out). */
  setGarrison(id: number, monster: string, count: number): void {
    const building = this.building(id);
    if (!building) throw refuse("That building is not in this yard.", 400);
    const garrison = { ...((building.m as Record<string, number> | undefined) ?? {}) };
    const next = Math.max(0, Math.round(count));
    if (next > 0) garrison[monster] = next;
    else delete garrison[monster];
    if (Object.keys(garrison).length > 0) building.m = garrison;
    else delete building.m;
  }

  garrison(id: number): Record<string, number> {
    return { ...((this.building(id)?.m as Record<string, number> | undefined) ?? {}) };
  }

  /** The yard's housed monsters (`monsters`), by id. */
  housing(): Record<string, number> {
    const monsters: Record<string, number> = {};
    for (const [id, count] of Object.entries((this.save.monsters ?? {}) as Record<string, unknown>)) {
      monsters[id] = num(count);
    }
    return monsters;
  }

  setHousing(monster: string, count: number): void {
    const monsters = this.save.monsters as unknown as Record<string, number>;
    monsters[monster] = Math.max(0, Math.round(count));
  }

  /** The slices "Save as <Tribe> level <N>" sends. */
  saveBody(): {
    buildingdata: BuildingDataMap;
    monsters: Record<string, unknown>;
    academy: Record<string, unknown>;
    lockerdata: Record<string, unknown>;
  } {
    return structuredClone({
      buildingdata: this.buildings(),
      monsters: (this.save.monsters ?? {}) as Record<string, unknown>,
      academy: (this.save.academy ?? {}) as Record<string, unknown>,
      lockerdata: (this.save.lockerdata ?? {}) as Record<string, unknown>,
    });
  }

  /* ── The routes ──────────────────────────────────────────────────────── */

  /** The {@link LocalRoute} that answers the yard's requests while the editor is open. */
  readonly handle: LocalRoute = (method, path, body) => {
    // The attack save writes a yard: never while editing.
    if (/\/base\/(save|updatesaved)$/.test(path)) return Promise.reject(refuse("Not in the tribe editor."));
    const route = bmRoute(path);
    if (route === null) return undefined;
    if (!route.startsWith("yard/") && route !== "yard" && !route.startsWith("yardplanner/")) {
      return undefined;
    }
    try {
      return Promise.resolve(this.answer(method, route, body as FormBody & JsonBody));
    } catch (caught) {
      return Promise.reject(caught);
    }
  };

  private answer(method: HttpMethod, route: string, body: Record<string, unknown>): ApiEnvelope {
    switch (route) {
      case "yard/state":
        return this.state(null);
      case "yard/build":
      case "yard/build/instant":
        return this.build(body);
      case "yard/build/cancel":
      case "yard/recycle":
        return this.recycle(num(body.id));
      case "yard/upgrade":
      case "yard/upgrade/instant":
        return this.upgrade(num(body.id));
      case "yard/upgrade/cancel":
        return this.state({ id: num(body.id), refund: { ...ZERO_COST } });
      case "yard/speedup":
      case "yard/repair":
      case "yard/repair/instant":
        return this.state({ id: num(body.id) });
      case "yard/bunker/fill":
        return this.bunkerFill(body);
      case "yard/bunker/remove":
        return this.bunkerRemove(body);
      case "yardplanner/apply":
        return this.apply(body);
      case "yardplanner/walls/upgrade":
        return this.upgradeWalls(body);
      case "yardplanner/traps/rearm":
        return this.rearm(body);
      case "yardplanner/layouts":
        if (method === "GET") return { error: 0, slots: 0, layouts: [] } as ApiEnvelope;
        throw refuse("Layout slots are the player's own: not in the tribe editor.");
      default:
        throw refuse("Not in the tribe editor.");
    }
  }

  /** A yard answer: the whole state, nothing completed, and the route's report. */
  private state<Report>(report: Report): YardResponse<Report> {
    const now = this.clock();
    const plenty = { r1: PLENTY, r2: PLENTY, r3: PLENTY, r4: PLENTY };
    const values: Record<string, unknown> = {
      savetime: now,
      currenttime: now,
      resources: { ...plenty, r1max: PLENTY, r2max: PLENTY, r3max: PLENTY, r4max: PLENTY },
      credits: 0,
      caps: plenty,
      workers: { total: 99, busy: 0 },
      protected: 0,
      buildingdata: structuredClone(this.buildings()),
      buildinghealthdata: {},
      storedata: {},
      monsters: structuredClone(this.save.monsters ?? {}),
      lockerdata: structuredClone(this.save.lockerdata ?? {}),
      academy: structuredClone(this.save.academy ?? {}),
      champion: [],
      mushrooms: structuredClone(this.save.mushrooms ?? {}),
      researchdata: {},
      onboarding: { guide: { state: "done" }, camp: "removed", goalsReady: 0, tips: {} },
    };
    const state: Record<string, unknown> = { error: 0, completed: [], report };
    for (const key of YARD_STATE_KEYS) state[key] = values[key];
    return state as unknown as YardResponse<Report>;
  }

  private nextId(): number {
    return Object.values(this.buildings()).reduce((top, one) => Math.max(top, num(one.id)), 0) + 1;
  }

  private build(body: Record<string, unknown>): ApiEnvelope {
    const t = num(body.type);
    const x = num(body.x);
    const y = num(body.y);
    if (t <= 0 || maxLevel(t) === 0) throw refuse("That cannot be built.", 400);
    const id = this.nextId();
    this.buildings()[String(id)] = { X: x, Y: y, t, id };
    return this.state({ id, t, x, y, seconds: 0, finished: true, cost: { ...ZERO_COST }, points: 0, credits: 0 });
  }

  private recycle(id: number): ApiEnvelope {
    const building = this.building(id);
    if (!building) throw refuse("That building is not in this yard.", 400);
    this.remove(id);
    return this.state({
      id,
      t: building.t,
      refund: { ...ZERO_COST },
      lost: { ...ZERO_COST },
      stored: null,
      culled: {},
    });
  }

  private upgrade(id: number): ApiEnvelope {
    const building = this.building(id);
    if (!building) throw refuse("That building is not in this yard.", 400);
    const from = levelOf(building);
    if (from >= maxLevel(building.t)) throw refuse("That building is at its top level.");
    const to = this.setLevel(id, from + 1);
    return this.state({ id, from, to, seconds: 0, cost: { ...ZERO_COST }, credits: 0, points: 0 });
  }

  private bunkerFill(body: Record<string, unknown>): ApiEnvelope {
    const id = num(body.bunker);
    const added = parsed<Record<string, number>>(body.monsters) ?? {};
    const garrison = this.garrison(id);
    for (const [monster, count] of Object.entries(added)) {
      this.setGarrison(id, monster, (garrison[monster] ?? 0) + num(count));
    }
    const used = Object.values(this.garrison(id)).reduce((sum, one) => sum + one, 0);
    return this.state({
      bunker: id,
      source: body.source ?? "housing",
      added,
      cost: { r3: 0 },
      credits: 0,
      used,
      capacity: used,
    });
  }

  private bunkerRemove(body: Record<string, unknown>): ApiEnvelope {
    const id = num(body.bunker);
    const monster = String(body.monster ?? "");
    const have = this.garrison(id)[monster] ?? 0;
    const removed = Math.min(have, Math.max(0, num(body.count)));
    this.setGarrison(id, monster, have - removed);
    return this.state({ bunker: id, monster, removed, juiced: false, goo: 0, lost: 0 });
  }

  /** The planner's Apply: positions from the plan, planned levels at once, anything left out taken away. */
  private apply(body: Record<string, unknown>): ApiEnvelope {
    const payload = parsed<LayoutPayload>(body.data);
    if (!payload || !Array.isArray(payload.nodes)) throw refuse("That plan could not be read.", 400);
    const buildings = this.buildings();
    const kept = new Set<string>();
    let moved = 0;
    for (const node of payload.nodes) {
      const building = buildings[String(node.id)];
      if (!building) continue;
      kept.add(String(node.id));
      if (building.X !== node.x || building.Y !== node.y) moved += 1;
      building.X = node.x;
      building.Y = node.y;
      if (node.plan?.level) this.setLevel(num(node.id), node.plan.level);
    }
    for (const key of Object.keys(buildings)) if (!kept.has(key)) delete buildings[key];
    for (const decoration of payload.fromStorage ?? []) {
      const id = this.nextId();
      buildings[String(id)] = { X: decoration.x, Y: decoration.y, t: decoration.t, id };
    }
    const state = this.state(null);
    return {
      error: 0,
      moved,
      buildingdata: state.buildingdata,
      resources: state.resources,
      upgrades: null,
      buildinghealthdata: {},
    } as ApiEnvelope;
  }

  private upgradeWalls(body: Record<string, unknown>): ApiEnvelope {
    const ids = parsed<number[]>(body.ids) ?? [];
    const level = num(body.level, 1);
    for (const id of ids) if (this.building(num(id))) this.setLevel(num(id), level);
    const state = this.state(null);
    return {
      error: 0,
      upgraded: ids.length,
      level,
      cost: { ...ZERO_COST },
      resources: state.resources,
      buildingdata: state.buildingdata,
    } as ApiEnvelope;
  }

  private rearm(body: Record<string, unknown>): ApiEnvelope {
    const traps = parsed<TrapPlacement[]>(body.traps) ?? [];
    const ids: number[] = [];
    for (const trap of traps) {
      const id = this.nextId();
      this.buildings()[String(id)] = { X: num(trap.x), Y: num(trap.y), t: num(trap.t), id };
      ids.push(id);
    }
    const state = this.state(null);
    return {
      error: 0,
      placed: ids.length,
      ids,
      cost: { ...ZERO_COST },
      resources: state.resources,
      buildingdata: state.buildingdata,
      firedtraps: [],
    } as ApiEnvelope;
  }
}
