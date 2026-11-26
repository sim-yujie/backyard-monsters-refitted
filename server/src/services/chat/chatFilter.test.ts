import { describe, expect, test } from "bun:test";

import {
  compileWatchList,
  DEFAULT_WATCH_WORDS,
  filterLine,
  filterWhy,
  findLinks,
  findWatched,
  LINK_REMOVED,
  linkKind,
} from "./chatFilter.js";

const list = compileWatchList(DEFAULT_WATCH_WORDS);
const NEW = { isNew: true, staff: false };
const OLD = { isNew: false, staff: false };
const STAFF = { isNew: true, staff: true };

const links = (text: string) => findLinks(text).map((link) => [link.text, link.kind]);

describe("chat filter: finding links", () => {
  test("every spelling of a link is found", () => {
    expect(links("go http://example.com/x now")).toEqual([["http://example.com/x", "link"]]);
    expect(links("go https://www.facebook.com/share/g/1Bx9kQ/ now")).toEqual([["https://www.facebook.com/share/g/1Bx9kQ/", "invite"]]);
    expect(links("www.example.net")).toEqual([["www.example.net", "link"]]);
    expect(links("join t.me/bymps")).toEqual([["t.me/bymps", "invite"]]);
    expect(links("FB.COM/groups/abc")).toEqual([["FB.COM/groups/abc", "invite"]]);
    expect(links("facebook.com/someone")).toEqual([["facebook.com/someone", "link"]]);
    expect(links("bit.ly/abc and t.co/xyz")).toEqual([["bit.ly/abc", "link"], ["t.co/xyz", "link"]]);
  });

  test("sentence punctuation after a link is not part of it", () => {
    expect(links("see t.me/abc.")).toEqual([["t.me/abc", "invite"]]);
    expect(links("(example.com/x)!")).toEqual([["example.com/x", "link"]]);
  });

  test("ordinary chat with dots is not a link", () => {
    for (const text of ["60.4M putty", "v2.0.0-beta.8 is out", "sige.na tara", "lvl 38.5k", "ok.im here", "will.be fine", "a.b.c", "1.5k gold", "e.g. this", "me@mail.com"]) {
      expect(links(text)).toEqual([]);
    }
  });

  test("group invites everywhere they live", () => {
    for (const link of [
      "t.me/abc",
      "https://telegram.me/abc",
      "tg://join?invite=abc",
      "facebook.com/groups/123",
      "m.facebook.com/groups/123",
      "web.facebook.com/share/g/abc",
      "fb.com/groups/x",
      "m.me/j/abc",
      "chat.whatsapp.com/abc",
      "wa.me/639123",
      "discord.gg/other",
      "discord.com/invite/other",
    ]) {
      expect(linkKind(link)).toBe("invite");
    }
  });

  test("our own site and Discord invite are allowed, look-alikes are not", () => {
    expect(linkKind("https://bymrevamped.com/news")).toBe("allowed");
    expect(linkKind("cdn.bymrevamped.com/x.png")).toBe("allowed");
    expect(linkKind("discord.gg/wthryBRZHz")).toBe("allowed");
    expect(linkKind("https://discord.com/invite/wthryBRZHz")).toBe("allowed");
    expect(linkKind("notbymrevamped.com")).toBe("link");
    expect(linkKind("bymrevamped.com.x.ph")).toBe("link");
    expect(linkKind("evil.com/bymrevamped.com")).toBe("link");
    expect(linkKind("discord.gg/wthrybrzhz")).toBe("invite");
  });
});

describe("chat filter: watched words", () => {
  test("always-watched words, whole words in any case and spacing", () => {
    expect(findWatched("Hi sino papasok sa Private Server bmy", list)).toEqual(["private server"]);
    expect(findWatched("privateserver na to", list)).toEqual(["private server"]);
    expect(findWatched("add me on TELEGRAM", list)).toEqual(["telegram"]);
    expect(findWatched("may tele ka?", list)).toEqual(["tele"]);
    expect(findWatched("tg ko", list)).toEqual(["tg"]);
    expect(findWatched("t . me/abc", list)).toEqual(["t.me"]);
    expect(findWatched("television telescope stg", list)).toEqual([]);
  });

  test("FB and Facebook only right next to a context word, either side", () => {
    expect(findWatched("Ito link fb Group ko", list)).toEqual(["fb"]);
    expect(findWatched("join fb", list)).toEqual(["fb"]);
    expect(findWatched("fb gc", list)).toEqual(["fb"]);
    expect(findWatched("our facebook groups", list)).toEqual(["facebook"]);
    expect(findWatched("I played this on FB back then", list)).toEqual([]);
    expect(findWatched("add me on fb", list)).toEqual([]);
  });

  test("the list is the dashboard's: a removed word stops counting", () => {
    const short = compileWatchList(DEFAULT_WATCH_WORDS.filter((w) => w.word !== "tele"));
    expect(findWatched("may tele ka?", short)).toEqual([]);
  });
});

