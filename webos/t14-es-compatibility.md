# T1.4 - Auditoria de compatibilidade ES2018

Data: 2026-09-06

## Escopo

A T1.4 fecha o risco R01 do port webOS: dependencias publicadas em `node_modules`
ficam fora do Babel por padrao e podem levar sintaxe posterior a ES2018 para o
Chromium 68. A auditoria usa o bundle final, nao apenas o entry point de cada pacote.

## Ambiente

| Item | Valor |
|---|---|
| Branch | `webos` |
| HEAD | `c481b4ee6204120b7f96df01bbbbe5eb28c82c31` |
| App | `5.0.0-beta.39` |
| Node | `v22.18.0` |
| pnpm | `11.8.0` |
| ES-Check | `9.6.4` |
| Alvo | Chromium 68 / ES2018 |
| Core web | `@stremio/stremio-core-web@0.62.1` |

## Implementacao

- `tools/check-es-compat.mjs` percorre `build/**/*.js` sem depender do glob do shell.
- O checker exige a presenca de `*/scripts/worker.js` e retorna exit code diferente de
  zero quando qualquer arquivo falha.
- `package.json` expoe o comando `pnpm check:webos-compat`.
- O desktop continua com `exclude: /node_modules/`.
- O build webOS processa somente os pacotes confirmados abaixo, inclusive quando o
  caminho real esta aninhado em `node_modules/.pnpm/`.

## Dependencias incompatíveis

| Pacote | Evidencia | Acao webOS |
|---|---|---|
| `i18next@24.2.3` | `dist/cjs/i18next.js:63`, optional chaining em `last?.obj` | Transpilar com Babel |
| `react-i18next@15.7.4` | `dist/commonjs/utils.js:12`, optional chaining em `i18n?.services` | Transpilar com Babel |
| `use-long-press@3.3.0` | `index.js:1:1894`, nullish coalescing | Transpilar com Babel |

`react-i18next` passou na verificacao superficial do entry `dist/commonjs/index.js`,
mas uma dependencia interna importada pelo bundle continha sintaxe moderna. Por isso,
o resultado do bundle final e a fonte de verdade para a transpile-list.

`@sentry/browser@8.42.0`, `react-router@6.30.0`, `react-router-dom@6.30.0` e o
entry direto de `@stremio/stremio-core-web/worker.js` passaram. `@babel/runtime`,
`@stremio/stremio-icons`, `buffer` e `url` permanecem classificados como `SKIP` na
auditoria de entry points; os imports efetivamente gerados continuam cobertos pelo
checker do bundle.

## Comandos e resultados

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build:webos
corepack pnpm check:webos-compat
corepack pnpm verify:hosted-build build
corepack pnpm test --runInBand
corepack pnpm lint
```

| Verificacao | Resultado |
|---|---|
| Build webOS | Passou; 2 warnings de tamanho de asset/entrypoint |
| ES2018 | 6/6 arquivos JavaScript passaram |
| Hosted build | Passou; 52 referencias locais verificadas |
| Jest | 6 suites, 91 testes passaram |
| Lint do codigo | Passou |
| Lint do checker/teste | Passou |
| Equivalencia desktop | 85/85 arquivos, `equal: true` |

## Artefatos

| Arquivo | SHA-256 |
|---|---|
| `scripts/main.js` | `026898633D1A9205E489736192EFE6F1FD89A17D66A2AD0EF793A700FC0022B9` |
| `scripts/worker.js` | `7F26CDFC2B801661F1797822424FD9C6D11EF33034B738F1F19160F1B52A07F8` |
| `scripts/203.js` | `8B4FA51EC0587B860AF5FA5CBE10F8185B6B84C37F1BE7F89CB828FFFCE44A68` |
| `scripts/989.js` | `846E0F0060B279BE7CC5957F8F8950517F382E74CAC8E1B12784FECCBDF8A2AD` |
| `service-worker.js` | `C3EF7D961DCE2BE38C7C36FB09CDCD6FC47EF11C4CD37AC21D3F79E50FC13539` |
| `workbox-ee13fbdc.js` | `1B9A60C891E2A9A8A181168054AA2BAE738E61FDF01C8A0896004A8ABF15BA24` |

## Limites e handoff

O checker certifica sintaxe ES2018, nao a disponibilidade de APIs em runtime. O
emulador webOS instalado nao iniciou durante esta execucao: a VM salva permaneceu
bloqueada apos o timeout de start. Smoke de React, `transport.init`, `getState('ctx')`
e medicao de memoria continuam pendentes nas T1.6/T1.7.
