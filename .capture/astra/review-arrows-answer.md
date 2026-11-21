**A — arrows beside the yard flag**

- **MEDIUM — Pictures 1, 4, 7:** The unlabeled flag does not clearly advertise the full yard list. The “11” badge could mean alerts, level or yard count. Add a small downward chevron inside the flag button; give it an accessible label such as “All yards, 11 total.”
- **LOW — Picture 1:** The flag sits lower than its arrows, making the group look uneven. Align all three button centres on one horizontal axis; keep the yard name centred beneath the group.

The arrows’ relationship to the current yard is otherwise clear, and Friends remains directly accessible.

**B — arrows beside Map**

- **HIGH — Pictures 2, 5, 8:** Prev/Next appear to belong to Map or the bottom navigation, rather than the current yard. A first-time player could reasonably expect them to change map pages. Move both arrows alongside the yard flag and put the yard name beneath that group—effectively A. Labels alone do not fix the grouping.
- **MEDIUM — Picture 2:** At the stated 390 px viewport, the Prev and Next label plates almost touch neighbouring plates. The bottom row reads as a crowded strip. Give each item at least a 4 px horizontal gap and reduce label padding independently of the touch area.
- **LOW — Pictures 2, 5, 8:** Written Prev/Next labels repeat what the painted arrows already communicate, while adding visual weight to secondary actions. Remove those visible labels once the arrows are grouped with the yard selector; retain accessible names.

**C — flag opens a tray**

- **MEDIUM — Pictures 3, 6, 9:** The open flag becomes grey and subdued. That reads as disabled rather than “this tray is open,” especially beside the warm active controls. Keep the normal border and add a gold inset ring or a small upward chevron; use `aria-expanded="true"`.
- **MEDIUM — Pictures 3, 6, 9:** The tray has no visible attachment to its trigger. In picture 6 it resembles a separate window floating over the yard. Add a small pointer on the tray edge facing the flag, using an absolutely positioned pseudo-element.
- **MEDIUM — Pictures 3, 6:** The tray takes substantial space for three actions: roughly 280 × 120 CSS px in portrait. Reduce outer padding and vertical icon-to-label spacing while retaining 44 px hit areas. Keep “All yards”; the two arrow labels can go.
- **LOW — Pictures 3, 6, 9:** The painted flag in the tray and the white outline flag beneath it look like different features, although both concern yard selection. Reuse the painted flag for the trigger, with an expansion chevron distinguishing its role.

**Shared touch-target issue**

- **MEDIUM — Pictures 7, 8, 9:** Help and hourglass circles are visibly about 35 px across, below the 44 px requirement. Their actual hitboxes cannot be verified from screenshots. Ensure each has a centred 44 × 44 px interactive area; increase spacing enough to prevent those areas overlapping.

**Recommendation**

Choose **A**: it makes yard stepping immediately understandable, keeps Friends visible, and occupies less space than an open tray.  
Align the portrait controls and clarify that the centre flag opens the yard list.

**Owner decisions**

- Is yard stepping frequent enough to deserve permanently visible controls? A suits frequent use; C trades an extra tap for a quieter closed layout.
- What exactly does “11” mean? If it is yard count, expose that meaning in the selector’s accessible name and list heading.
- If C remains a contender, should tapping the active flag or outside the tray close it? The pictures provide no explicit dismissal cue.
