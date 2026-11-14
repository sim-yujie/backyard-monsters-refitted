#!/bin/bash
# Real night-sky stars (owner 12 Nov: "more realistic looking stars, not cartoon or game star icons").
# Drawn procedurally, no Codex: core + coloured bloom + halo + diffraction spikes, added as light and tone-mapped.
# Run from this folder.
python render_stars.py out          # r1 (4 spikes), r2 (6 spikes, Webb), r3 (soft bloom), + dust@2x.png
python compose_real.py .            # real-options-real-size.png, real-<o>-3x.png, real-count-rows.png
# Chosen: r1 + dust -> web/public/ui/stars/ star-lit-{blue,white,gold}, star-next, star-dim,
# star-{lit,dim}-small (@2x.webp, lossless) and sky-dust@2x.webp.
