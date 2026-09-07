# T1.8 - Terser e minificacao

Data: 2026-09-06
Branch: `webos`
HEAD: `c481b4ee6204120b7f96df01bbbbe5eb28c82c31`
Alvo: webOS TV 5 / Chromium 68.0.3440.106
Node: `v22.18.0`
pnpm: `11.8.0`

## Decisao

`webpack.config.js` mantem a mesma configuracao de minificacao para desktop e
webOS:

- `optimization.minimize: true`;
- `TerserPlugin` aplicado a arquivos JavaScript;
- `terserOptions.ecma: 5`;
- `mangle: true`;
- `output.comments: false` e `beautify: false`;
- `output.wrap_iife: true`;
- `extractComments: false`.

`safari10: false` nao foi adicionado. O valor padrao ja e `false` e o workaround
nao tem relacao com o Chromium 68. Terser continua sendo tratado como minificador;
a compatibilidade de sintaxe continua protegida por Babel, pela transpile-list e
pelo ES-Check.

## Implementacao

Foi adicionado um teste de contrato em
[`tests/webosTranspilation.spec.js`](../tests/webosTranspilation.spec.js). O teste
confirma a configuracao efetiva do plugin nos modos development e production, com
webOS habilitado e desabilitado. Os testes existentes continuam exercitando os
loaders reais e o minificador em fixtures JS, TS e TSX.

## Verificacoes

| Verificacao | Resultado |
|---|---|
| `pnpm test --runInBand` | 7 suites, 107 testes passaram |
| `pnpm lint` | Passou |
| Build desktop | Passou; 2 warnings conhecidos de tamanho |
| Build webOS standard | Passou; 2 warnings conhecidos de tamanho |
| Build webOS debug | Passou; 2 warnings conhecidos de tamanho |
| `check:webos-compat` standard | 6/6 arquivos ES2018 |
| `check:webos-compat` debug | 6/6 arquivos ES2018 |
| `verify:hosted-build` webOS | 52 referencias verificadas |
| `verify:webos-debug` | Diagnosticos presentes somente no debug |
| Equivalencia desktop | 85/85 arquivos, `equal: true` |
| Equivalencia webOS | 85/85 arquivos, `equal: true` |

As comparacoes normalizaram somente `service-worker.js.map`. Nenhum outro arquivo
ou diferenca foi ignorado.

## Smoke no emulador

O build webOS debug, que usa o mesmo pipeline de Terser do build standard, foi
servido via hosted HTTP ao emulador webOS TV 5.0.0.

- Intro: 5/5 recargas passaram;
- Board: 1/1 rodada passou;
- `#app`: 6 filhos;
- controles da Intro presentes;
- Board visivel;
- `queueMicrotask`: ordem `microtask -> timer`;
- nenhuma chave de traducao crua;
- `unexpectedErrors`: lista vazia.

O build webOS standard tambem foi carregado no emulador. O probe do core confirmou
`appChildren: 6`, `hasCore: true`, WASM compilavel no Chromium 68 e
`getState('ctx')` resolvendo para objeto. O WASM tem 5.187.435 bytes e nao possui
tipos de referencia.

Avisos esperados no hosted HTTP: registro de Service Worker bloqueado por origem
insegura, API Cast ausente, politica de autoplay e fetches de catalogo sem endpoint
disponivel.

## Evidencias

- `tests/webos/t18-ui-smoke.json`
- `tests/webos/t18-board-smoke.json`
- `C:/Users/gabri/AppData/Local/Temp/opencode/stremio-t18-baseline-desktop`
- `C:/Users/gabri/AppData/Local/Temp/opencode/stremio-t18-candidate-desktop`
- `C:/Users/gabri/AppData/Local/Temp/opencode/stremio-t18-baseline-webos`
- `C:/Users/gabri/AppData/Local/Temp/opencode/stremio-t18-candidate-webos`
- `C:/Users/gabri/AppData/Local/Temp/opencode/stremio-t18-candidate-debug`

## Limites

O smoke foi hosted HTTP no emulador. O modo packaged frio permanece no escopo da
T6.4, e a validacao em TV real permanece no risco R15.
