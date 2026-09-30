# T1.5 - API guards

Data: 2026-09-06
Branch: webos
Alvo: Chromium 68 / webOS TV 5

## Implementacao

- `src/common/writeTextToClipboard.js` normaliza API ausente, metodo ausente,
  excecao sincrona e Promise rejeitada como falha capturavel.
- `src/routes/Settings/Streaming/Streaming.tsx` mostra erro traduzido e um campo
  somente leitura selecionavel quando a Clipboard API nao esta disponivel.
- `src/routes/Settings/Streaming/Streaming.less` libera selecao de texto no campo
  de fallback apesar do `user-select: none` global.
- `src/common/Platform/safeOpenExternal.js` preserva a whitelist e a pagina de
  warning, mas retorna `false` sem lancar quando `window.open` esta ausente ou falha.
- `src/common/Platform/Platform.tsx` trata a falha de abertura como no-op seguro,
  sem antecipar a decisao de UX da T3.8.
- `src/webos/diagnostics/runtime.js` protege leitura de `performance.memory`,
  incluindo getter que lanca e dados sem `usedJSHeapSize` numerico.
- A auditoria nao encontrou uso de `navigator.hardwareConcurrency` no codigo.

## Validacao automatizada

| Verificacao | Resultado |
|---|---|
| Jest | 7 suites, 102 testes, passou |
| `pnpm lint` | passou |
| `pnpm build` | passou; warnings existentes de tamanho |
| `pnpm build:webos` | passou; warnings existentes de tamanho |
| `pnpm check:webos-compat` | 6/6 artefatos ES2018 |
| `pnpm verify:webos-debug build standard` | passou; debug ausente |
| `pnpm verify:webos-debug build debug` | passou; debug presente |
| `pnpm verify:hosted-build build` | passou; 52 referencias e WASM presentes |

## Equivalencia e smoke manual

- Os pares baseline/candidato preservados da T1.3 continuam equivalentes em desktop
  e webOS: 85/85 arquivos, `equal: true`, normalizando somente o source map temporario
  do Workbox.
- A comparacao do build atual contra o candidato pre-T1.5 diverge somente em
  `main.js`, `main.js.map`, `main.css`, `main.css.map`, `service-worker.js` e
  `service-worker.js.map`. Essas diferencas sao esperadas pelas alteracoes de API e
  estilo desta tarefa; os 85 arquivos continuam presentes.
- O smoke manual foi executado no hosted app em `http://10.0.2.2:8090/`; o emulador
  reportou Chromium 68 e a pagina carregou, mas o `#app` permaneceu vazio. O worker
  registrou `DataCloneError: ... Wasm decoding failed: invalid local type @+151`,
  bloqueando o boot antes da rota Settings. Esse bloqueio pertence ao init do WASM da
  T1.6, portanto o fallback visual da T1.5 ainda nao pode ser exercitado no emulador.

## Cobertura

`tests/webosApiGuards.spec.js` cobre Clipboard disponivel/ausente, metodo ausente,
falha sincrona, rejeicao assincrona, whitelist, warning, `window.open` ausente,
excecao de abertura e URL invalida.

`tests/webosDiagnostics.spec.js` cobre ausencia de memoria, getter bloqueado e
estrutura de memoria invalida.

## Limites e handoffs

- O clique manual no app completo ainda depende do boot React da T1.7.
- A validacao do modelo `file://` do app completo depende do empacotamento T6.4.
- Os demais usos diretos de Clipboard permanecem para T3.9: leitura no menu,
  copia de links do Player/Streams/legendas e demais fluxos relacionados.
- `performance.memory` mede somente heap JS; WASM, video, GPU e memoria nativa
  continuam nos spikes T1.6 e T7.4.
- `tsc --noEmit` continua bloqueado por erros de tipagem preexistentes em outras
  areas do repositorio; nenhum erro novo da T1.5 foi identificado.
