import { describe, expect, it, vi } from "vitest";
import { goalsActions, type GoalsApi } from "./goals";

/** The Goals routes name the store's yard: none on the main yard, the Inferno yard's `baseid` there (Inferno WP 4.3). */

const apiOf = () => ({ state: vi.fn(() => Promise.resolve({})), claim: vi.fn(() => Promise.resolve({})) });

/** A store whose queue sends at once, with these yard args. */
const storeOf = (...yard: [] | [string]) => ({
  run: vi.fn((action: { send: (api: never, ...args: [] | [string]) => Promise<unknown> }) =>
    action.send({} as never, ...yard),
  ),
});

describe("goalsActions", () => {
  it("sends no baseid from the main yard", async () => {
    const api = apiOf();
    const actions = goalsActions(storeOf() as never, api as unknown as GoalsApi);
    await actions.state();
    await actions.claim("T1");
    expect(api.state).toHaveBeenCalledWith();
    expect(api.claim).toHaveBeenCalledWith("T1");
  });

  it("names the Inferno yard by its baseid there", async () => {
    const api = apiOf();
    const actions = goalsActions(storeOf("950") as never, api as unknown as GoalsApi);
    await actions.state();
    await actions.claim("IT1");
    expect(api.state).toHaveBeenCalledWith("950");
    expect(api.claim).toHaveBeenCalledWith("IT1", "950");
  });
});
