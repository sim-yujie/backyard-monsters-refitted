// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockTabs } from "./DockTabs";

/** The attack dock's tab row (owner, 18 Nov 2026, proposal A). */
describe("DockTabs", () => {
  let phone = false;
  afterEach(() => {
    phone = false;
    document.body.replaceChildren();
  });

  const make = () => {
    const dock = document.createElement("div");
    dock.className = "attack-dock";
    const body = document.createElement("div");
    body.className = "attack-dock__body";
    const onChange = vi.fn();
    const tabs = new DockTabs({ dock, sheet: () => phone, onChange });
    dock.append(tabs.element, body);
    document.body.append(dock);
    return { dock, body, tabs, onChange };
  };
  const names = (tabs: DockTabs): string[] => [...tabs.element.children].map((tab) => tab.textContent ?? "");

  it("stays hidden with no tabs, so a replay's dock keeps its plain handle", () => {
    const { dock, tabs } = make();
    expect(tabs.element.hidden).toBe(true);
    expect(dock.classList.contains("attack-dock--tabs")).toBe(false);
    expect(dock.dataset["tab"]).toBeUndefined();
  });

  it("orders the tabs Army, Catapult, Siege whatever order they are added in, and shows the Army first", () => {
    const { dock, tabs } = make();
    tabs.add("siege", { label: "Decoy" });
    tabs.add("army", { label: "Army" });
    tabs.add("catapult", { label: "Catapult" });
    expect(names(tabs)).toEqual(["Army", "Catapult", "Decoy"]);
    expect(tabs.element.hidden).toBe(false);
    expect(dock.classList.contains("attack-dock--tabs")).toBe(true);
    // The first tab added is up until another is picked; it was the siege's, so pick the Army.
    tabs.show("army");
    expect(dock.dataset["tab"]).toBe("army");
  });

  it("tags windows for their tab", () => {
    const { tabs, body } = make();
    const panel = body.appendChild(document.createElement("section"));
    tabs.claim("catapult", panel);
    expect(panel.dataset["dockTab"]).toBe("catapult");
  });

  it("on the sheet: a tab opens it there, the open tab closes it, the handle state follows", () => {
    phone = true;
    const { dock, tabs, onChange } = make();
    tabs.add("army", { label: "Army" });
    const onShow = vi.fn();
    tabs.add("catapult", { label: "Catapult", onShow });
    expect(tabs.showing()).toBe(false);
    tabs.press("catapult");
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(tabs.isOpen()).toBe(true);
    expect(dock.classList.contains("attack-dock--open")).toBe(true);
    expect(dock.dataset["tab"]).toBe("catapult");
    tabs.press("catapult");
    expect(tabs.isOpen()).toBe(false);
    expect(dock.classList.contains("attack-dock--open")).toBe(false);
    // Closed, no tab reads as up.
    expect([...tabs.element.children].map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "false"]);
    expect(onChange).toHaveBeenCalled();
  });

  it("on the column: B toggles between the Catapult and the Army; on the sheet it closes", () => {
    const { dock, tabs } = make();
    tabs.add("army", { label: "Army" });
    tabs.add("catapult", { label: "Catapult" });
    tabs.key("catapult");
    expect(dock.dataset["tab"]).toBe("catapult");
    tabs.key("catapult");
    expect(dock.dataset["tab"]).toBe("army");
    phone = true;
    tabs.key("catapult");
    expect(tabs.isOpen()).toBe(true);
    tabs.key("catapult");
    expect(tabs.isOpen()).toBe(false);
  });

  it("starts a newly picked tab at the top of its list", () => {
    const { body, tabs } = make();
    tabs.add("army", { label: "Army" });
    tabs.add("catapult", { label: "Catapult" });
    body.scrollTop = 120;
    tabs.show("catapult");
    expect(body.scrollTop).toBe(0);
  });

  it("drops a removed tab and falls back to the Army", () => {
    const { dock, tabs } = make();
    tabs.add("army", { label: "Army" });
    const catapult = tabs.add("catapult", { label: "Catapult" });
    tabs.show("catapult");
    catapult.remove();
    expect(names(tabs)).toEqual(["Army"]);
    expect(dock.dataset["tab"]).toBe("army");
  });
});
