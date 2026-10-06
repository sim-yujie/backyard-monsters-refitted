import Koa, { type Next } from "koa";
import bodyParser from "koa-bodyparser";
import serve from "koa-static";
import ormConfig from "./mikro-orm.config.js";
import router from "./app.routes.js";

import { RedisClient } from "bun";
import { MikroORM, RequestContext } from "@mikro-orm/core";
import { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";
import { logger } from "./utils/logger.js";
import { ascii_node } from "./utils/ascii_art.js";
import { ErrorInterceptor } from "./middleware/clientSafeError.js";
import { jsonBodyCompat } from "./middleware/jsonBody.js";
import { realActionTracker } from "./middleware/realAction.js";
import { processLanguagesFile } from "./middleware/processLanguageFile.js";
import { logMissingAssets, requestLogging } from "./middleware/requestLogging.js";
import { corsCacheControl } from "./middleware/corsCacheControlSetup.js";
import { isStaticPath } from "./utils/staticPaths.js";
import { Env } from "./enums/Env.js";
import { initAnticheat } from "./scripts/anticheat/anticheat.js";
import { initialize as initVersionManifest } from "./config/VersionManifestConfig.js";
import { startChatServer } from "./chat/chatServer.js";
import { exitOnRedisReconnect } from "./utils/redisReconnectGuard.js";
import { economyConfig, economyModeWasUnrecognised } from "./config/EconomyConfig.js";
import { combatConfig, combatModeWasUnrecognised } from "./config/CombatConfig.js";
import { ownerSaveConfig, ownerSaveModeWasUnrecognised } from "./config/OwnerSaveConfig.js";
import { startAttackFinaliser } from "./services/base/finaliseAttack.js";
import { turnstileSecretKey } from "./services/auth/turnstile.js";
import { requiresDiscordVerification } from "./config/AccountConfig.js";
import { botConfig } from "./config/BotConfig.js";
import { PRESENCE_TTL_SECONDS } from "./controllers/maproom/presence.js";
import { clientIp } from "./middleware/clientIp.js";
import { trustedProxies } from "./config/ProxyConfig.js";

// `ctx.ip` comes from the clientIp middleware, which believes CF-Connecting-IP
// only from a trusted proxy (issue #214), so Koa's own proxy trust stays off.
export const app = new Koa();

export const PORT = process.env.PORT || 3001;
export const BASE_URL = process.env.BASE_URL;

export const postgres = {} as {
  orm: MikroORM<PostgreSqlDriver>;
  em: EntityManager<PostgreSqlDriver>;
};

export const redis = new RedisClient(process.env.REDIS_URL);

exitOnRedisReconnect(redis, "Redis", () => logger.info(`Connected to Redis server`));

redis.onclose = (err) => logger.error(`Redis disconnected: ${err.message}`);

// Initialize MikroORM, Redis, and start the Koa server
(async () => {
  postgres.orm = await MikroORM.init<PostgreSqlDriver>(ormConfig);
  postgres.em = postgres.orm.em;

  if (process.env.ENV !== Env.PROD) {
    try {
      await postgres.orm.migrator.up();
      logger.info("Database migrations applied");
    } catch (err) {
      logger.error(`Database migration failure: ${err}`);
    }
  }

  await redis.connect();

  startChatServer();

  app.use(clientIp());
  app.use(corsCacheControl);
  app.use(bodyParser({ enableTypes: ["json", "form"], jsonLimit: "8mb", formLimit: "8mb"}));

  // Flattens a native JSON body to the flat, string-field shape every schema
  // and service downstream expects. A form body never reaches it (issue #28).
  app.use(jsonBodyCompat);

  app.use((_, next: Next) => RequestContext.create(postgres.orm.em, next));

  // Logs
  app.use(logMissingAssets);
  if (process.env.ENV !== Env.LOCAL) app.use(requestLogging);

  // Serve static files
  app.use(processLanguagesFile);

  const staticFiles = serve("public/");
  app.use((ctx, next) => isStaticPath(ctx.path) ? staticFiles(ctx, next) : next());

  process.on("unhandledRejection", (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`);
  });

  app.use(ErrorInterceptor);

  // A player's real game actions, which keep them online (#271, `services/user/realActions.ts`).
  app.use(realActionTracker());

  // Routes
  app.use(router.routes());
  app.use(router.allowedMethods());

  await initVersionManifest();
  await initAnticheat();

  // Finishes attacks whose window closed without a save (issue #138).
  // `ATTACK_FINALISER_SWEEP=off` leaves the sweep to another server sharing
  // the same database, such as a second development server.
  if (process.env.ATTACK_FINALISER_SWEEP !== "off") startAttackFinaliser();

  // The bot sweep (issue #240): grows, repairs and rebalances Map Room 1 bots.
  // Off unless BOTS_BRAIN=on, and then not even loaded, so a server without
  // bots runs exactly as before; a failure to start it never stops the server.
  if (botConfig().brain) {
    try {
      const { startBotSweep } = await import("./services/bots/sweep.js");
      // Revenge attacks (issue #244) run only while BOTS_REVENGE is on too.
      const { runRevengeAttack, seenRecently } = await import("./services/bots/revengeRun.js");
      startBotSweep({
        em: postgres.em,
        markOnline: async (userid, now) => {
          await redis.setex(`last-seen:main:${userid}`, PRESENCE_TTL_SECONDS, String(now));
        },
        revenge: { isOnline: seenRecently, attack: (input) => runRevengeAttack(input) },
      });
      logger.info(`Bot sweep (BOTS_BRAIN): on; revenge (BOTS_REVENGE): ${botConfig().revenge ? "on" : "off"}`);
    } catch (err) {
      logger.error(`Bot sweep could not start: ${err}`);
    }
  }

  // Say which economy audit mode is live, once, at boot: `log` and `reject`
  // behave very differently for a player and the variable is read only here
  // (docs/design/economy-save-validation.md §3.2).
  if (economyModeWasUnrecognised) {
    logger.warn(
      "ECONOMY_SAVE_VALIDATION is set to {requested}, which is not a mode - falling back to {mode}",
      { requested: process.env.ECONOMY_SAVE_VALIDATION, mode: economyConfig.mode }
    );
  }

  logger.info(`Economy save validation: ${economyConfig.mode}`);

  if (combatModeWasUnrecognised) {
    logger.warn(
      "COMBAT_SAVE_VALIDATION is set to {requested}, which is not a mode - falling back to {mode}",
      { requested: process.env.COMBAT_SAVE_VALIDATION, mode: combatConfig.mode }
    );
  }

  logger.info(`Combat save validation: ${combatConfig.mode}`);

  if (ownerSaveModeWasUnrecognised) {
    logger.warn(
      "OWNER_SAVE_MODE is set to {requested}, which is not a mode - falling back to {mode}",
      { requested: process.env.OWNER_SAVE_MODE, mode: ownerSaveConfig.mode }
    );
  }

  logger.info(`Owner main-yard saves: ${ownerSaveConfig.mode}`);

  // The sign-up gates (issue #213), said once so a server missing its keys is obvious.
  if (turnstileSecretKey()) {
    logger.info("Sign-up bot check (Turnstile): on");
  } else {
    logger.warn(
      "Sign-up bot check (Turnstile): OFF - TURNSTILE_SECRET_KEY is not set, so sign-ups are not checked for bots"
    );
  }

  logger.info(
    `Discord verification: ${
      requiresDiscordVerification()
        ? `required${process.env.ENV === Env.PROD ? "" : " (production only; not enforced here)"}`
        : "not required"
    }`
  );

  // Who may name a player's IP (issue #214). A server behind another proxy that
  // is not listed sees every player as that proxy's address.
  if (trustedProxies.rejected.length) {
    logger.warn("TRUSTED_PROXIES entries ignored, not an address or range: {rejected}", {
      rejected: trustedProxies.rejected.join(", "),
    });
  }

  logger.info(
    `Client IP: ${
      trustedProxies.entries.length
        ? `CF-Connecting-IP from ${trustedProxies.entries.join(", ")}, otherwise the connecting address`
        : "the connecting address (no trusted proxies)"
    }`
  );

  app.listen(PORT, () => {
    console.log(`
${ascii_node}
Server running on: ${BASE_URL}:${PORT}
    `);
  });
})().catch((e) => {
  logger.error(`Startup failed: ${e}`);
  process.exit(1);
});
