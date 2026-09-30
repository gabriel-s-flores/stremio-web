# T1.3 - Babel preset-env e transpilacao do codigo-fonte

Data: 2026-09-06

## Escopo e decisoes

A selecao do target ja estava implementada na T1.1. Esta tarefa adiciona testes de
regressao e `es-check@9.6.4` como dependencia de desenvolvimento, sem mudar a
configuracao de producao ou o codigo da aplicacao.

- JavaScript usa `@babel/preset-env` com `browserslistEnv: 'webos'` somente quando
  `WEBOS=1`; o ambiente do `package.json` define `Chrome 68`.
- Desktop continua com `ignoreBrowserslistConfig: true`.
- TS/TSX usam `ts-loader` com `tsconfig.webos.json`, target `ES2018`; nao foi
  adicionada uma segunda etapa Babel para TypeScript.
- A T1.2 mantem `core-js/stable` explicito antes do main e do worker. Nao foi
  adicionado `corejs: 3` ao preset: essa opcao se aplica a `useBuiltIns: 'entry'`
  ou `'usage'`, que nao sao a estrategia atual de injecao de polyfills.
- `terserOptions.ecma: 5` permanece intacto; minificacao nao substitui transpilacao.
- A exclusao de `node_modules` permanece intacta. Auditoria geral, transpile-list
  e gate de CI continuam nas T1.4/T1.9.

## Testes automatizados

[`tests/webosTranspilation.spec.js`](../tests/webosTranspilation.spec.js) adiciona
14 casos ao Jest:

- Tres controles negativos confirmam que ES2018 rejeita `?.`, `??` e campos de classe.
- Cinco casos conferem Babel, Browserslist, selecao do tsconfig e entries em
  desktop, webOS desligado, debug sem webOS, webOS normal e webOS debug.
- Seis bundles isolados (JS, TS e TSX em webOS normal/debug) usam as regras reais
  de loaders e o minificador da configuracao de producao. Todos passam no ES-Check
  ES2018 e sao executados em um contexto VM para conferir os exports.

Os testes exercitam campos estaticos/de instancia, acessos nulos ou ausentes e
preservacao de `0`, `false` e `''` pelo operador `??`. TS inclui uma anotacao de
tipo e TSX inclui JSX. Os exports sao consumidos pelos testes para impedir que
um bundle vazio ou codigo eliminado pelo minificador passe como evidencia.

Somente o prewarm do thread-loader e substituido por um mock; os loaders continuam
reais. Os bundles de teste substituem entries/output e removem plugins de assets,
HTML, SW e aplicacao para nao incluir dependencias fora do escopo. Usam diretorios
temporarios exclusivos, fecham o compilador e removem os artefatos ao terminar.

## Ambiente e baseline

| Item | Valor |
|---|---|
| HEAD | `c481b4ee6204120b7f96df01bbbbe5eb28c82c31` |
| Node | `v22.18.0` |
| pnpm | `11.8.0` via Corepack |
| Webpack | `5.106.2` |
| Babel core / preset-env | `7.29.0` / `7.29.3` |
| TypeScript | `5.9.3` |
| ES-Check | `9.6.4` |

Os baselines foram gerados antes dos edits da T1.3, a partir do worktree local
com as alteracoes anteriores preservadas, nao de um checkout limpo de HEAD.
Todos os builds usaram o mesmo repositorio, com `--output-path` separado para
nao sobrescrever `build/` nem os baselines. Os cinco destinos nao existiam antes.

Raiz local dos artefatos: `C:/Users/gabri/AppData/Local/Temp/opencode`.

| Build | Diretorio | Tempo Webpack | Resultado |
|---|---|---|---|
| Baseline desktop | `stremio-t13-baseline-desktop` | 33,266 s | Sucesso |
| Baseline webOS | `stremio-t13-baseline-webos` | 30,485 s | Sucesso |
| Candidato desktop | `stremio-t13-candidate-desktop` | 28,014 s | Sucesso |
| Candidato webOS | `stremio-t13-candidate-webos` | 28,095 s | Sucesso |
| Candidato debug | `stremio-t13-candidate-debug` | 27,718 s | Sucesso |

Todos apresentaram somente dois warnings de performance do Webpack: tamanho de
asset e de entrypoint acima dos 244 KiB recomendados. Nao sao erros de sintaxe.

## Resultados

| Verificacao | Resultado |
|---|---|
| `pnpm test` | 6 suites, 91 testes passaram (14 novos) |
| `pnpm lint` | Passou |
| ESLint do novo spec com globals Jest | Passou |
| `pnpm install --frozen-lockfile` | Passou |
| Equivalencia desktop | 85/85 arquivos, `equal: true`, zero diferencas apos normalizacao |
| Equivalencia webOS | 85/85 arquivos, `equal: true`, zero diferencas apos normalizacao |
| `verify:webos-debug` | Diagnosticos ausentes em desktop/webOS, presentes em debug |
| `verify:hosted-build` | Passou nos tres candidatos, 52 referencias verificadas em cada |
| ES2018 dos seis bundles de teste | Passou |
| ES2018 dos candidatos completos | 5 de 6 JS passaram em cada; `main.js` falhou |

