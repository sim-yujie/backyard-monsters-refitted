import { describe, expect, it, vi } from "vitest";
import { baiterRecorder, type BaiterRecordApi } from "./baiterRecord";

/** The two calls, the start answering with `token` (or failing when it is null). */
const apiOf = (token: string | null) => {
  const api = {
    start: vi.fn(() =>
      token === null ? Promise.reject(new Error("refused")) : Promise.resolve({ report: { token } }),
    ),
    run: vi.fn(() => Promise.resolve({})),
  } satisfies BaiterRecordApi;
  return api;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Baiter run record (#227)", () => {
  it("asks for a token as the run starts and hands it back on a real finish", async () => {
    const api = apiOf("abc");
    const recorder = baiterRecorder(api);
    recorder.start();
    expect(api.start).toHaveBeenCalledTimes(1);
    recorder.finish("destroyed");
    await settle();
    expect(api.run).toHaveBeenCalledWith("abc");
  });

  it("counts the army spent and the clock run out, not a stop or a walk-away", async () => {
    for (const [reason, counted] of [
      ["exhausted", true],
      ["expired", true],
      ["retreat", false],
      ["left", false],
    ] as const) {
      const api = apiOf("t");
      const recorder = baiterRecorder(api);
      recorder.start();
      recorder.finish(reason);
      await settle();
      expect(api.run).toHaveBeenCalledTimes(counted ? 1 : 0);
    }
  });

  it("sends the token once, and nothing when the start was refused", async () => {
    const api = apiOf("t");
    const recorder = baiterRecorder(api);
    recorder.start();
    recorder.finish("destroyed");
    recorder.finish("destroyed");
    await settle();
    expect(api.run).toHaveBeenCalledTimes(1);

    const refused = apiOf(null);
    const other = baiterRecorder(refused);
    other.start();
    other.finish("destroyed");
    await settle();
    expect(refused.run).not.toHaveBeenCalled();
  });

  it("a failed record never throws", async () => {
    const api = apiOf("t");
    api.run.mockImplementation(() => Promise.reject(new Error("offline")));
    const recorder = baiterRecorder(api);
    recorder.start();
    expect(() => recorder.finish("destroyed")).not.toThrow();
    await settle();
  });
});
