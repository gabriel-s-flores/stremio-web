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
- `webos/vendor/webOSTVjs-1.2.13/`: webOSTV.js da LG, sem alterações (origem e sha256 no README).
- Escala de TV (F2.6): o app inteiro é ampliado pelo zoom da escala de interface do upstream, com o
  fator `TV_SCALE` de `src/common/interfaceScale.webos.ts` (a opção "Interface zoom" das configurações
  multiplica esse fator: 100% = padrão da TV). As margens de overscan são as `--safe-area-inset-*` de
  `webos/styles/app.less`, e o foco do controle remoto também fica lá. `postcss-math-functions.js`
  resolve `min()/max()` para essa mesma escala (`webos/tests/styles/tv-scale.test.js` amarra os três).
- `webos/tests/screens/`: roteiro de capturas das telas principais (Board, Discover e menu, Busca,
  Detalhes, streams, Library, Calendar, Addons e modal, Settings, menu do usuário, diálogo de saída,
  Player), com um item focado em cada uma e uma sonda (escala, áreas seguras, caixa e estilos do foco,
  tamanhos de fonte em px da tela, erros de JS): `emulator.sh` (dentro do `emu-run`), `desktop.sh`
  (Chrome headless sobre `build/`) e `compare.sh` (lado a lado). Base para a regressão visual (F2.7).
- `webos/lib/diagnostics/`: tela de diagnóstico (`#/webos-diagnostics`; atalho vermelho-verde-amarelo-azul
  em qualquer rota e item "Diagnostics" no menu de Settings): versão, core, tempos de boot, WebAssembly,
  configs Luna, `canPlayType`, memória e relatório exportável. Chunk lazy, nada roda no boot; veja o README da pasta.
