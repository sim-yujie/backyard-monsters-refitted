import { describe, expect, it, vi } from "vitest";
import type { Scene, SceneContext } from "./SceneManager";

// The real App pulls in Pixi; the names are all this module reads from it.
vi.mock("./App", () => ({
  SceneName: {
    BOOT: "boot",
    LOGIN: "login",
    MAP: "map",
    MAP_ROOM_1: "maproom1",
    MAP_ROOM_2: "maproom2",
    YARD: "yard",
    ATTACK: "attack",
    BAITER: "baiter",
    BAITER_REPLAY: "baiter-replay",
    WATCH: "watch",
    RAID: "raid",
    AWAY: "away",
  },
}));
vi.mock("@/game/sound/sound", () => ({ setScreenTune: vi.fn() }));
vi.mock("@/game/sound/soundSwitches", () => ({ loadSoundSwitches: vi.fn(async () => {}) }));

const { tuneForScene, withMusic } = await import("./musicScene");
const { MAP_ROOM_TUNE } = await import("@/game/sound/tunes");

describe("tuneForScene", () => {
  it("follows Flash: yard tune at home, attack tune in an attack, the alarm while the own yard is attacked", () => {
    expect(tuneForScene("yard")).toBe("yard");
    expect(tuneForScene("attack")).toBe("attack");
    expect(tuneForScene("watch")).toBe("attack");
    expect(tuneForScene("raid")).toBe("underAttack");
    expect(tuneForScene("baiter")).toBe("underAttack");
    expect(tuneForScene("baiter-replay")).toBe("underAttack");
  });

  it("the map rooms play the map room tune, for now the yard's", () => {
    expect(MAP_ROOM_TUNE).toBe("yard");
    expect(tuneForScene("maproom1")).toBe(MAP_ROOM_TUNE);
    expect(tuneForScene("maproom2")).toBe(MAP_ROOM_TUNE);
  });

  it("the map gate leaves the music alone; sign-in, boot and the idle screen are silent", () => {
    expect(tuneForScene("map")).toBeUndefined();
    expect(tuneForScene("login")).toBeNull();
    expect(tuneForScene("boot")).toBeNull();
    expect(tuneForScene("away")).toBeNull();
  });
});

describe("withMusic", () => {
  it("asks for the screen's tune and the switches before the screen's own enter", async () => {
    const order: string[] = [];
    const deps = {
      setTune: vi.fn(() => order.push("tune")),
      loadSwitches: vi.fn(async () => {
        order.push("switches");
      }),
    };
    const inner: Scene = { enter: () => void order.push("enter"), exit: vi.fn() };
    const scene = withMusic("attack", () => inner, deps)();
    await scene.enter?.({} as SceneContext);
    expect(order).toEqual(["switches", "tune", "enter"]);
    expect(deps.setTune).toHaveBeenCalledWith("attack");
    scene.exit?.();
    expect(inner.exit).toHaveBeenCalled();
  });
});
