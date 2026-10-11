# Contributing to Backyard Monsters Revamped

Thanks for wanting to help. This is a small fan project run by one person, so
please open an issue (or ask first) before starting on anything big, to check
it fits the plans.

## Getting set up

Follow "Running it on your own computer" in the [README](README.md). The
web client has its own notes in [`web/README.md`](web/README.md), including
how the code is laid out and the conventions it follows. Game rules are
written up in `docs/specs/`, and new features in `docs/design/`.

## Branches and pull requests

- Work from the `revamp` branch and open pull requests against it.
- Name branches by kind: `feat/<name>`, `fix/<name>`, `art/<name>`,
  `chore/<name>`.
- In the pull request, say **what** you changed, **why**, and **how you
  tested it**.
- Keep each pull request to one change. Small is easier to review.

## Before you send it

```bash
cd web && bun run typecheck && bun run test
cd server && bun run typecheck && bun test
```

Both must pass. Add or update tests for the behaviour you change.

## Code

- Match the style of the code around your change (Prettier settings are in
  `web/.prettierrc.json`).
- The server decides game rules (costs, timers, combat results); the web
  client never trusts itself for those. Use the ORM for every database query.
- Use TypeScript types properly, and prefer JSDoc comments that say why
  something is the way it is.
- When a rule comes from the original game, cite where (for example
  `client/scripts/BASE.as:4830`).
- You are welcome to use AI tools, but you must understand, test and be able
  to explain every line you send.

## Art

- Do not commit game binaries (`.swf`, `.exe`) or screenshots.
- Shrink a monster sheet before committing it
  (`python web/tools/shrink-sheet.py <sheet.png>`), and commit only the final
  sheet, not every trial: git keeps every old version forever.
- Original Backyard Monsters art belongs to Kixeye. Only add art you made
  yourself or have the right to share.

## Licence

By contributing you agree that your work is shared under the repository's
licence, [PolyForm Noncommercial 1.0.0](LICENSE).
