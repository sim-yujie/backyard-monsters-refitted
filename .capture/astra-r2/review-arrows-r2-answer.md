**NO HIGH OR MEDIUM ISSUES.**

- **D — LOW · pictures 2, 6, 9, 11, 14, 17:** Three discs and a separate plaque give navigation excessive visual weight, especially on phones. Concrete fix: choose E’s existing grouped capsule; shrinking D risks its touch targets.
- **E — LOW · pictures 3, 7, 10, 12, 15, 18:** The middle looks like a position indicator more than a yard-list button. A small disclosure chevron would clarify that action, at the cost of extra clutter.
- **F — LOW · pictures 5, 8, 13, 16, 19:** The expanded panel replaces the whole dock and spans the screen for three actions. A panel anchored near its trigger would reduce that footprint, but constitutes a redesign.

No shown navigation counts overlap or clip. Source inspection confirms targets meet 44 px. Main’s disabled previous arrow is distinguishable in pictures 9 and 10. Modern and Classic retain matching layouts.

The previous fixes landed: F’s resting chevron is present in pictures 4/20 and CSS; its distinct list icon is present in the expanded screenshots and implementation.

**Recommend E.** It provides direct stepping with the least persistent clutter.  
F adds an extra tap and temporarily removes access to the dock.

Owner question: is F’s expanded name an allowed exception to “names stay in the yard list”? Pictures 5, 8, 13, 16 and 19 show that exception explicitly.

TypeScript check passed: `cd web && NODE_OPTIONS=--no-webstorage npx tsc --noEmit -p .`

FIXED:

- None this round; both permitted files remain unchanged.

NOT FIXED:

- Low-severity tradeoffs above: no required repairs; structural changes would redesign the options.
- F’s expanded name: retained as explicitly specified.
- Browser verification: prohibited; review used supplied screenshots and source inspection.
