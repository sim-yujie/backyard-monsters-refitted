**Recommend E.** It groups navigation clearly, keeps both arrows available, and works consistently across both looks.

F’s two medium issues are fixed. The suspected undersized travel targets were disproved by CSS inspection: all meet 44 px. No high issues found.

Requested TypeScript check passed. No browser, server, git commands, or screenshot changes.

Owner question: should the prohibition on long yard names also cover F’s expanded travel bar?

FIXED:

- F’s resting tile looked noninteractive (4, 20) → `web/src/proto/b9-arrows-r2.css`: added an upward chevron.
- F’s yard-list action looked like a current-yard destination (5, 8, 13, 16, 19) → `web/src/proto/b9ArrowsR2.ts` and `web/src/proto/b9-arrows-r2.css`: replaced the flag and tiny badge with a prominent list icon inside the existing button.

NOT FIXED:

- D’s visual weight: low severity; changing its three-disc structure would redesign the option.
- F’s expanded name: preserved as explicitly specified.
- Visual verification after edits: not performed because browser use was prohibited.
