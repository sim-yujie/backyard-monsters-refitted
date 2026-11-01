# Where the baseline comes from

- Commit `6fcfc1211` on `art/buildings-3d-academy` ("Monster Academy 3D round 7b"), tagged
  `academy-3d-baseline-2026-11-01`. The previous version (face-on level 2 back windows) is `bc0aa6a54`.
- `render/L<n>-base.png`, `-alone.png`, `-parts-00.png`: copied unchanged from
  `art-samples/buildings-b6/academy-v1/render/` (git-ignored there), rendered 1 Nov 2026 between 09:22 and 10:28 (+08:00)
  with that commit's `academy.py` in Blender 5.2.3, OptiX on an RTX 3070.
- `L<n>-3d.png`: `render/L<n>-base.png` with `render/L<n>-parts-00.png` laid over it (`post.frame3d(n, 0)`).
- `academy-levels.png`, `academy-levels-clean.png`, `academy-game.png`, `L<n>-side.png`, `L<n>-anim.mp4`: the files
  committed in `academy-v1/` at `6fcfc1211`, copied unchanged.
