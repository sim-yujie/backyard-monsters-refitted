import type { User } from "../database/models/user.model.js";
import type { Truces } from "../services/maproom/getTruces.js";

declare module "koa" {
  interface DefaultState {
    /** The cell owners online now (#275, `services/user/online.ts`). */
    online: ReadonlySet<number>;
    truces: Truces;
  }

  interface DefaultContext {
    authUser: User;
    meetsDiscordAgeCheck: boolean;
  }
}

export {};
