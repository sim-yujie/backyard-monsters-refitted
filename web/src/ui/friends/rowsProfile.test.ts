// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { openProfile } from "@/ui/profile/ProfileDialog";
import { playerRow } from "./rows";

vi.mock("@/ui/profile/ProfileDialog", () => ({ openProfile: vi.fn() }));

describe("a friends row's face", () => {
  it("is a button that opens that player's profile", () => {
    const row = playerRow({ userid: 42, username: "pal", pic: null, level: 9 });
    const face = row.querySelector<HTMLButtonElement>("button.friends-row__face-button")!;
    expect(face.getAttribute("aria-label")).toBe("pal: profile");
    face.click();
    expect(vi.mocked(openProfile)).toHaveBeenCalledWith(expect.objectContaining({ userid: 42 }));
  });
});
