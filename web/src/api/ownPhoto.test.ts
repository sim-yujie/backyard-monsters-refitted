import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "./profile";

const fetchProfile = vi.fn<(userid: number) => Promise<Profile>>();
vi.mock("./profile", () => ({
  fetchProfile: (userid: number) => fetchProfile(userid),
  photoUrl: (userid: number, version: number) => `/photos/${userid}?v=${version}`,
}));

const { recordOwnProfile, resetOwnPhoto, watchOwnPhoto } = await import("./ownPhoto");

const profile = (photoVersion: number | null): Profile =>
  ({ userid: 7, username: "p", pic: null, bio: "", photoVersion, own: true }) as unknown as Profile;

afterEach(() => {
  resetOwnPhoto();
  fetchProfile.mockReset();
});

describe("the own profile photo for the account badge", () => {
  it("fetches once, then tells each watcher straight away", async () => {
    fetchProfile.mockResolvedValue(profile(2));
    const first = vi.fn();
    watchOwnPhoto(7, first);
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith("/photos/7?v=2"));
    const second = vi.fn();
    watchOwnPhoto(7, second);
    expect(second).toHaveBeenCalledWith("/photos/7?v=2");
    expect(fetchProfile).toHaveBeenCalledOnce();
  });

  it("follows an upload and a removal made in the Profile window", () => {
    fetchProfile.mockReturnValue(new Promise(() => {}));
    const watcher = vi.fn();
    const stop = watchOwnPhoto(7, watcher);
    recordOwnProfile(profile(5));
    expect(watcher).toHaveBeenLastCalledWith("/photos/7?v=5");
    recordOwnProfile(profile(null));
    expect(watcher).toHaveBeenLastCalledWith(null);
    stop();
    recordOwnProfile(profile(6));
    expect(watcher).toHaveBeenCalledTimes(2);
  });

  it("leaves the critter when the profile cannot be fetched", async () => {
    fetchProfile.mockRejectedValue(new Error("offline"));
    const watcher = vi.fn();
    watchOwnPhoto(7, watcher);
    await Promise.resolve();
    await Promise.resolve();
    expect(watcher).not.toHaveBeenCalled();
  });
});
