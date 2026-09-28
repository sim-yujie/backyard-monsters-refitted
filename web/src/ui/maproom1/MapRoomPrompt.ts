import { NO_MAP_ROOM_TEXT } from "@/game/maproom/mapRoute";
import { Popup } from "@/ui/Popup";
import { button, el } from "./icons";

/**
 * What the Map button says with no Map Room in the yard (issue #162): there
 * is no map yet, and the one button that gets one. Flash said "You need to
 * build a Map Room first" (`MAPROOM.as:126`, `map_msg_notbuilt`) and left
 * the player to find it; this opens the Build window on its tile.
 */
export const showBuildMapRoom = (container: HTMLElement, onBuild: () => void): Popup => {
  const popup = new Popup({ title: "No map yet", className: "map-prompt" });
  const text = el("p", "map-prompt__text", NO_MAP_ROOM_TEXT);
  const actions = el("div", "map-prompt__actions");
  const build = button("btn btn--primary", "Build Map Room");
  build.addEventListener("click", () => {
    popup.close();
    onBuild();
  });
  const later = button("btn btn--outline", "Not now");
  later.addEventListener("click", () => popup.close());
  actions.append(build, later);
  popup.setContent(text, actions);
  return popup.mount(container);
};
