I would build **numbered preset rows with one Send button per row, opening a separate editor**. Sending is the frequent action. Building a recipe deserves its own space. Remove the round-two mix tokens; a second quick-send surface would duplicate the Presets tab.

The important distinction: **a preset is a recipe, not ten queue sockets**. Store monster types and counts. When sending, split those counts into stacks of 20 at L2 or 30 at L3. Show the queue space needed; don’t make players construct stacks manually.

## Shared layout for both directions

**The red-box strip becomes the mode switch.** On a 390 px phone, use one 48 px row:

`[ Monsters | Presets ]   [housing icon · 5 !]`

Give the switch roughly 240 px and the warning chip the remaining space. Both tabs and the chip have at least 44 px tap targets. The chip appears only when monsters are waiting for housing. Use a painted house, amber/red treatment, and the waiting count—not a bare red number. Tapping it reveals **“Housing full · 5 waiting”** within the content area.

On desktop, keep the switch left-aligned in that same strip. There is room beside it for **“Housing full · 5 waiting”** in full. Don’t stretch the two tabs across the window.

**Keep housing accounting together in the top workbench strip.** Show current occupancy/capacity, the existing queue projection, and a clearly marked **“After”** total. For example:

`house 2,080 / 2,160`  
`After 14.1K / 2,160`

Use a segmented bar underneath. A bar pinned at 100% cannot communicate how far over capacity the queue goes; keep the numeric After total. Selecting quantities or previewing a preset adds a distinct proposed segment and updates After. A partial Send must recalculate it from what actually entered the queue.

Housing overflow is a warning, **not a reason to disable Send**. Queue capacity and goo determine what can be added.

At L3, presets follow the selected destination automatically:

- Main yard selected → painted house + **“Main”**
- Any outpost selected → painted flag + **“Outposts”**

Put this small scope label at the top of Presets and keep it visible in the editor. Tapping it can switch libraries for editing. If the library does not match the destination, replace Send with **“Choose yard”**, opening the existing destination selector. Never silently switch yards or send the wrong library.

The current destination remains explicit above: `flag 2/11`. An outpost recipe edit affects **all outposts**; show that short explanation on first edit.

## Direction 1 — Recipe rows → dedicated editor

This is the most practical option.

**Presets landing view**

Show three rows at L2, five at L3. Each roughly 64 px tall:

`①  [portraits + counts]     [goo total]  [Send →]`

Use a broad row body for editing and a separate 64–72 px-wide Send button. Send uses the painted queue arrow plus the short word **“Send”**; an unexplained arrow could mean “open.”

Show up to three portraits, then `+3` for additional monster types. Include a small total such as `×140`. Don’t shrink portraits to squeeze an entire recipe into one row. Empty rows show the number and a large `+`; tapping opens the editor.

**Building and editing**

Opening a row replaces the lower content pane:

`[‹]  Preset 2 · flag   [empty icon]`

Reuse the monster grid and quantity panel. Tapping a monster loads its **saved count** into the stepper. Changes update that count directly; zero removes that monster. This is clearer than an Add button that repeatedly accumulates quantities.

Show the recipe total, goo cost, and estimated stack use in a compact summary. Use explicit **Save** and **Cancel** actions. “Done” is ambiguous about whether edits have already been stored. Emptying a populated preset asks **“Empty preset 2?”** inside the editor.

**Send and feedback**

Send sits on each row, available without selecting the row first. Sending does not alter the saved recipe.

Reserve a two-line result area immediately below the mode switch:

**“Added 82 of 140”**  
**“Queue full”**

Keep it visible until the next action or tab change. Briefly highlight the newly added queue stacks. Do not rely on a toast over the artwork.

Send uses the recipe’s displayed order. Preserve that order when editing and offer simple up/down controls in the recipe summary if players need to change it. Partial sends make order consequential; it cannot be hidden implementation detail.

**Desktop**

Use the rows in the left pane and a selected recipe preview on the right. Editing replaces that preview with the familiar monster grid and quantity controls, or expands into the existing lower work area. Keep Send buttons in a consistent column.

## Direction 2 — Slot selector + recipe ledger

This favors inspection and deliberate sending over the fastest repeat action.

**Presets landing view**

A 44 px row contains numbered slots `1 2 3` or `1 2 3 4 5`. Below it, show the selected recipe as a vertical ingredient ledger:

