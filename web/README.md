# Backyard Monsters Refitted — web client

A browser client for the Backyard Monsters Refitted server. Vite, TypeScript and
PixiJS v8 for the game canvas, with plain DOM and CSS for every menu, popup and
HUD element layered over it.

This is the foundation only: the app shell, the scene system, the camera and hex
grid, the API client and the UI primitives. Map Room 2 data, the yard and the
game screens come later.

## Getting started

Bun 1.4.2 or newer.

```bash
cd web
bun install
cp .env.example .env    # optional; the defaults work for local development
bun run dev
```

The dev server listens on <http://localhost:5173>.

### Running against the local game server

The server runs on port 3001:

```bash
cd server
bun run dev
```

With `VITE_SERVER_URL` empty the client sends every request to its own origin,
and the Vite dev server proxies the game routes to `http://localhost:3001`. That
keeps the browser on one origin, so no CORS preflight and no cookie or header
surprises. Set `VITE_PROXY_TARGET` to point the proxy somewhere else.

To talk to a remote server instead, set `VITE_SERVER_URL` to its origin with no
trailing slash. The proxy is then skipped and requests go straight out, so that
server has to allow the client's origin.

You need an account on whichever server you point at. Against a local server,
register one through `POST /api/<version>/player/register`.

## Scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `bun run dev`       | Dev server with hot module replacement        |
| `bun run build`     | Typecheck, then a production build to `dist/` |
| `bun run preview`   | Serves the built `dist/` locally              |
| `bun run typecheck` | `tsc --noEmit`                                |
| `bun run test`      | Unit tests with Vitest                        |
| `bun run lint`      | ESLint                                        |

## Layout

```
web/
  index.html            Page shell, font links, the #game-root mount point
  vite.config.ts        Dev proxy for the game routes, build settings
  public/
    tribes/             Wild monster tribe avatars, served as /tribes/*.png
  tools/
    gen-tribe-avatars.py  Regenerates those avatars from the original art
  src/
    main.ts             Entry point: loads styles, starts the App
    config.ts           Server URL, zoom limits, world constants from the server
    api/                HTTP client and typed endpoints
      http.ts           fetch wrapper, form encoding, ApiError
      auth.ts           Login, token re-login, session storage, logout
      base.ts           Loading the player's own yard
      maproom.ts        Map Room 2 area fetching
      types.ts          Wire types for everything above
    app/
      App.ts            Pixi application, overlay, ticker, resize
      SceneManager.ts   Scene registry and lifecycle
      scenes/           BootScene, LoginScene, MapRoom2Scene
    game/
      Camera.ts         Pan, zoom, world/screen transforms
      HexGrid.ts        Odd-q offset grid maths
      HexGrid.test.ts
    ui/
      overlay.ts        The HTML layer above the canvas
      Panel.ts          Framed box with a title bar and body
      Popup.ts          Modal Panel with a focus trap
      Hud.ts            Top bar: resources and scene switcher
      styles/
        tokens.css      Colour, spacing and type tokens; dark and light themes
        ui.css          Component and layout styles
```

## Conventions

### Scenes

One screen is one scene. A scene implements any of `enter`, `exit`,
`update(deltaSeconds)` and `resize(width, height)`, and is registered with
`SceneManager` under a name from `SceneName` in `app/App.ts`. Scenes never
construct each other; they call `context.goTo(name)` and the manager applies the
switch on the next tick, so a scene is never torn down inside its own handler.

`enter` gets a `SceneContext` with the Pixi container to draw into, the overlay
layers for DOM, the canvas element for input, and the viewport size. Both the
container and the overlay are emptied when the scene exits, so a scene only has
to undo what it created elsewhere: event listeners, camera attachment, timers.

`update` receives real seconds, not Pixi's frame ratio.

### Overlay

Everything textual is DOM. The overlay covers the canvas but has
`pointer-events: none`, and its children opt back in, so a click on empty space
reaches the camera underneath. There are two layers: `content` for panels, the
HUD and scene chrome, and `modal` for popups, which stacks above it.

Build panels with `Panel` and modals with `Popup`. Neither knows anything about
the game; they take a title and a body and handle the title bar, the close
button, Escape and, for `Popup`, the focus trap and returning focus on close.

Styling goes through the tokens in `ui/styles/tokens.css`. Components reference
custom properties and never hardcode a colour or a pixel gap, so a theme change
is a redeclaration of `:root` and nothing else.

