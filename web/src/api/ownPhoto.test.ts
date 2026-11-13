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

  it("never shows the last player's photo to the next one signed in on the same page", async () => {
    // Player 7 has a photo and it is known.
    recordOwnProfile(profile(2));
    // Player 8 signs in on the same tab: their own profile is fetched, 7's address is never handed over.
    fetchProfile.mockResolvedValue({ ...profile(null), userid: 8 });
    const watcher = vi.fn();
    watchOwnPhoto(8, watcher);
    expect(watcher).not.toHaveBeenCalled();
    expect(fetchProfile).toHaveBeenCalledWith(8);
    await vi.waitFor(() => expect(watcher).toHaveBeenCalledWith(null));
    expect(watcher).not.toHaveBeenCalledWith("/photos/7?v=2");
  });

  it("ignores an answer that is not the signed-in player's own profile", async () => {
    fetchProfile.mockResolvedValue({ ...profile(9), own: false });
    const watcher = vi.fn();
    watchOwnPhoto(7, watcher);
    await Promise.resolve();
    await Promise.resolve();
    expect(watcher).not.toHaveBeenCalled();
  });

  it("asks again on the next screen after a failed fetch", async () => {
    fetchProfile.mockRejectedValueOnce(new Error("offline"));
    watchOwnPhoto(7, vi.fn());
    await vi.waitFor(() => expect(fetchProfile).toHaveBeenCalledOnce());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fetchProfile.mockResolvedValue(profile(4));
    const next = vi.fn();
    watchOwnPhoto(7, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith("/photos/7?v=4"));
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