A comparacao normalizou **somente o caminho temporario em `service-worker.js.map`**
usando o verificador existente. Nao foram excluidos arquivos ou ignoradas outras
diferencas. Nao houve mudanca nos bundles desktop/webOS que precisasse corrigir
sintaxe do codigo-fonte: os testes protegem a configuracao que ja funcionava.

## Falhas residuais e handoff

| Artefato | Primeiro erro ES2018 | Origem via source map |
|---|---|---|
| Baseline webOS `main.js` | `Unexpected token (1:737242)` | `i18next/dist/cjs/i18next.js:63:8` |
| Candidato desktop `main.js` | `Unexpected token (1:737246)` | Mesma origem |
| Candidato webOS `main.js` | `Unexpected token (1:737242)` | Mesma origem |
| Candidato debug `main.js` | `Unexpected token (1:737242)` | Mesma origem |

O trecho original e `last?.obj`. Colunas sao base zero; o source map aponta para
o inicio da expressao. A verificacao direta de `i18next@24.2.3` falha no entry CJS
em `63:13` e no ESM em `61:13`.

`use-long-press@3.3.0` tambem falha isoladamente: CJS `index.js:1:1894` e ESM
`index.mjs:78:169`, com nullish coalescing. Os source maps confirmam os entries
CJS de ambos os pacotes nos bundles. O parser para no primeiro erro de cada
arquivo; uma falha reportada em `main.js` nao significa uma unica ocorrencia.

Worker, chunks `203.js`/`989.js`, Service Worker e runtime Workbox passaram no
ES2018 dos tres candidatos. Nenhuma outra dependencia foi auditada individualmente.
A T1.4 deve corrigir os pacotes incompativeis e repetir a auditoria completa.

Na tentativa inicial, a CLI do ES-Check excedeu 120 s ao formatar/mapear o erro do
bundle grande. A verificacao foi concluida pela API publica `runChecks`, sem
logger, mantendo o mesmo parser ES2018. As posicoes retornadas foram mapeadas
separadamente com `@jridgewell/trace-mapping@0.3.31`, ja instalado via Babel.

ES2018 e um filtro de sintaxe, nao uma certificacao do Chromium 68. A VM usa Node,
nao o emulador. Boot React, init WASM e validacao em TV continuam pendentes nas
T1.6/T1.7 e tarefas de hardware; os criterios globais da fase 1 nao foram fechados.

## Comandos de reproducao

Gerar os baselines antes de aplicar alteracoes; gerar os candidatos depois.
Os caminhos abaixo correspondem aos artefatos preservados desta execucao.
Para uma nova execucao, escolha nomes novos para nao sobrescrever esses artefatos.

```powershell
$P = 'C:/Users/gabri/AppData/Local/Temp/opencode'
corepack pnpm build --output-path "$P/stremio-t13-baseline-desktop"
corepack pnpm build:webos --output-path "$P/stremio-t13-baseline-webos"

corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm lint
corepack pnpm exec eslint tests/webosTranspilation.spec.js --global jest --global beforeAll --global afterAll --global test --global expect --global describe
corepack pnpm build --output-path "$P/stremio-t13-candidate-desktop"
corepack pnpm build:webos --output-path "$P/stremio-t13-candidate-webos"
corepack pnpm build:webos:debug --output-path "$P/stremio-t13-candidate-debug"

corepack pnpm verify:build-equivalence "$P/stremio-t13-baseline-desktop" "$P/stremio-t13-candidate-desktop" --normalize-workbox-sourcemap
corepack pnpm verify:build-equivalence "$P/stremio-t13-baseline-webos" "$P/stremio-t13-candidate-webos" --normalize-workbox-sourcemap
corepack pnpm verify:webos-debug "$P/stremio-t13-candidate-desktop" standard
corepack pnpm verify:webos-debug "$P/stremio-t13-candidate-webos" standard
corepack pnpm verify:webos-debug "$P/stremio-t13-candidate-debug" debug
corepack pnpm verify:hosted-build "$P/stremio-t13-candidate-desktop"
corepack pnpm verify:hosted-build "$P/stremio-t13-candidate-webos"
corepack pnpm verify:hosted-build "$P/stremio-t13-candidate-debug"
```

Verificacao de sintaxe sem o mapeamento automatico da CLI; repetir com os outros
diretorios. O exit code esperado neste estado e 1, por `i18next`, nao sucesso:

```powershell
node -e "const r=require('es-check').runChecks([{ecmaVersion:'es2018',files:[process.argv[1]]}]); console.log(JSON.stringify({success:r.success,errors:r.errors.map(e=>({file:e.file,message:e.err.message,line:e.line,column:e.column}))},null,2)); process.exitCode=r.success?0:1;" "$P/stremio-t13-candidate-webos/**/*.js"
```
