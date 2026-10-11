# Port webOS TV 4.x

Branch de integração do port do Stremio Web para a LG OLED55C8PSA (webOS TV 4.0, Chromium 53).

- `development` espelha o upstream (Stremio/stremio-web); esta branch recebe o port.
- Cada tarefa vem de uma branch `port/<tarefa>` por PR, criada e revisada pelo orquestrador
  (threads do T3 Code) e mergeada aqui depois da revisão.
- Premissas: todo desenvolvimento e teste no emulador webOS TV 4.0 (a TV real só na validação
  final), áudio nos alto-falantes da TV, streams só de debrid (sem servidor de streaming).

Plano, pesquisa e regras do orquestrador ficam no kit da máquina de desenvolvimento
(`~/webos-tv-sdk/docs/`): `PLANO-PORT-WEBOS4.md`, `PESQUISA.md` e `ORQUESTRADOR.md`.

## Build webOS

```bash
pnpm webos:build      # build-webos/ (webos/webpack/webpack.config.js sobre o webpack.config.js da raiz)
pnpm webos:package    # build + dist-webos/<id>_<versão>_all.ipk (JS como o webpack gerou, sem os .map)
pnpm webos:install    # instala o IPK em $WEBOS_DEVICE ou $EMU_DEVICE (sem padrão)
pnpm webos:launch     # abre o app no mesmo dispositivo
```

No emulador, dentro de uma reserva do pool:
`webos/tools/emu-run -- sh -c 'pnpm webos:install && pnpm webos:launch && …'`.

- `webos/webpack/`: um módulo por assunto (`app`, `babel`, `core`, `polyfills`, `trim`, `postcss`),
  compostos em `webpack.config.js`. O `webpack.config.js` da raiz não muda.
- Overrides: `require('./styles')` usa `styles.webos.less` (ou `.webos.js`, `.webos.tsx`…) quando o
  arquivo existe, só no build webOS.
- `webos/polyfills/`: polyfills só do webOS (ResizeObserver, `Intl.PluralRules` com os idiomas do app,
  AbortController, `queueMicrotask`, `Element#append/prepend/scrollTo`); `index.js` entra no bundle da
  página e `worker.js` no do worker, via `webos/webpack/polyfills.js`. A sonda do emulador está em
  `webos/tests/polyfills/emulator/` (`run.sh`, dentro do `emu-run`).
- `webos/persistence/mirror.js`: espelho do localStorage num IndexedDB (`stremio-webos-persist:<id>`),
  restaurado antes do init do core quando o localStorage some (F3.5, recomendação do spike F0.8). Entra
  pelo `src/core/createTransport.webos.js`; o motivo do boot e o último lote ficam em
  `window.__stremioPersist.status()` (`inspect()`, `wipe()` para a tela de diagnóstico; `?resetMirror`
  ou `{"resetMirror": true}` nos parâmetros de lançamento apagam a cópia).
- `webos/app/`: `appinfo.json` (a versão vem do `package.json`), ícones e o `index.html` do webOS.
- `webos/tlsproxy/`: certificados Let's Encrypt, que o Chromium 53 recusa. O serviço JS do app
  (`service/`, Node 0.12) vai no IPK ao lado do app e faz proxy HTTPS local com as raízes ISRG; a
  página (imagens, `Image.webos.tsx`) e o worker do core o usam só para hosts Let's Encrypt, e nunca
  para vídeo. Detalhes em `webos/tlsproxy/README.md`.
- `webos/lib/redact/`: o token do proxy de certificados fora dos logs (F3.7b). Um filtro de `console.*` instalado
  no início da página e do worker, os erros do Player e o relatório da tela de diagnóstico passam por ele. Veja o README da pasta.
- `webos/vendor/webOSTVjs-1.2.13/`: webOSTV.js da LG, sem alterações (origem e sha256 no README).
- Escala de TV (F2.6): o app inteiro é ampliado pelo zoom da escala de interface do upstream, com o
  fator `TV_SCALE` de `src/common/interfaceScale.webos.ts` (a opção "Interface zoom" das configurações
  multiplica esse fator: 100% = padrão da TV). As margens de overscan são as `--safe-area-inset-*` de
  `webos/styles/app.less`, e o foco do controle remoto também fica lá. `postcss-math-functions.js`
  resolve `min()/max()` para essa mesma escala (`webos/tests/styles/tv-scale.test.js` amarra os três).
