# Backyard Monsters Revamped

A free, unofficial fan revamp of Backyard Monsters, Kixeye's 2010 Flash strategy
game. It runs in any modern browser, with no Flash and no download: a new web
client talks to a game server based on
[Backyard Monsters Refitted](https://github.com/bym-refitted/backyard-monsters-refitted).

- Play: <https://play.bymrevamped.com>
- Website: <https://bymrevamped.com>
- Support the project: <https://www.patreon.com/c/TheMonsterLab>

This is a fan project. It is not affiliated with, endorsed by or connected to
Kixeye, which owns Backyard Monsters and its art.

## What is in this repository

| Folder | What it is |
|---|---|
| `web/` | The browser game client (Vite, TypeScript, PixiJS). See [`web/README.md`](web/README.md). |
| `server/` | The game server (Bun, Koa, PostgreSQL with MikroORM, Redis), based on Refitted's. It also serves the original game art from `server/public/`. |
| `site/` | The website at bymrevamped.com (Astro). See [`site/README.md`](site/README.md). |
| `docs/` | Design notes, game rule specs, server API notes and the deploy guide ([`docs/deploy.md`](docs/deploy.md)). |
| `client/scripts/` | The decompiled code of the original Flash game. Nothing runs it; it is kept as the reference our tools and docs check the game rules against. |
| `client/` (other folders) | Raw art and text dumps from the original Flash game, kept for reference. |

## Running it on your own computer

You need [Bun](https://bun.sh) 1.4.2 or newer and Docker.

1. Start the database and Redis:

   ```bash
   cd server
   cp example.env .env      # then set SECRET_KEY to any long random string
   docker compose up -d db redis
   bun install
   bun run db:init          # creates the tables and runs the migrations
   ```

2. Start the game server (port 3001):

   ```bash
   cd server
   bun run dev
   ```

3. Start the web client (in a second terminal):

   ```bash
   cd web
   bun install
   bun run dev
   ```

   Open <http://localhost:5173> and use "Create account" on the login screen.
   The web dev server passes game requests on to the local server, so no extra
   setup is needed.

Optional: `bun run db:seed:mr2` (in `server/`) fills Map Room 2 with 2,500
test players for local testing. Seeded accounts use the dev-only password
`Dev12345!`; the seed scripts refuse to run when `ENV` is `production`.
`DEV_SANDBOX=true` in `server/.env` gives every new account a fully built
test yard.

Tests and type checks:

```bash
cd web && bun run typecheck && bun run test
cd server && bun run typecheck && bun test
```

To put your own copy online, follow [`docs/deploy.md`](docs/deploy.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security problems
privately, as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Licence

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0),
see [LICENSE](LICENSE). You may use, change and share the code for any
noncommercial purpose.

```
Backyard Monsters preservation project.
Copyright (C) 2025 | The Backyard Monsters Refitted team
Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE)
<https://polyformproject.org/licenses/noncommercial/1.0.0>.
```

## Credits

- The [Backyard Monsters Refitted](https://github.com/bym-refitted/backyard-monsters-refitted)
  team, whose server, reverse engineering and preservation work this revamp is
  built on.
- Kixeye, who made Backyard Monsters and own the game and its original art.
- Titan One font by Rodrigo Fuenzalida (SIL Open Font License 1.1).
