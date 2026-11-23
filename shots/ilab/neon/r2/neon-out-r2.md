### High

1. **Contradictory rank and active-research state** (all `r2-*-lab.png`, e.g. [r2-d1280-modern-lab.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/neon/r2/r2-d1280-modern-lab.png) — Lab slot, Sabnox list row, selected monster card): Sabnox shows `Rank 3/3`, `rank 3 of 3`, and `Fire: 30% of the hit a second for 4 s (top rank)` while simultaneously showing `Burn → rank 1`, `Researching → 1 · 2d 23h`, and `Researching rank 1: ready in 2d 23h.`
   - **Fix:** Derive row/card rank and effect from the monster's actual pre-research rank (showing `Rank 0/3` and `Fire: none → 10% of the hit a second for 4s` while researching rank 1), and prevent starting/displaying research on a maxed (`3/3`) monster.

2. **Severe clipping on phone landscape** ([r2-phoneL-modern-lab.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/neon/r2/r2-phoneL-modern-lab.png), [r2-phoneL-classic-lab.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/neon/r2/r2-phoneL-classic-lab.png) — list row & selected monster card): The pinned Lab slot leaves ~65 px below it, clipping off Sabnox's row icon/name/status and cutting off the detail card below `Burn · rank 3 of 3` (effect, status/CTA, flavor text).
   - **Fix:** On short landscape viewports, make the Lab tab body scroll as one vertical container (so the Lab slot scrolls out of the way) with a usable min-height for the list/card split, and align auto-scroll to the top of the selected row.

### Medium
None.

### Low

1. **Orphaned unit wrap `"4 / s"`** ([r2-ipadP-classic-lab.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/neon/r2/r2-ipadP-classic-lab.png) selected card; [r2-phoneL-modern-lab.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/neon/r2/r2-phoneL-modern-lab.png) list row): `for 4 s` splits across lines.
   - **Fix:** Format as `4s` (matching `2d 23h`) or use a non-breaking space (`4\u00A0s`).
2. **Unitless stat in Grokus wording** ([r2-d1920-modern-lab.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/neon/r2/r2-d1920-modern-lab.png) — Grokus list row): `reach 80` has no unit.
   - **Fix:** Specify units or plain scale (e.g., `80 px radius` or tile equivalent).
3. **Inconsistent researching label** ([r2-d1280-modern-lab.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/lab-build/shots/ilab/neon/r2/r2-d1280-modern-lab.png) — Sabnox list row): Uses `Researching → 1 · 2d 23h` instead of `Rank` phrasing.
   - **Fix:** Change to `Researching rank 1 · 2d 23h` to match the card and idle rows.
EXIT 0
