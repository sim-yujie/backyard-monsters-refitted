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

## Batch b (8 Nov 2026): three options that look nothing like Shiny

Owner, 8 Nov: "make the event coins look more different compared to shiny" (Shiny is a stack of gold coins). One
Codex call (b/prompt.txt; inputs approved.png, style.png and refs/shiny.png, the Shiny icon on white, as "not
like this") painted four tokens; `python -I cut.py b` cut them to large/coinA..coinD.png:

- coinA: copper hexagon token with a monster paw print -> shipped as `eventcoin` (option A, the default)
- coinB: purple and teal gem -> `eventcoinb` (option B)
- coinC: red and gold ribbon medal with a star -> `eventcoinc` (option C)
- coinD: green shield with a silver eye (spare, not shipped)

Each pick was scaled to 512 px on its long side into ../large/ and made with
`python -I web/tools/game-icons/make.py art-samples/event-coin eventcoin,eventcoinb,eventcoinc`.
The game switches between them with `?coin=a|b|c` (web/src/ui/eventCoinArt.ts). The comparison with Shiny is
art-samples/coin-options.png (not in git). Once the owner picks, ship the pick as `eventcoin` and drop the others.
