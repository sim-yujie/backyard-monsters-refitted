import { describe, expect, it, vi } from "vitest";
import { helpedOf, HelpedWatch } from "./helpedWatch";

describe("hearing a friend's help in the own yard (#374)", () => {
  it("reads the presence answer's helped time, if any", () => {
    expect(helpedOf({ now: 5, helped: 1_800_000_000 })).toBe(1_800_000_000);
    expect(helpedOf({ now: 5 })).toBeNull();
    expect(helpedOf(null)).toBeNull();
    expect(helpedOf({ helped: "soon" })).toBeNull();
  });

  it("reads the yard again once for each help newer than the yard", () => {
    const onHelped = vi.fn();
    const watch = new HelpedWatch(1_000, onHelped);
    watch.hear({ helped: 900 });
    expect(onHelped).not.toHaveBeenCalled();
    watch.hear({ helped: 1_010 });
    watch.hear({ helped: 1_010 });
    expect(onHelped).toHaveBeenCalledTimes(1);
    watch.hear({ helped: 1_050 });
    expect(onHelped).toHaveBeenCalledTimes(2);
    watch.hear({});
    expect(onHelped).toHaveBeenCalledTimes(2);
  });
});
