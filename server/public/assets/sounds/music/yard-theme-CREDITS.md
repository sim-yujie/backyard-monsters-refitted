# Yard theme (yard-theme.ogg, yard-theme.mp3)

The tune that plays in the player's yard, chosen by the owner on 2026-10-25 (take "B1").
It replaces Flash's `Music_Building.mp3`, which stays in this folder in case it has to come back.

- Made with: ACE-Step 1.5, model `acestep-v15-sft` (2B SFT) with planner `acestep-5Hz-lm-1.7B`.
  Licence: MIT (c) 2026 ACEStep.
- Settings: seed 1112, 50 steps, CFG (guidance) 7.0, shift 3.0, 112 BPM, F major, 4/4, 170 s generated.
- Prompt: "cheerful cartoon video game town theme, playful and mischievous, marimba lead melody,
  pizzicato strings, bassoon and tuba bouncy bass, clarinet countermelody, light woodblock and shaker,
  warm and bright, crisp clean mix, sparse, catchy hummable tune, seamless loop, no vocals".
  Sections: main theme (marimba), main theme (clarinet answers), softer bridge (pizzicato), main theme return.
- After: cut to a 136.5 s loop on whole bars with a one-beat crossfade at the seam
  (`tools/audio-gen/scripts/post.py`), -16 LUFS, peak -1.6 dB.
- Files (re-encoded 2026-10-28 from the same 24-bit loop master, `tools/audio-gen/samples/yard-theme-quality/B1-full-model.flac`,
  for the Quality setting): `yard-theme.ogg` (Ogg Vorbis, 112 kbps, 1.8 MB) for most browsers and `yard-theme.mp3` (112 kbps, 1.9 MB)
  for Safari / iPhone, on High; `yard-theme-lite.ogg` / `yard-theme-lite.mp3` (64 kbps, 1.0 / 1.1 MB) on Medium and Low.
  Before that they were 192 kbps (3.1 MB).
