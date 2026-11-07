# Profile window stat icons (Codex, 7 Nov 2026)

The profile window showed line icons for Town Hall, Empire points, Friends and Alliance; owner rule: in-game icons
are painted. One Codex image call painted all four on flat magenta (a/prompt.txt, a/inputs.txt, a/names.txt):

- townhall: the game's domed Town Hall (riveted dome, blue portholes, horn antenna, red pipe legs)
- empire: a gold crown with a ruby and small blue and green gems
- friends: two smiling monster heads cheek to cheek (green horned, purple furry one-eyed)
- alliance: the game's alliance emblem as a painted crimson shield with a gold diagonal stripe and steel rim

Style references (refs/, not in git): approved.png and style.png from art/planner-icons
(art-samples/planner-icons/refs/), plus townhall.png (server/public/assets/buildingbuttons/14.5.jpg) and
alliance.png (server/public/assets/alliances/10_large.png), both enlarged 2x/3x.

To redo: `bash run.sh a` (writes a/sheet.png), `python -I cut.py a` (writes large/<name>.png tight crops), then from
the repo root `python -I web/tools/game-icons/make.py art-samples/profile-icons townhall,empire,friends,alliance`.
