# Events page icons (Codex, 8 Nov 2026)

The Events page drew line icons for a speed-up (a clock), a store boost (a wrench) and the Events button (a Halloween
pumpkin); owner rule: in-game icons are painted. One Codex image call painted all four on flat magenta
(a/prompt.txt, a/inputs.txt, a/names.txt):

- speedup: a gold stopwatch zooming right with cyan speed streaks (calendar speed-ups)
- overdrive: a steel cog with a lightning bolt and flames (Production Overdrive)
- event: a red calendar with a gold star and a ribbon rosette (the Events button; suits every event)
- tools: a crossed wrench and hammer (Sharper Tools and other store boosts)

Style references (refs/, not in git): approved.png, twelve of the game's approved painted icons from
web/public/ui/icons/*-64.webp enlarged to 176 px on white, and style.png, the four resource piles
(server/public/assets/popups/resource*.png).

To redo: `bash run.sh a` (writes a/sheet.png), `python -I cut.py a` (writes large/<name>.png tight crops), then from
the repo root `python -I web/tools/game-icons/make.py art-samples/events-icons speedup,overdrive,event,tools`.
