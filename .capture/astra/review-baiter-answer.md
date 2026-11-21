### A — Baiter HQ

**HIGH**
- **#3, #5 — Mobile title and close are cut at the top; #5 also clips the tab labels vertically and hides Results horizontally.** Add a safe top inset, reserve header height, and keep the header outside the scrolling body. Give the four tabs equal widths with shorter labels.
- **#3 — Army controls consume the viewport, with no launch action visible.** Keep army size and the test-start action in a fixed footer; scroll only the monster grid. Reduce the invitation block to two short lines.
- **#1 — Invite cancellation × controls are much smaller than 44 px.** Put each glyph inside a `44px × 44px` button while retaining the small visual icon.

**MEDIUM**
- **#1, #2, #5 — “Invite” beside “Invites” does not clearly distinguish sending from receiving.** Rename the received tab “Invited me,” consistently across both looks.
- **#5 — The desktop “Invited (3)” management panel has no visible mobile equivalent.** Add a compact “Sent 3” disclosure above the list so existing invitations and cancellation remain discoverable.
- **#1, #5 — “Invite 3” appears beside people already marked “Invited”; the number’s meaning is unclear.** Label the action “Send 3,” and show “3 selected” beside the filters.
- **#4 — Gold left edges on the first two results have no explained meaning.** If these mean unread, use a small dot with an accessible “New result” label; otherwise remove the accent.

### B — Friends desk

**HIGH**
- **#8, #9, #10 — Notices obscure navigation.** On mobile they cover the test subtabs; on desktop the notice covers the main Friends tabs. Position notices outside the dialog or reserve an in-flow notice slot below navigation. Do not overlay interactive tabs.
- **#6 — “Test my yard” spills outside its button and crowds the right border.** Change it to a painted crossed-swords icon plus “Invite,” with an accessible label “Invite to test my yard.” Let the action row wrap into two columns.
- **#8 — Remaining invitation time is reduced to “2..”, “1...” and “4...”.** Put expiry on its own metadata line and prevent truncation. Reduce the Test button’s horizontal padding to recover space.

**MEDIUM**
- **#8, #10 — The first Friends tab is clipped, and two navigation levels plus wrapped filters push content far down.** Keep the selected tab visible with deliberate horizontal scrolling and an overflow cue. Make the three test subtabs one equal-width row.
- **#10 — Result age and battle duration are truncated.** Wrap metadata into a second line instead of applying ellipsis; preserve outcome and damage on the first.
- **#7 — Cancellation × controls are too small.** Use transparent 44 px button boxes.
- **#7, #8, #9, #10 — “Tests 5” has no evident relationship to “Invited me 3” or “Results 9.”** If it means unread activity, make that explicit through a consistent unread-dot/count convention.

**LOW**
- **#8, #9, #10 — Notice actions “Test” and “Watch” look like ordinary text.** Give them compact painted action icons and a visible button treatment.

### Recommendation

**Choose A.** Its single navigation level gives the feature more usable room, and the desktop screens are easier to scan.  
Fix the mobile header and persistent army action before approval; B currently spends too much space on navigation.

### Owner decisions

- Does **Report** open a battle report or report misconduct? The flag suggests misconduct. Choose the matching icon and label.
- Does **“Test my yard”** send an invitation immediately? Its wording currently sounds like it starts a battle.
- What does the **Tests 5** badge count?
- #2 and #4 are described as including notices, but none are visible; A’s notice placement remains unreviewed.