### API

Every call goes through `api/http.ts`. Three things it does that are worth
knowing:

**Bodies are form-encoded.** The server accepts JSON too, but its controllers
were written for the old Flash client's `URLVariables` payloads and read
individual string fields off the body. Structured fields — `resources`,
`buildingdata`, `attackData`, `attackcost`, `monsters`, `bookmarks` and the rest
— are JSON-stringified into a _single_ form field, and the server runs
`z.string().transform(JSON.parse)` over them. Sending them as nested JSON does
not work. Every endpoint module names which of its fields are JSON strings in a
comment; none of the calls implemented so far have any.

**Failure is in the body, not the status.** The server rewrites some errors to
HTTP 200 with the message in an `error` field, because the Flash client
mishandled non-200 responses for ordinary game outcomes. Other controllers
return `error: 1` on a soft failure. So `http.ts` treats a response as
successful only when the status is 2xx _and_ `error` is absent or 0, and raises
a typed `ApiError` otherwise. An unreachable server raises `NetworkError`
instead, which is a different thing to tell the player.

**The token is checked by the server, not decoded here.** The server keeps one
valid token per account and session type in Redis, so a JWT that still parses
may have been superseded by a later login. A restored session is therefore
revalidated by sending the token back through the login route. There is no
logout endpoint; `logout()` forgets the token locally, which is all a client
can do.

### Coordinates

The world is an 800 x 800 hex grid in odd-q offset coordinates with flat-top
columns, so odd columns sit half a cell lower than even ones. Both the server
and the old client convert offset to axial with `q = x`,
`r = y - (x - (x & 1)) / 2` before any neighbour, range or distance work, and
`HexGrid` derives everything from that same conversion rather than hardcoding
per-parity neighbour tables. That keeps client geometry and server range checks
in agreement by construction.

Cell art is 150 x 75 with a 0.75 horizontal step, which means cells are not
regular hexagons. `pixelToCell` scales the vertical axis into regular-hex space
before rounding; the scaling is affine, so it maps hex to hex exactly.

The world also wraps toroidally in the real game. That is not implemented yet.

## Art

### Tribe avatars

The four wild monster tribes — Legionnaire, Kozu, Abunakki and Dreadnaut — have
a portrait each: 256 px in `public/tribes/` (served as `/tribes/*.png`), with the 1024 px sources kept out of the build in `docs/art/tribes/`, and at
256 px for the map. Map Room 2 loads only the 256 px set, once, and every camp
on screen is a sprite pointing at one of those four textures.

They live directly under `public/` and **not** under `public/assets/` because
the dev server proxies the whole `/assets` prefix to the game server
(`vite.config.ts`), which does not have these files. Anything put there is
unreachable in development.

The PNGs keep whatever transparent margin they were generated with;
`src/game/maproom/tribeAvatars.ts` measures each one on load and draws the
cropped region, so the four read as the same size on the map however they were
framed. Nothing has to be trimmed by hand before adding a new one.

To regenerate them, either run

```sh
pip install google-genai pillow
export GEMINI_API_KEY=...          # PowerShell: $env:GEMINI_API_KEY="..."
python web/tools/gen-tribe-avatars.py [--tribe kozu] [--variants 3]
```

which sends each tribe's original artwork from
`server/public/assets/popups/tribe_<name>.v2.png` to Gemini's image model as a
reference and writes numbered variants back to `public/tribes/`, or produce them
in Antigravity from the same reference images. Either way, pick a variant,
chroma-key it to transparency, and save it as `<tribe>.png` at 1024 px with a
`<tribe>-256.png` beside it.

## Fonts

**Display: [Titan One](https://fonts.google.com/specimen/Titan+One)** by Rodrigo
Fuenzalida, under the SIL Open Font License 1.1. It is the closest free stand-in
for Grobold, the original game's display face: heavy, rounded terminals, wide
cartoon proportions. Luckiest Guy was the other strong candidate on shape but
ships under Apache 2.0 rather than the OFL, and Lilita One is noticeably lighter
and narrower than Grobold.

**Body: [Nunito](https://fonts.google.com/specimen/Nunito)** by Vernon Adams,
Cyreal and Jacques Le Bailly, under the SIL Open Font License 1.1. A humanist
sans with rounded terminals, so it sits beside Titan One without clashing.

Both load from Google Fonts through a `<link>` in `index.html`.
