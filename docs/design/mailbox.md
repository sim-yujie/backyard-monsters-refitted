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
7. **Truces** were left out of #193 and came with #203 (below), and invitations to move
   with #205 (below).
8. **No delete or archive.** The server has no route for either.
9. **Block player** (`reportmessagethread`) asks first, then blocks. It is never offered on
   notices.
10. **No server changes** for #193. #203 made small ones (below).

## The badge's two counts

The save's `unreadmessages` counts unread *messages*, while the mailbox can only count unread
*threads*: `getmessagethreads` gives one flag per thread, and `getmessagethread` answers with
every message already marked read. So `MailDoor` shows the save's count until the mailbox has
fetched, then the mailbox's thread count, until a load brings a save count that differs from
the last one. The two agree whenever each unread thread holds one unread message. That is
always so for notices, and usually so for players.

## Truces (#203)

The owner's decisions of 2026-09-30, and the defaults they accepted.

- **Proposed from two places.** "Propose truce" in a player thread's header sends
  `sendmessage` `trucerequest` into that thread. "Truce" on another player's cell panel on the
  map (beside Message, hidden while a truce with them runs) sends `requesttruce { baseid,
  message }`, which starts a new thread. Both open a form in the mailbox, with Flash's own words
  to start from ("Accept my truce and we can end all this needless bloodshed.").
- **Answered on the request.** The thread's last `trucerequest` carries a card: "Truce
  request", its state and what it means. The recipient gets Accept and Reject while it waits.
  They send what the reply box holds, else Flash's "I accept your truce." / "I reject your
  truce.". The thread list tags the thread by its truce, as Flash's inbox did.
- **States.** Waiting (blue), Active (green, "until 7 Oct (6 days left)"), Rejected (red),
  Ended and Lapsed (grey). They come from the thread list's `trucestate` and `truceexpire`,
  and the clock.
- **Rules** (`server/src/services/mail/truceRules.ts`). An accepted truce lasts 7 days (the owner's
  rule; Flash had 14), and while it does neither player can attack any base of the other's,
  main yard or outpost. The attack load refuses it (`truceActiveErr`), and the map already
  showed it: the cell's `t` shades the cell, puts a Truce countdown on the panel and disables
  Attack. A request waits 7
  days for its answer, then lapses: it can no longer be answered, and it no longer stands in
  the way of a new request. A pair has at most one live truce. The proposer cannot withdraw a
  request. After a rejection, the one who asked waits 2 days before asking that player again
  (Flash Map Room 1's rule): the server refuses softly, `{ error: 1, message, retryat }`, the
  message saying when; the web shows it under the box, hides "Propose truce" in that thread
  and says on the card when they may ask. The other player may ask at once. There are no truces
  in Inferno. An attack already under way when a truce is accepted plays out.
- **After Accept** the Map Room 2 scene refetches its visible zones, so the new truce shows on
  the map without a reload.
- **The server's part.** `getmessagethreads` gives `truceexpire`; `requesttruce` answers with
  its `threadid`, checks blocks, filters the message and accepts only a player's yard; a
  duplicate request is a 409 with its reason, and so is an answer to a request that is over
  (`truceExistsErr`, `truceClosedErr`); the lapse applies everywhere a live truce is looked up.
- **Reuse for #205.** `ui/mail/RequestCard.ts` is the request card with no truce in it: a
  title, a state and its tone, a sentence, and buttons whose actions answer null or a reason.
  An invitation to move can use it with its own words and buttons (Accept, Decline, View).

## Invitations to move (#205)

The owner's decisions of 2026-09-30 (issue #205), and the defaults the lead accepted.

- **Sent from the map.** "Invite to move here" on the player's own outpost's panel, to a past
  contact; "Invite to my outpost" on another player's panel, onto one of the player's
  outposts, picked when there are several (hidden while the player has none, or the other is
  in an alliance). Both open a form in the mailbox with Flash's own words ("Let's Join
  Forces", "Move your main yard next to mine and we can work together to dominate the world
  map!") and a box to tick: "If they accept, this outpost and everything on it is replaced by
  their yard." It goes as `sendmessage` `migraterequest` with the outpost's `baseid`, in a new
  thread.
- **Answered on the invitation.** Its card, "Invitation to move", gives the one invited Accept,
  Decline and View on map, and the one who invited Withdraw (also on the outpost's panel,
  "Withdraw invite", with an "Invite pending" chip). Accept turns the card into the price
  choice, 10,000,000 of each resource or 1,200 Shiny; one press pays and moves, with no
  further confirm. Withdraw posts Flash's "Never mind." (or what the reply box holds) into
  the thread. The thread list tags the thread by its invitation.
- **States.** Waiting (blue), Accepted (green), Declined (red), Withdrawn, Lapsed and Void
  (grey), from `migratestate` and `migrateexpire`.
- **Rules** (`server/src/services/mail/inviteRules.ts`). Same world and Map Room 2 only; the one
  invited may not be in an alliance, and pays; the relocation cooldown applies to them. Their
  own outposts stay theirs and their old home cell goes wild. The inviter gets nothing: the
  outpost, its buildings and housed monsters are gone, and the game tells them of the answer
  (`inviteaccepted`, `invitedeclined` notices). An outpost holds one invitation waiting; it
  lapses after 7 days, and is void once the outpost changes hands. Everything is checked again
  at accept; a soft refusal ("You must first leave your Alliance to accept this invitation.")
  shows on the card and leaves the invitation open.
- **On the map.** The player's own outpost with an invitation waiting wears an amber dot on its
  marker (Flash's `mcInvite`), which only they see; the cell's `pi` is the invitation's
  thread. After an accept, Map Room 2 refetches its zones and its own cell; the yard refreshes
  its pool.

## Code

- `web/src/api/mail.ts`: the six routes. `send` turns a refusal or a network failure into a
  reason to show, rather than throwing.
- `web/src/game/mail/mailbox.ts`: pure shaping of the list, threads, contacts and times.
- `web/src/game/mail/truce.ts`: a thread's truce state, its card's words, and the list's tag (#203).
- `web/src/game/mail/invite.ts`: an invitation's state, its card's words, and the list's tag (#205).
- `web/src/ui/mail/`: `MailButton` (the dock and tool styles), `MailDoor` (button, badge and
  lazy screen), `MailboxScreen`, and `RequestCard` (#203).
- `web/src/ui/styles/mail.css`: the Mail button's place in the dock, and the screen.
- Hooks: `YardDock.placeBesideMonsters`, `MapRoomUi.placeTool`, and `CellPanel`'s `onMessage` and
  `onTruce`; `MailDoor`'s `onTruceAccepted`; for #205 `CellPanel`'s `onInvite`, `onWithdrawInvite`,
  `onInviteToOutpost` and `canInviteToOutpost`, and `MailDoor`'s `openInvite`,
  `onInviteAccepted` and `onInviteChanged`.
