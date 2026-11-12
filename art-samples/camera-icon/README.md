# Yard Planner "Yard picture" button: painted camera (Codex, 12 Nov 2026)

Owner 12 Nov: "change 'yard picture' function in planner to a photo icon". One Codex call (a/), four options on
magenta in the style of the planner's other painted buttons (reference a/approved.png: undo, redo, select2, box2,
find, wallupgrade, rearm2, mail, pin, speedup, levelup, shield from web/public/ui/icons at 64 px).

- camera (top left, IN USE): chunky red camera, big blue lens, yellow flash bulb
- camerabox (top right, not shipped): wooden box camera with brass corners
- camera2 (bottom left, shipped as the second option): teal instant camera with a yard photo coming out
- camera3 (bottom right, not shipped): instant photo of a lawn and hut with a dark camera in front

Prompt: ../planner-icons/common-head.txt (the approved-icons line rewritten for this batch) + the four lines
above + ../planner-icons/common-tail.txt. To redo: `bash run.sh a`, `python -I cut.py a`, then from the repo
root `python -I web/tools/game-icons/make.py art-samples/camera-icon camera,camera2`.
Only the scripts and this note are in git; the pictures stay in the worktree (art-samples/.gitignore).
