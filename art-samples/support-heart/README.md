# "Support the game" heart icon (Codex, 4 Nov 2026)

- optA: heart held in green monster hands -> `support` (used in the game)
- optB: heart with a gold coin -> `support2` (second option for the owner)

Style references (inputs.txt) were the approved painted icons health, shield and levelup from branch
art/game-icons (art-samples/icons/large/). To redo: copy them into refs/, point inputs.txt at them, and run
`bash run.sh optA` (one Codex image call). large/ holds the tight crops; the game files come from
`python -I web/tools/game-icons/make.py art-samples/support-heart support,support2`.
