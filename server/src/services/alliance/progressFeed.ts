import type { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";

import { Alliance } from "../../database/models/alliance.model.js";
import type { AllianceMessageType } from "../../enums/Alliance.js";
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
 * The feed line hook (`setProgressFeed`): a goal, star or trade line goes out
 * as a shout from its member, or from the leader for the tally's lines. It
 * reads and writes through its own fork, never the request's entity manager,
 * which a line said inside a transaction would find already committed
 * ("Transaction is already committed": goal lines lost from beta 7 to 8.2).
 */
export const progressFeedLine =
  (em: EntityManager<PostgreSqlDriver>) =>
  async (allianceId: number, userid: number, type: AllianceMessageType, body: string): Promise<void> => {
    const fork = em.fork();
    let author = userid ? await fork.findOne(User, { userid }) : null;
    if (!author) {
      // The tally's lines have no author: the leader's name stands in.
      const alliance = await fork.findOne(Alliance, { id: allianceId });
      author = alliance ? await fork.findOne(User, { userid: alliance.leader_userid }) : null;
    }
    if (author) await announceShout({ allianceId, author, type, body, em: fork });
  };

/**
 * Starts the alliance progress machinery (`server.ts`): quest events feed the
 * weekly goals, the feed lines go out as shouts, and the territory tally runs
 * once a UTC day. Returns the stop function.
 */
export const startAllianceProgress = (em: EntityManager<PostgreSqlDriver>): (() => void) => {
  setProgressFeed(progressFeedLine(em));
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