describe("chat filter: what happens to a line", () => {
  test("a new player's link is cut, the rest posts, moderators are flagged", () => {
    const out = filterLine("check example.com/x guys", NEW, list);
    expect(out).toMatchObject({ shown: `check ${LINK_REMOVED} guys`, hidden: false, flag: true, tags: ["newLink"], cut: ["example.com/x"] });
  });

  test("an older player's ordinary link posts as it is, unflagged", () => {
    expect(filterLine("check youtube.com/watch?v=1", OLD, list)).toMatchObject({ shown: "check youtube.com/watch?v=1", flag: false, tags: [] });
  });

  test("a group invite is cut for an older player too, and flagged", () => {
    const out = filterLine("join https://facebook.com/groups/123 now", OLD, list);
    expect(out).toMatchObject({ shown: `join ${LINK_REMOVED} now`, hidden: false, flag: true, tags: ["invite"] });
  });

  test("allowed links are never cut, even from a new player", () => {
    expect(filterLine("news on bymrevamped.com and discord.gg/wthryBRZHz", NEW, list)).toMatchObject({ flag: false, tags: [] });
  });

  test("a new player's watched word hides the line from everyone else", () => {
    const out = filterLine("Hi sino papasok sa private server bmy", NEW, list);
    expect(out).toMatchObject({ hidden: true, flag: true, tags: ["watched", "hidden"], words: ["private server"] });
  });

  test("an older player's watched word posts and flags", () => {
    expect(filterLine("anyone on telegram?", OLD, list)).toMatchObject({ shown: "anyone on telegram?", hidden: false, flag: true, tags: ["watched"] });
  });

  test("a new player's link line with a watched word is hidden and its link cut", () => {
    const out = filterLine("Ito link fb Group ko https://www.facebook.com/share/g/1Bx9kQ/", NEW, list);
    expect(out).toMatchObject({ shown: `Ito link fb Group ko ${LINK_REMOVED}`, hidden: true, tags: ["newLink", "invite", "watched", "hidden"] });
  });

  test("a new player naming BYMR is not hidden, but links are still cut and it is flagged", () => {
    expect(filterLine("may fb group ba ang BYMR?", NEW, list)).toMatchObject({ hidden: false, flag: true, tags: ["watched"] });
    expect(filterLine("revamped fb group t.me/abc", NEW, list)).toMatchObject({ shown: `revamped fb group ${LINK_REMOVED}`, hidden: false });
  });

  test("the game's name inside a link does not count as naming it", () => {
    expect(filterLine("private server t.me/bymr_ps", NEW, list).hidden).toBe(true);
  });

  test("words inside a link do not count as watched words; the link rules cut it", () => {
    expect(filterLine("sali na t.me/bymps", NEW, list)).toMatchObject({ shown: `sali na ${LINK_REMOVED}`, hidden: false, words: [], tags: ["newLink", "invite"] });
    expect(filterLine("join facebook.com/groups/1", OLD, list)).toMatchObject({ words: [], tags: ["invite"] });
    expect(filterLine("sali na t . me/bymps", NEW, list)).toMatchObject({ hidden: true, words: ["t.me"] });
  });

  test("moderators and the game team: not new, never flagged, invites still cut", () => {
    expect(filterLine("private server talk is not allowed", STAFF, list)).toMatchObject({ hidden: false, flag: false });
    expect(filterLine("example.com/x", STAFF, list)).toMatchObject({ shown: "example.com/x", flag: false });
    expect(filterLine("don't join t.me/abc", STAFF, list)).toMatchObject({ shown: `don't join ${LINK_REMOVED}`, flag: false });
  });

  test("a clean line is left alone", () => {
    expect(filterLine("gg sa raid kanina", NEW, list)).toMatchObject({ shown: "gg sa raid kanina", hidden: false, flag: false, tags: [] });
  });

  test("the reason in words for Telegram", () => {
    expect(filterWhy(filterLine("Ito link fb Group ko t.me/x tg", NEW, list))).toBe(
      "group invite link cut; watched words: tg, fb; hidden from others (new player)",
    );
  });
});
