# Event coin icon (Codex, 7 Nov 2026)

Replaces the script-drawn placeholder (owner rule: icons are painted). One Codex image call painted four coin
options on flat magenta (a/prompt.txt, a/inputs.txt, a/names.txt):

- eventcoin: gold coin with a raised gold star (the builder's brief) -> shipped as `eventcoin`
- eventcoin2: the same coin with a red-orange star (reads best at 16 px; second option)
- eventcoin3: gold star with a ring of raised dots (festival token)
- eventcoin4: gold coin with a raised monster face

Style references (refs/, not in git): approved.png and style.png from art/planner-icons
(art-samples/planner-icons/refs/), the approved painted game icons and resource piles.

To redo: `bash run.sh a` (writes a/sheet.png), `python -I cut.py a` (writes large/<name>.png tight crops), then
copy the pick to ../large/eventcoin.png (512 px on its long side) and from the repo root run
`python -I web/tools/game-icons/make.py art-samples/event-coin eventcoin`.
