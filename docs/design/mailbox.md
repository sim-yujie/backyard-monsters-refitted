# The web mailbox (#193)

The Flash client's mailbox, rebuilt for the web client over the server's mail routes as they
are (`docs/server-api.md`, "Mail / Threads"). No server changes. The owner accepted these ten
defaults on 2026-09-29.

1. **Where it opens.** A Mail button (envelope) on the yard HUD dock, beside Monsters, and one
   in the Map Room 2 tool row. It opens a docked screen like the shop's, a bottom sheet on a
   phone. Opening it closes the other yard panels, and on the map clears the selected cell.
2. **The badge.** It takes `unreadmessages` from the save on every load, and the mailbox's own
   count after a fetch. There is no polling.
3. **The layout.** Two panes, one at a time on a phone. The list is newest first, showing the
   other party, the subject, the first line, the time and an unread dot, with unread rows in
   bold. A thread reads oldest first, in bubbles, with the player's own on the right.
4. **Notices** (`userid` 0, `outpostattacked` / `outposttaken`) are styled as notices. They
   have no reply box and no Block, and offer "Show on map (x, y)", which goes to the cell.
5. **Replies** go into the thread on its subject. They have a 580-character counter, and the
   server's soft refusal (`{ error: 1, message }`) shows under the box, which keeps the text.
6. **New conversations** start only from "Message" on another player's map cell panel (their
   `uid`), or from "New message" to someone already written with (`getmessagetargets`). An
   empty subject is sent as "(no subject)". There is no player search.
7. **Truces** are out of scope. `trucerequest`, `truceaccept`, `trucereject` and
   `migraterequest` messages show as plain text with a label. A separate issue covers the truce
   actions.
8. **No delete or archive.** The server has no route for either.
9. **Block player** (`reportmessagethread`) asks first, then blocks. It is never offered on
   notices.
10. **No server changes.**

## The badge's two counts

The save's `unreadmessages` counts unread *messages*, while the mailbox can only count unread
*threads*: `getmessagethreads` gives one flag per thread, and `getmessagethread` answers with
every message already marked read. So `MailDoor` shows the save's count until the mailbox has
fetched, then the mailbox's thread count, until a load brings a save count that differs from
the last one. The two agree whenever each unread thread holds one unread message. That is
always so for notices, and usually so for players.

## Code

- `web/src/api/mail.ts`: the five routes. `send` turns a refusal or a network failure into a
  reason to show, rather than throwing.
- `web/src/game/mail/mailbox.ts`: pure shaping of the list, threads, contacts and times.
- `web/src/ui/mail/`: `MailButton` (the dock and tool styles), `MailDoor` (button, badge and
  lazy screen), and `MailboxScreen`.
- `web/src/ui/styles/mail.css`: the Mail button's place in the dock, and the screen.
- Hooks: `YardDock.placeBesideMonsters`, `MapRoomUi.placeTool`, and `CellPanel`'s `onMessage`.
