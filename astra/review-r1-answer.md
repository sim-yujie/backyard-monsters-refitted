Fixed one HIGH and two MEDIUM findings. Only the two permitted files changed.

`NODE_OPTIONS=--no-webstorage npx tsc --noEmit -p .` passed. Visual verification remains pending; no browser or server was started.

FIXED:

- **HIGH — overlapping preset previews/costs (#6, #9, #14):** `web/src/proto/b9-hcc-r3.css` separates their grid cells, wraps previews, and uses one column at intermediate widths.
- **MEDIUM — clipped editor chips (#7):** same CSS file places phone editor chips on a separate wrapping line.
- **MEDIUM — ambiguous “Empty” action (#4, #7, #15, #17, #19, #24):** `web/src/proto/b9HccR3.ts` changes it to “Clear,” including its accessible name.

NOT FIXED:

- **LOW — filled-row editing lacks a visible cue:** left pending the owner’s preference: add an edit cue to the number, or retain tap-to-discover?
- **Touch-target finding withdrawn:** shared styles already provide 44 px controls for coarse pointers; the screenshots do not establish a defect.