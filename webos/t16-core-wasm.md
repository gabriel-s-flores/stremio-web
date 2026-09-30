# T1.6 - Core WASM no Chromium 68

Data: 2026-09-06
Branch: `webos`
HEAD: `c481b4ee6204120b7f96df01bbbbe5eb28c82c31`
Alvo: webOS TV 5 / Chromium 68.0.3440.106

## Causa e correcao

O `@stremio/stremio-core-web@0.62.1` emitia tipos de referencia WASM (`externref`).
O Node moderno aceitava o binario, mas o Chromium 68 rejeitava o mesmo arquivo:

```text
Wasm decoding failed: invalid local type @+151
```

O pacote foi fixado em `@stremio/stremio-core-web@0.57.0`. Essa versao usa o
artefato legado compativel com o MVP WebAssembly suportado pelo Chromium 68. A
transpile-list do Webpack nao foi ampliada: o problema era bytecode WASM, nao
JavaScript.

## Artefatos

| Item | Valor |
|---|---|
| WASM | `5,187,435` bytes |
| SHA-256 | `b7b2effc52053f78436aebac299b5d51b5158a66355d918b2690c4dc9826238e` |
| Tipos `externref`/`funcref` na secao de tipos | 0 |
| ES-Check | 6/6 arquivos ES2018 |
| Hosted build | 52 referencias locais e WASM presente |

## Smoke no emulador

Com o build servido em `http://10.0.2.2:8090/`:

| Verificacao | Resultado |
|---|---|
| WASM HTTP | 200 |
| `WebAssembly.validate` no Chromium 68 | `true` |
| `WebAssembly.compile` no Chromium 68 | `true` |
| `#app` | 6 filhos |
| `window.core` | presente |
| `getState('ctx')` | resolve para objeto |
| Chaves de `ctx` | `events`, `notifications`, `profile`, `searchHistory`, `streamingServerUrls` |
| `getState('ctx')` em uma amostra | 1.7 ms |

Comando reproduzivel:

```powershell
corepack pnpm build:webos
corepack pnpm check:webos-compat
corepack pnpm verify:hosted-build build
node scripts/verify-webos-core.mjs build --cdp 10.0.2.2
```

## Medicao preliminar

O tempo abaixo e `entry` ate `core-ready`, usando a instrumentacao de diagnostico
existente. A marca `core-ready` e observada por polling de 250 ms, portanto e uma
medida de boot ate o core, nao um cronometro interno exclusivo do `transport.init`.

| Amostra | Boot ate core |
|---:|---:|
| 1 | 2900.3 ms |
| 2 | 2790.1 ms |
| 3 | 2512.7 ms |
| 4 | 2569.2 ms |
| 5 | 2570.4 ms |

Mediana: `2570.4 ms`. Heap JS apos init: `17,100,000` bytes. Limite reportado pelo
Chromium: `286,000,000` bytes. Memoria especifica do worker/WASM, GPU, video e
memoria nativa nao e exposta por `performance.memory` e permanece para T7.4/T7.5.

## Avisos esperados

O smoke hosted HTTP registra falha de Service Worker por origem insegura e ausencia
da API Cast. Esses avisos sao esperados no hosted HTTP/emulador e nao bloquearam o
worker nem o core; Service Worker hosted HTTPS e Cast ficam nas tarefas de plataforma
e player.

## Regressoes executadas

```text
Jest: 7 suites, 102 testes, passou
Lint: passou
Build desktop: passou
Build webOS: passou
ES-Check: 6/6 arquivos ES2018
Hosted build: passou
Core WASM static/runtime verification: passou
```

O smoke foi executado no modo hosted. O modo packaged continua dependente da T6.4.
