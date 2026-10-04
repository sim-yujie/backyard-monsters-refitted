import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { EntityManager, PostgreSqlDriver } from "@mikro-orm/postgresql";
import type { Opt } from "@mikro-orm/core";
import { User } from "./user.model.js";
import type { NeighbourData } from "../../types/NeighbourData.js";
import type { TribeData } from "../../types/TribeData.js";
import type { DroppedNeighbour } from "../../services/maproom/neighbourCache.js";

@Entity({ tableName: "maproom" })
export class Maproom {
  @PrimaryKey({ type: "number" })
  userid!: number;

  @Property({ columnType: "jsonb", nullable: true })
  tribedata: Opt<TribeData[]> = [];

  @Property({ columnType: "jsonb" })
  neighbors: Opt<NeighbourData[]> = [];

  @Property({ type: Date, nullable: true })
  neighborsLastCalculated?: Date;

  /** Neighbours dropped today by the daily attack cap; a re-search leaves them out (issue #247). */
  @Property({ columnType: "jsonb" })
  droppedNeighbours: Opt<DroppedNeighbour[]> = [];

  @Property({ type: Date })
  createdAt: Opt<Date> = new Date();

  @Property({ type: Date, onUpdate: () => new Date() })
  lastupdateAt: Opt<Date> = new Date();

  public static setupMapRoomData = async (em: EntityManager<PostgreSqlDriver>, user: User) => {
    const maproom = em.create(Maproom, { userid: user.userid });

    em.persist(maproom);
    await em.flush();
    return maproom;
  };
}
