import type { EntityManager } from "@mikro-orm/core";

import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { setQuestEventListener } from "../quests/state.js";
import { announceShout } from "./allianceMessages.js";
import { flushAllianceEvents, noteAllianceEvents, runTerritoryTally, setProgressFeed } from "./allianceProgress.js";

/** How often queued goal progress is written. */
const FLUSH_MS = 5_000;
/** How often the daily territory tally is checked (it runs once a UTC day). */
const TALLY_CHECK_MS = 60 * 60_000;

/**
 * Starts the alliance progress machinery (`server.ts`): quest events feed the
 * weekly goals, the feed lines go out as shouts, and the territory tally runs
 * once a UTC day. Returns the stop function.
 */
export const startAllianceProgress = (em: EntityManager): (() => void) => {
  setProgressFeed(async (allianceId, userid, type, body) => {
    const fork = em.fork();
    let author = userid ? await fork.findOne(User, { userid }) : null;
    if (!author) {
      // The tally's lines have no author: the leader's name stands in.
      const alliance = await fork.findOne(Alliance, { id: allianceId });
      author = alliance ? await fork.findOne(User, { userid: alliance.leader_userid }) : null;
    }
    if (author) await announceShout({ allianceId, author, type, body });
  });
  setQuestEventListener(noteAllianceEvents);

  let flushing = false;
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      await flushAllianceEvents(em, getCurrentDateTime());
    } finally {
      flushing = false;
    }
  };
  let tallying = false;
  const tally = async () => {
    if (tallying) return;
    tallying = true;
    try {
      const n = await runTerritoryTally(em, getCurrentDateTime());
      if (n !== null) logger.info(`Alliance territory tally: ${n} alliances`);
    } catch (err) {
      logger.error(`Alliance territory tally failed: ${err}`);
    } finally {
      tallying = false;
    }
  };
  void tally();
  const timers = [setInterval(flush, FLUSH_MS), setInterval(tally, TALLY_CHECK_MS)];
  return () => {
    for (const timer of timers) clearInterval(timer);
    setQuestEventListener(null);
  };
};
