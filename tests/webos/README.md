# T0.6 — Evidências de medição webOS

## T2.9 - Fontes e ícones

Status: **parcialmente validada** — artefatos e Chrome local aprovados; Chromium 68
indisponível. Ver [evidência T2.9](T2.9%20-%20Evidências.md).

A rota `#/debug/fonts-icons` existe apenas em `WEBOS=1 WEBOS_DEBUG=1`. Mostra
Plus Jakarta Sans, bandeira Twemoji e os sete ícones pedidos sobre três fundos,
com foco. Um SVG adicional isola stroke/currentColor.

Execute cada auditoria antes do próximo build, pois `build/` é substituído:

```powershell
corepack pnpm build
node tools/t29-artifact-audit.cjs desktop
corepack pnpm build:webos
node tools/t29-artifact-audit.cjs webos
corepack pnpm check:webos-compat
corepack pnpm build:webos:debug
node tools/t29-artifact-audit.cjs debug
node scripts/verify-webos-debug-build.mjs build debug
corepack pnpm check:webos-compat
corepack pnpm test --runInBand
corepack pnpm lint
node tools/t29-fonts-icons-runner.mjs
```

O runner abre Chrome headless separado (`CHROME_PATH` opcional), serve o build e
salva `tests/webos/t29-chrome{,-focus}.png` e `t29-chrome.json`. Captura erros de
console/rede desde antes da navegação, desativa cache/service worker e retorna
código não zero se um check falha. Não simula Chromium 68.

Para emulador já aberto com o build debug, em viewport 1920×1080:

```powershell
$env:CDP_HTTP = 'http://127.0.0.1:9998'
$env:TARGET_HINT = '<id-ou-url-do-app>'
$env:T29_LABEL = 'chromium68'
node tools/t29-fonts-icons-runner.mjs
Remove-Item Env:CDP_HTTP, Env:TARGET_HINT, Env:T29_LABEL
```

O runner recarrega o alvo. O JSON registra a versão real e `chromium68`; o nome do
arquivo não comprova o ambiente. Também é possível usar `cdp.mjs eval-file <target>
tools/t29-fonts-icons-probe.js`, porém isso não coleta rede desde o boot nem capturas.
A T2.10 deve complementar o baseline com Chromium 68 real. Legibilidade na TV física
deve ser registrada separadamente da prova técnica de carregamento.

## Evidências T0.6

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
# T2.10 — coleta visual pareada

Estado e limitações: [T2.10 — Evidências](T2.10%20-%20Evidências.md).
O runner é preparado para targets existentes; não cria sessão nem simula UA.

```powershell
node tools/t210-visual-regression-runner.mjs C:/caminho-fora-do-repo/t210.private.json
```

O JSON privado contém `webos` e `desktop`, cada um com `endpoint`, `targetId`
(ID exato CDP), `origin`, `buildDirectory` e `sessionProbe` (expressão JS ES2018
que retorna `{ authenticated: boolean, identity: string }`). `identity` deve
ser um identificador pseudônimo da sessão, nunca token/senha. O probe precisa
consultar o estado real da sessão, não retornar uma constante de aprovação.
Não salvar esse arquivo nem credenciais no repositório. Capturas podem conter
dados da conta: usar exclusivamente a conta de teste autorizada.

Servir diretórios imutáveis separados para o debug webOS e desktop do mesmo
candidato; manter a origem autenticada e o mesmo catálogo. O config de fixture
desktop existente é `tools/t25-desktop-fixture.config.cjs`. Validar builds normais
separadamente com `scripts/verify-webos-debug-build.mjs build standard` antes de
preparar o debug. Não reconstruir o diretório servido durante a galeria.

Saídas: `t210-<rota>[ -focus].<webos|desktop>.png` (sem espaço no nome),
`t210-gallery.html`, `t210-summary.json` e relatórios do Player estrito. Código
de saída 1 significa bloqueio e 2 significa coleta que ainda exige revisão.
Não há código de saída de aprovação automática. A execução sem config registra
a disponibilidade das portas conhecidas e o bloqueio, sem fabricar imagens.
