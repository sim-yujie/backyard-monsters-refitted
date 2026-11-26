Picture scripts for the Classic tier plates (branch feat/classic-tier-plates). Shots go to .capture/shots (not committed).
- `bun levels.ts`: sets yardtester's tower levels in tier_build_db so every tiered tower shows tiers 1, 2, 3.
- `node shoot.mjs classic <tag> home,phone,crops,attack,patk,inferno,icrops,iphone` (server 3391 with INFERNO_ENABLED=on, vite 5391).
- `python3 sheet.py shots/<tag> out.png [inf]`: one row per tower type, tiers 1 | 2 | 3.