`[portrait] Pokey       ×40   [edit]`  
`[portrait] Octo-ooze   ×60   [edit]`  
`[+ monster]`

The ledger scrolls. Its footer stays visible:

`goo 200K · ×100 · 4 stacks`  
`[Send →]`

Counts are large and readable. Unlike the first direction, the complete selected recipe is directly inspectable.

**Building and editing**

`+ monster` replaces the ledger with a monster picker. Choosing a monster opens the familiar stepper in the same pane. **Set** commits the count and returns to the ledger. Tapping an existing ingredient edits it; setting zero removes it.

The selected slot has an empty action in its header. Editing is saved per Set action, with a short Undo opportunity. Up/down controls in edit mode establish sending order.

**Send and feedback**

One full-width, 44–48 px Send button sits in the fixed footer. The result replaces the cost summary above it, so feedback stays adjacent to the action without covering the list.

Selecting another slot then sending takes two taps. That is the tradeoff for a larger preview and a harder-to-misfire Send control.

**Desktop**

Put the five slot selectors down the left, the ledger in the middle, and the monster picker/count editor on the right. This direction uses desktop width well but introduces more transitions on phones.

## Phone sizing: replace space, don’t stretch the window

These are **CSS-pixel budgets**, not measurements of the 3× attachments.

For both directions, at 390×844:

| Area, top to bottom | Approx. height |
|---|---:|
| Existing HUD/background above window | 140 px |
| Window title and Monsters section tabs | 92 px |
| Yard selector + housing/After | 60 px |
| Hatcheries | 60 px |
| Two-row queue + time/actions | 108 px |
| Monsters / Presets + warning chip | 48 px |
| Active content pane | 210 px |
| Frame/padding allowance | 26 px |

The 48 px switch takes the roughly 52 px freed by removing the mix tokens.

For Direction 1, the active pane shows roughly three preset rows and scrolls to the rest. In its editor, reserve about 44 px for navigation and 100 px for quantity/save controls; the picker occupies the remaining space.

For Direction 2, that pane contains the 44 px slot selector, scrolling ledger, and roughly 64 px cost/Send footer.

**At 390×664, keeping that whole upper workbench fixed leaves almost no editor.** Make the workbench and content one vertical scroll region under the window header. Keep the mode switch sticky when reached and keep the active editor’s action footer visible. Do not compress everything into tiny controls.

**At 844×390 landscape**, use a compact header and a two-column interior: roughly 300 px for the workbench, remaining width for the mode switch and active content. Each column scrolls vertically. The editor footer stays within the right column. Use a horizontally scrollable section-tab rail with full 44 px targets; no half-clipped controls.

## My choice and its three biggest risks

**Build Direction 1.** It gives frequent users direct Send access, makes the numbered collection easy to scan, and reuses the existing editor without stacking another rack above it.

Its biggest risks:

1. **Partial sends feel arbitrary.** Show recipe order, queue-space demand, and the actual added total. Preserve the unsent recipe.
2. **Players edit the shared outpost library without realizing it.** Keep the flag/Outposts scope visible throughout editing and explain its shared effect once.
3. **Short phones lose the editor beneath the workbench.** Solve this with scrolling and a visible action footer, not smaller portraits and buttons.

## Your three directions

**1. Rows with Send — strongest.** Your interaction priority is right. The weak points are unspecified editing semantics and overloaded previews. Cap the preview, separate Send from the editing hit area, and make the editor change saved counts rather than repeatedly “Add to preset.” Replace Done with Save/Cancel if edits are staged.

**2. Slot rail + in-place editor — too much simultaneous machinery on a phone.** The slot rail, recipe rack, monster grid, stepper, and Send compete for the same lower pane. Two taps to send is a minor issue; burying the recipe or action is the real one. Make the recipe ledger the primary view and open the picker only while editing—that becomes Direction 2 above.

**3. Count grid — useful editing mode, weak primary surface.** Every card carrying portrait, price, count, minus, and plus creates a dense field of competing tap targets. Large quantities also make repeated tapping tedious. Keep count badges on cards, but open one shared count editor when a card is selected. That preserves overview without eighteen independent steppers.

Your housing chip is sensible **as a persistent warning indicator**. It should expose the short warning on tap, while the top housing strip retains an explicit After total. Neither a red bar nor `+queue` alone explains the projected housing state.