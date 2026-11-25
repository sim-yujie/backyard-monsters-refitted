import { artUrl } from "@/artUrl";

/**
 * The painted plaques and crests of map pin clustering, per look (Codex, game-art skill):
 * crests, plaques and their icons.
 */
export type ClusterArt =
  | "crest-home"
  | "crest-you"
  | "crest-hostile"
  | "plaque-alliance"
  | "plaque-other"
  | "icon-other"
  /** The generic blue/silver alliance shield, for an alliance with no picture of its own. */
  | "shield-alliance";

export const clusterArtUrl = (classic: boolean, name: ClusterArt): string =>
  artUrl(`/assets/worldmap/cluster/${classic ? "classic" : "modern"}/${name}@2x.webp`);
