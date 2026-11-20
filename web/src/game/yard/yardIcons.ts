import { Assets, Sprite, type Container, type Texture } from "pixi.js";
import { gameIconUrl, type GameIconName } from "@/ui/gameIcon";

/**
 * The game's painted icons (`ui/gameIcon.ts`, `public/ui/icons/`) on the
 * yard's canvas: the friends' two critters on a job's helper badge, the
 * crossed tools on a friend's wrench (beta 8). Each file is fetched once;
 * a layer draws its own simple shape until the picture is in, and keeps it
 * if the picture never comes.
 */

const textures = new Map<string, Promise<Texture | null>>();

/** One icon's 64 px picture, or null when it cannot be had. */
export const yardIconTexture = (name: GameIconName): Promise<Texture | null> => {
  let pending = textures.get(name);
  if (!pending) {
    pending = Assets.load<Texture>(gameIconUrl(name, 64)).then(
      (texture) => texture ?? null,
      () => null,
    );
    textures.set(name, pending);
  }
  return pending;
};

/**
 * Puts a painted icon, `size` world px square and centred on (`x`, `y`), in
 * `parent` once its picture is in, and hides `fallback` then. Nothing
 * happens if the parent was destroyed meanwhile.
 */
export const paintIcon = (
  parent: Container,
  name: GameIconName,
  size: number,
  at: { x: number; y: number },
  fallback: Container | null,
): void => {
  void yardIconTexture(name).then((texture) => {
    if (!texture || parent.destroyed) return;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = size;
    sprite.height = size;
    sprite.position.set(at.x, at.y);
    sprite.eventMode = "none";
    if (fallback && !fallback.destroyed) fallback.visible = false;
    parent.addChild(sprite);
  });
};
