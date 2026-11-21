**A — queue first**

- **HIGH · #4:** Remote editing shows two competing capacities: global “Housing 2,080 / 2,160” and outpost “After: 5,222 / 9,600.” Neither identifies its yard. Bind the top housing strip to the selected yard; label the lower meter “After queue.”
- **HIGH · #1, #4:** The monster catalogue’s second row is cut through its labels by the frame. Give the catalogue its own bounded vertical scroll area with bottom padding and a visible scrollbar; keep Add outside that scroller.
- **MEDIUM · #3:** The yard picker occupies almost the entire working area without an explicit close control. Add a 44px close button to its header and constrain the list with `max-height` and `overflow-y:auto`.
- **MEDIUM · #2:** The drawer shows four saved mixes and “4/5,” but no visible way to save the fifth. Add an empty fifth row with a painted mix icon and “Save queue.”
- **MEDIUM · #1, #2, #4:** “Outposts HCC 3” reads like a destination badge, not a locked feature. Add a lock icon and shorten the label to “HCC 3.”
- **LOW · #2:** Pencil icons are tiny and visually detached from their rows. Give each a clear 44px hit area and align them consistently beside Load.

**B — separate Build and Queue workspaces**

- **HIGH · #5, #6:** Desktop mix tiles cannot hold their content: ingredients disappear beyond tile edges, names collide or truncate, and #6 Load buttons meet the bottom frame. Replace the five-column strip with compact scrolling rows; keep the fifth save slot explicit.
- **HIGH · #6:** Hatchery cards show Bandito and slot numbers but omit the blocked-housing state visible for the same remote situation in #4. Restore a small amber housing icon plus “Full” beneath each monster.
- **HIGH · #8:** The phone catalogue shows only three complete choices, while Max and Add consume two full rows. Put Max beside the quantity controls and reduce surplus vertical padding; use a compact wrapping catalogue so finding monsters requires less horizontal searching.
- **MEDIUM · #7:** Queue cards omit the removal controls present on desktop. Add a 44px minus target to each stack, or make tapping a stack open an explicit quantity editor. Clear all must not be the only visible queue-edit action.
- **MEDIUM · #5, #6:** The promised projected-housing information is absent; remote #6 retains the home capacity at the top. Restore a selected-yard housing meter directly above the queue.
- **LOW · #7:** “Full” does not explain whether the hatchery, queue or housing is full. Use a painted housing icon with “Full”; retain the fuller explanation once above the row.

**C — persistent yard rail**

- **HIGH · #9:** The rail squeezes the catalogue into cards with truncated names and crowded prices; Add is partly hidden by the bottom frame. Reduce the rail width, allow fewer catalogue columns, and reserve a fixed footer for Add.
- **HIGH · #9:** The selected outpost is identified, but the top housing strip still reports the home capacity. Bind it to the selected yard, matching the lower projection.
- **MEDIUM · #9:** The remote return control is only a chevron beside the outpost name; A and B explicitly show Home. Use the painted home icon with a 44px target.
- **MEDIUM · #10:** The yard list fills the phone’s working area, with the final visible row cut at the frame and no scroll cue. Bound the list, add bottom padding and show a scrollbar or subtle bottom fade.

**Recommendation**  
Choose **A**: it keeps queue status, monster selection and Add together without B’s cramped mixes or C’s permanent width penalty.  
Fix selected-yard housing, catalogue scrolling and the missing save slot before polishing either skin.

**Owner decision needed**

Do mix totals and yard badges mean **monster count or housing space**? “140” sits beside a housing icon, but Fang rush’s quantities already sum to 140 monsters. Choose the unit and use the matching icon consistently.
