The phone Baiter currently hides the bottom actions and clips its title. Fix the window structure first: **fixed title, tabs and bottom action bar; only the middle list scrolls.** All three directions below use that structure.

Shared rules: painted monster, envelope, flag, hourglass and replay pictures—not outline icons. Modern uses steel/gold; Classic uses parchment/wood with identical geometry. Every control has a 44 px minimum target. Names wrap instead of truncating.

## A — Baiter headquarters
**All inviting, incoming challenges and test results live in the Baiter.**

**Desktop:** A centred 1,100 × 650 px window. Below a 52 px title bar, four 48 px tabs: **Army / Invite / Invites / Results**, each with a painted picture. “Invite” has a 280 px people picker on the left and active invitations on the right. Friends/Alliance filters, search and selection count stay above the scrolling picker. Each 60 px player row shows portrait, full name and checkbox; an envelope button in the fixed footer sends to all selected. Active rows show name, hourglass + “18h”, and a 44 px cancel control.

**390 × 844:** Window fills the available screen with 8 px margins. Title 52 px; tabs 48 px; footer 64 px. Invite switches between **Choose / Active** beneath the tabs, avoiding side-by-side panes. Player rows are 64–80 px. Army cards become compact full-width rows: portrait/name, level, quantity and painted Fill control. Cap meter and champion stay above the fixed Start button.

**844 × 390:** Two-column army list; Invite uses desktop’s split layout. Fixed chrome leaves the centre scrollable.

**Flow:**
1. Owner opens Baiter → Invite → selects Friends/Alliance → sends. People in both groups appear once.
2. Friend gets a painted envelope notice and badge on Baiter. It opens Invites; choosing the owner opens **“Test [name]”**, showing the owner’s portrait and cap.
3. Friend builds a free army → Start → sees damage/result with **Again / Watch / Report**.
4. Owner’s notice opens Results, separate from defence replays. A fixed player filter narrows the list. Rows show attacker, relative time, result and damage; painted replay/report buttons act on that test.

**Main risk:** Four tabs mix personal testing, hosting and incoming invitations; users must learn the distinction between Invite and Invites.

## B — Friends challenge desk
**Invitations belong to people; Baiter remains the army builder.**

**Desktop:** Expand Friends to 880 × 620 px. Three picture-led tabs: **People / Invites / Tests**. People has a 300 px searchable Friends/Alliance roster and a detail pane. A painted Baiter horn joins Visit, Message and Gift in the selected friend’s actions. A fixed **Invite several** control turns the roster into a checkbox picker; the detail pane shows selected recipients.

**390 × 844:** Friends becomes a 374 px-wide window with fixed title, three 48 px tabs and 64 px footer. People shows one scrolling roster. Tapping someone opens their action sheet; the horn is a full-width 44 px action labelled **Test my yard**. Bulk selection replaces the action sheet with checkboxes and a fixed envelope + selected count.

Invites has **Received / Sent** filters. Sent rows show portrait, name, time left and Cancel. Tests has **My yard / My attacks**, plus a player filter. Owner result cards are approximately 104 px tall: portrait/name/time first, result/damage second, 44 px Watch and Report controls below.

**844 × 390:** Roster and details sit side by side; result rows put Watch/Report at the right. Army opens in a two-column Baiter window.

**Flow:**
1. Owner invites one person from their actions, or several through the roster. Baiter has a horn shortcut opening this picker.
2. Friend receives a notice; Friends gets a badge. Received invitations show owner, remaining time and **Test**.
3. Test opens the existing army builder with inviter identity, inviter’s cap and fixed Start footer.
4. Afterward, friend gets **Again / Watch / Report**. Owner’s notice opens Friends → Tests → My yard, filtered to the new result. Visiting an inviting owner also reveals a painted Test horn.

**Main risk:** Friends becomes a broader social window; the Baiter shortcut must make discovery obvious.

## C — Yard challenge board
**Treat every owner’s yard as a challenge page with its own invitation roster and test history.**

**Desktop:** Baiter opens a 960 × 620 px board: owner portrait/name and cap at top; **Army / Guests / Tests** tabs below. Guests contains the searchable multi-select picker and active invitations. Tests groups results by attacker, expandable into individual attempts.

**390 × 844:** Same tabs and fixed footer. Each attacker group shows portrait/name, latest attempt and test count; expanding reveals chronological result cards with time, outcome, damage, Watch and Report. Guests switches between Choose and Active.

**844 × 390:** Two-column Guests; compact full-width test rows.

**Flow:**
1. Owner opens their board → Guests → selects recipients → sends; Active shows timers and Cancel.
2. Notice takes the friend directly to that owner’s board. A Friends invitation badge lists all available boards; visiting the yard exposes the same horn.
3. Army tab uses the owner’s cap → Start → result → Again.
4. Owner receives a notice opening that attacker’s expanded Tests group.

**Main risk:** Grouping hides the global sequence of attempts; frequent testers can dominate individual groups.

**Recommended: B.** People selection, invitations and follow-up belong naturally in Friends.  
Keep Baiter focused on building armies, with a prominent invitation shortcut.  
It handles dozens of contacts while giving test results a clearly separate home.

**Owner decisions still needed:**

- Do tests use the live yard or a snapshot taken when invited?
- How long are invitations’ results and replays retained?
- Does cancellation stop a test already underway?
- Which champion/monster levels are available to the tester?
- Notify for every attempt, or bundle repeated tests by player?