- `webos/tests/perf/` (F7.1): as medições do app no perfil C8 (boot até o Board, navegação, memória por fase e o
  estouro de memória, trocas de stream, A/B de builds, tamanhos), refeitas com `perf.mjs` e resumidas por
  `summarize.mjs`, que tira das medianas as rodadas feitas com o host ocupado. Números e método em
  `webos/docs/BASELINE-C8.md`; como rodar, em `webos/tests/perf/README.md`.
- Desempenho (F7.2, parte 1b do `BASELINE-C8.md`): `"v8ExtraFlags": "--no-crankshaft"` no `appinfo.json` (o
  Crankshaft otimizando o core em wasm2js estourava a memória do renderer; com a flag, todo o JS do app roda
  sem compilador otimizador, e as telas que esperam o core ficam ~25 % mais lentas; se outra flag for
  necessária, ela entra na mesma string); `webos/stubs/stremio-translations.js` (só o en-US no `main.js`, as outras línguas
  sob demanda); `webos/lib/core-calls` (pedidos de `getState` iguais e simultâneos compartilham a resposta) e
  `webos/lib/catalog-trim` (os catálogos chegam ao core sem o `videos` dos itens, que ele descarta).
- `webos/tests/screens/`: roteiro de capturas das telas principais (Board, Discover e menu, Busca,
  Detalhes, streams, Library, Calendar, Addons e modal, Settings, menu do usuário, diálogo de saída,
  Player), com um item focado em cada uma e uma sonda (escala, áreas seguras, caixa e estilos do foco,
  tamanhos de fonte em px da tela, erros de JS): `emulator.sh` (dentro do `emu-run`), `desktop.sh`
  (Chrome headless sobre `build/`) e `compare.sh` (lado a lado). **Regressão visual (F2.7):** com um
  addon de teste local (`fixture/`, conteúdo fixo, sem rede), `visual.sh check` captura no emulador e
  compara com as referências versionadas de `refs/emulator/` (PNG 480×270), falha acima do limiar e
  gera um relatório HTML (antes/depois/diff); `visual.sh update` as atualiza. Veja `webos/tests/screens/README.md`.
- `webos/lib/diagnostics/`: tela de diagnóstico (`#/webos-diagnostics`; atalho vermelho-verde-amarelo-azul
  em qualquer rota e item "Diagnostics" no menu de Settings): versão, core, tempos de boot, WebAssembly,
  configs Luna, `canPlayType`, memória e relatório exportável. Chunk lazy, nada roda no boot; veja o README da pasta.
- `webos/external-links/`: links para fora do app (F3.4). `window.open` e cliques em links `http(s)` viram um
  diálogo com **QR code** para ler com o celular (gerador próprio em `qr.js`, sem dependência); `magnet:`,
  `stremio:` e outros esquemas externos ficam desativados. Veja o README da pasta.
- `webos/keyboard/`: teclado do sistema nos campos de texto (F3.4). OK num campo com o teclado fechado abre o
  teclado em vez de enviar; o Enter do teclado envia e o fecha mantendo o foco no campo. O que se mediu no
  emulador e pode diferir da TV está no README da pasta. `webos/polyfills/clipboard.js`: `navigator.clipboard`
  para as ações de copiar não lançarem no Chromium 53.
- `webos/lib/navigation/`: navegação pelo controle remoto (F4.1a, F4.1b, F4.1c e F4.3, consolidadas na F4.4
  num núcleo comum, `core/`; veja o README da pasta). Cada tela recebe o mesmo motor de foco pelo seu
  `index.webos.*` (`withScreenNavigation.js`): foco inicial no primeiro item, foco restaurado no item de onde
  se saiu quando o Back traz a tela de volta (nunca na barra lateral), foco recuperado quando o elemento some
  e as setas que a tela conhece melhor: faixas do Board/Busca (`board.js`, `search.js`, com
  `webos/styles/strips.less`), grade do Discover (`discover.js`), listas roláveis de Library, Calendar, Addons
  e Settings (`screens.js`); Detalhes (`metadetails.js`, F4.1c), overlays (`modals.js`), menus de contexto
  (`contextMenu.js`) e a barra lateral (`sideBar.js`) completam. O resto das setas segue no
  `spatial-navigation-polyfill`. Um só `keydown` e um só `focusin` de captura (`core/input.js`). A barra e o
  botão do perfil ficam focáveis (`NavTabButton.webos.js`, `NavMenu.webos.js`), os toggles de Settings também
  (`Option.webos.tsx`) e o "Interface zoom" fica em 100/125 % (`Scale.webos.tsx`). Testes:
  `webos/tests/navigation/` e, no emulador, os roteiros listados no README da pasta.
