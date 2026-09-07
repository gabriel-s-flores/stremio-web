# T0.6 — Evidências de medição webOS

Esta pasta recebe snapshots JSON e relatórios agregados da T0.6. Os snapshots não
devem conter tokens, URLs privadas ou dados de perfil.

## Procedimento

1. Gere `corepack pnpm build:webos:debug` e instale o artefato webOS quando o
   empacotamento do app completo estiver disponível.
2. Inicie o app com uma sessão autenticada e catálogo fixo para medir a Board.
3. Use `node webos\hello\tools\cdp.mjs list` para localizar o alvo.
4. Abra `#/debug` sem reiniciar a página:

```powershell
node webos\hello\tools\cdp.mjs eval <id-ou-url> "location.hash = '#/debug'"
node webos\hello\tools\cdp.mjs debug <id-ou-url> tests\webos\t06-snapshot.json
```

5. Na rota de diagnóstico, inicie a amostra de FPS, faça o roteiro fixo de scroll
   com o remocon e colete outro snapshot após os 10 segundos.

## Budgets provisórios

| Métrica | Critério |
|---|---|
| First Paint/FCP | p95 <= 1,5 s no packaged frio |
| Boot -> Board interativa | p95 <= 5 s |
| Heap JS | <= 256 MiB após boot; <= 384 MiB no pico de scroll |
| Scroll | >= 45 FPS e p95 de frame <= 22,2 ms |

O resultado do emulador deve registrar firmware, resolução, modo packaged/hosted,
commit, estado de cache, número da rodada e erros do console. A ausência de
`performance.memory` deve ser registrada como métrica indisponível, nunca como zero.

O primeiro baseline do app completo permanece pendente de T1.6/T6.4. O emulador
configurado é webOS TV 5.0.0, Chromium 68.0.3440.106, firmware 02.00.30.

## T2.1/T2.10 — Fixture do Player

O build debug expõe a rota `#/debug/player` com dados estáticos e os componentes reais
do Player. O fixture permite verificar os menus mesmo quando o endpoint de tracks ou
o Player real não está disponível no emulador. A rota e os seletores `data-webos-action`
não entram no build desktop nem no build webOS normal.

```powershell
corepack pnpm build:webos:debug
corepack pnpm verify:webos-ui build --cdp <target> --route '#/debug/player' --player --strict-player --screenshots tests\webos\t21-player-fixture-screenshots --output tests\webos\t21-player-fixture-smoke.json
```

O modo `--strict-player` exige que buttons-menu, speed, options, subtitles, audio,
statistics, cast, next-video, videos e side-drawer estejam presentes; `next-video` é
verificado como visível sem ser clicado. O probe também confirma os fallbacks de
Flexbox no Chromium 68.

Evidências atuais:

- `tests/webos/t21-player-fixture-smoke.json`
- `tests/webos/t21-player-fixture-screenshots/`

## T2.2 - Backdrop fallback

`tests/webosCssBackdrop.spec.js` compiles the eight real LESS files for both build
flags and checks fallback backgrounds, feature queries, focus/hover and modal
specificity. The runtime summary is `tests/webos/t22-backdrop-results.json`.

The temporary CSS gallery uses compiled CSS classes, not React components. Run on
an already loaded app (desktop or webOS); it does not ship in the application:

```powershell
node webos/hello/tools/cdp.mjs list
node webos/hello/tools/cdp.mjs eval-file <target> tools/t22-backdrop-probe.js
node webos/hello/tools/cdp.mjs screenshot <target> tests/webos/t22-webos-surfaces.png
node webos/hello/tools/cdp.mjs eval <target> "window.__t22BackdropProbe.cleanup()"
```

Desktop and Chromium 68 galleries are `t22-desktop-surfaces.png` and
`t22-webos-surfaces.png`. The probe returns a report and leaves it at
`window.__t22BackdropProbe.report`; focus checks wait for transitions to settle.

Integration reports: `t22-board-smoke.json`, `t22-metadetails-smoke.json`,
`t22-player-smoke.json`; Player screenshots: `t22-player-screenshots/`.
The Board smoke passed but its screenshot did not show the catalog, so it is not
evidence of complete visual correctness. EventModal/Toast used CSS fixtures;
Player used debug data, not playback. TV hardware and packaged boot remain untested.

## T2.3 - Calendar aspect-ratio fallback

`tests/webosCssAspectRatio.spec.js` compiles the real `Cell.less` for both build
flags, pins the `@supports not (aspect-ratio: 2 / 3)` fallback structure and scans
`src/**` so no new `aspect-ratio` usage enters without a fallback. Chromium 68
cannot size a box width from its height (max-content ignores percentage heights
and flex items do not transfer intrinsic ratios), so the fallback splits the work:
the LESS block gives the items row a definite height and stretches the poster over
the measured item box, while `Cell.tsx` pins `width = height * 2 / 3` per item in
a `useLayoutEffect` gated by `CSS.supports('aspect-ratio', '2 / 3')` at runtime.
Modern browsers never run the measurement.

The debug build exposes `#/debug/calendar` with 35 real `Cell` components (empty,
single, scrollable, landscape-crop, today and active variants) using data-URI
posters; the route ships only in `WEBOS_DEBUG=1` builds.

```powershell
corepack pnpm build:webos:debug
corepack pnpm verify:webos-ui build --cdp <target> --route '#/debug/calendar' --output tests/webos/t23-calendar-fixture-smoke.json
node webos/hello/tools/cdp.mjs eval-file <target> tools/t23-aspect-ratio-probe.js
node webos/hello/tools/cdp.mjs screenshot <target> tests/webos/t23-calendar-fixture-webos.png
```

Reports: `t23-calendar-fixture-smoke.json`, `t23-calendar-smoke.json` (real route,
no items in hosted mode), `t23-aspect-ratio-results.webos.json` (fallback: 35
cells, 80 items, 0 failures) and `t23-aspect-ratio-results.desktop.json` (native:
0 failures, no inline widths). Screenshots: `t23-calendar-fixture-webos.png` and
`t23-calendar-fixture-desktop.png`.

