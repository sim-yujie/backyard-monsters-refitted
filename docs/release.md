# Releases

Everyday work goes on `revamp`. Pushing `revamp` never changes anything live:
neither Vercel project (`bymrevamped` = game page, `bymrevamped-site` = info
site) is connected to GitHub, and the game server is a hand-made copy. Things
go live only by hand, only at a release, and only from the `release` branch.

A release happens only when the owner says "release". Versions are tagged
`v2.0.0-beta.1`, `v2.0.0-beta.2`, ... (`v2.0.0-beta.1` = what was live on
2026-10-12, commit `6393b43f`).

## Making a release (version N)

1. Bring `revamp` into `release` with a merge (not a rebase), in a fresh
   worktree on `release`:
   `git merge --no-ff origin/revamp`
2. Run the checks: in `web/` vitest, `tsc`, `eslint`; in `server/` `bun test`.
   Fix anything that fails on `revamp` first, then merge again.
3. Look at it in a browser locally (log in, base, one attack).
4. Write `docs/releases/v2.0.0-beta.N.md`: a short list, in plain words, of
   what changed for players. Commit it on `release`.
5. Tag and push (never force-push):
   `git tag -a v2.0.0-beta.N -m "Release N"`
   `git push origin release v2.0.0-beta.N`
6. Go live, all from this `release` checkout at the tag:
   - **Game server**: follow "Updating without GitHub" in `docs/deploy.md`
     (backup, copy the code with `git archive ... release`, rebuild).
   - **Game page**: from `web/`, `vercel deploy --prod` (project
     `bymrevamped`, scope `sim-yujies-projects`).
   - **Info site**: fast-forward the `wt-site` worktree to `release`
     (not `revamp`), then run `vercel deploy --prod` from `wt-site/site`
     (project `bymrevamped-site`).
7. Merge `release` back into `revamp` so the two do not drift:
   `git merge --no-ff release` on `revamp`, push.

Never deploy by hand from `revamp` or a feature branch.
