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
- Files: `yard-theme.ogg` (Ogg Vorbis q6, about 180 kbps, 2.9 MB) for most browsers;
  `yard-theme.mp3` (192 kbps, 3.1 MB) for Safari / iPhone.
