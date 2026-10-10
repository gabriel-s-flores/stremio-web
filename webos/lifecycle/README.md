# App lifecycle on webOS TV 4.x (F3.3)

Mounted next to the App in `src/App/index.webos.js` (`<LifecycleHandler />`, inside the router),
so it exists only in the `WEBOS=1` build. Nothing runs at boot except adding four event listeners
(and reading `PalmSystem.launchParams` once).

## What the system does (measured on the webOS 4.0 emulator)

| Situation | What the page sees |
|---|---|
| HOME | The launcher bar opens **over** the running app. Only `window` `blur`; `document.hidden` stays `false`, the player keeps playing. A second HOME closes the bar (`focus`). |
| A system panel (Settings) over the app | Same: `blur` only, `PalmSystem.isActivated` false. |
| Another full-screen app over this one (OK on the launcher tile, `ares-launch`) | `visibilitychange` with `document.hidden === true`. The system **pauses the playing `<video>` itself** before the handler runs, and the page is frozen while hidden (timers and media events wait). |
| Back in front | `visibilitychange` (visible) and `window` `focus`. The system **resumes the `<video>` by itself** ~0.2 s later, with no JS. |
| Relaunch (`ares-launch <id>`, launcher tile) with `handlesRelaunch: true` | The page is **not reloaded**. `webOSRelaunch` is dispatched on `document`; `event.detail` is the launch parameters. Nothing brings the app to front by itself. The launcher bar of the emulator stays open after an `ares-launch` relaunch (a launcher tile closes it on a TV). |
| `PalmSystem.hide()` / `activate()` | No visible effect in the emulator. |

## What the app does

| Event | Action |
|---|---|
| `visibilitychange` hidden | Snapshot of route, focused element and scroll; pause every playing `<video>`/`<audio>`; arm the play guard. |
| `visibilitychange` visible | Window focus if nobody has it; put focus and scroll back if the system took them; the play guard stays armed for 5 s. |
| `webOSRelaunch` | `PalmSystem.activate()` + `window.focus()` (brings the app to front); if the launch parameters carry a deep link, open it; otherwise put focus and scroll back. From the background it is also the way back to the foreground. |
| `blur` / `focus` (HOME bar) | Snapshot on `blur`; on `focus`, put the focus back if the system took it. The player is **not** paused: a TV keeps playing under the launcher bar. |
| Cold start | If `PalmSystem.launchParams` carries a deep link, open it. |

**Play guard** (`media.js`): armed with the media elements that existed when the app went away,
in the background and for 5 s after coming back. A `play` of one of those that no key or click
caused is paused again, once per element (the system's resume is one `play`); elements created
later (the next episode) are never touched, and the first key/click disarms the guard. This is
what keeps the player paused after the system's own resume. The Player UI follows by the
elements' `pause` event (stremio-video listens to it), without a call into React.

The App already refreshes addons, user, library and notifications on `window` `focus`; the
lifecycle only makes sure the window has the focus when the app comes back.

## Launch parameters (`launchParams.js`)

Deep link keys: `contentTarget` (the one LG uses for content launches), `deepLink`, `deeplink`,
`route`. Values: `stremio:///detail/movie/tt0111161`, `#/discover`, `/library/movie`.
The query string and fragment are **dropped**, except `search` (max 200 characters) on the search
route: `?streamingServerUrl=` saves and activates a streaming server and `/addons?addon=<url>`
opens an addon by URL, and a launch must not do either (P3, no confirmation). `.`/`..` segments
(also percent-encoded) and `//` are rejected. Only these screens are accepted: board, discover, library, calendar, continuewatching, search,
metadetails (`/detail/...`), addons, settings. Anything else (external URL, `/player/...`, `/intro`,
`..`, `//host`) is ignored.

```
ares-launch --device <dev> io.github.gabrielsflores.stremio -p '{"contentTarget":"stremio:///settings"}'
```

## State

The page survives HOME, the launcher and relaunch, so route, focus and scroll are normally still
there. The snapshot (`snapshot.js`) is only used to put the focus (and the scroll it moves) back
when the system took them while the app was behind. If the system kills the page in the background
(memory), the next launch is a cold start at the Board, like any other TV app; nothing is persisted.

## Debug and tests

- `window.__webosLifecycle.events` (last 50: `background`, `foreground`, `relaunch`, `blur`,
  `focus`, `launch`, with the restore result) and `.background`.
- Unit tests: `webos/tests/lifecycle/` (`pnpm test`).
- Emulator: `webos/tools/emu-run --timeout 15 -- node webos/tests/lifecycle/emulator/run.mjs <out-dir>`
  after `pnpm webos:package` (real HOME and OK keys, `ares-launch` relaunch, CDP state, a real
  `<video>` over a media server).
