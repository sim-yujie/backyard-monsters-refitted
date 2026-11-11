import { afterEach, describe, expect, it } from "vitest";
import { allianceTradeOn, setAllianceTradeFrom, setAllianceTradeOn } from "./tradeSwitch";

describe("alliance trading's switch", () => {
  afterEach(() => setAllianceTradeOn(false));

  it("is off until the server says true", () => {
    expect(allianceTradeOn()).toBe(false);
    setAllianceTradeOn("true");
    expect(allianceTradeOn()).toBe(false);
    setAllianceTradeOn(true);
    expect(allianceTradeOn()).toBe(true);
  });

  it("follows the yard load's alliancedata; no alliance is off", () => {
    setAllianceTradeFrom({ alliance_id: 7, trade_on: true });
    expect(allianceTradeOn()).toBe(true);
    setAllianceTradeFrom({ alliance_id: 7, trade_on: false });
    expect(allianceTradeOn()).toBe(false);
    setAllianceTradeOn(true);
    setAllianceTradeFrom(undefined);
    expect(allianceTradeOn()).toBe(false);
    setAllianceTradeOn(true);
    setAllianceTradeFrom({ alliance_id: 7 });
    expect(allianceTradeOn()).toBe(false);
  });
});
