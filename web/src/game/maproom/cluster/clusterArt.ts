import { artUrl } from "@/artUrl";

/**
 * The painted plaques and crests of map pin clustering, per look (Codex, game-art skill):
 * `crest-home`, `crest-you`, `crest-hostile`, `plaque-alliance`, `plaque-other`, `icon-other`.
 */
export type ClusterArt = "crest-home" | "crest-you" | "crest-hostile" | "plaque-alliance" | "plaque-other" | "icon-other";

export const clusterArtUrl = (classic: boolean, name: ClusterArt): string =>
  artUrl(`/assets/worldmap/cluster/${classic ? "classic" : "modern"}/${name}@2x.webp`);
