# T1.7 - Boot da UI React 18 no Chromium 68

Data: 2026-09-06
Branch: `webos`
HEAD: `c481b4ee6204120b7f96df01bbbbe5eb28c82c31`
Alvo: webOS TV 5 / Chromium 68.0.3440.106
Firmware: 02.00.30
Modo: hosted HTTP no emulador

## Implementacao

- `src/index.js` ganhou marcas debug-only para a carga dos recursos de i18n e a
  inicializacao do `i18next`. O caminho desktop nao cria essas marcas.
- `src/webos/diagnostics/runtime.js` expoe `mark()` no snapshot de diagnostico.
- `scripts/verify-webos-ui.mjs` executa o smoke via CDP, recarrega a pagina, captura
  console/exception, valida a UI, verifica `queueMicrotask` e arquiva metricas.
- `pnpm verify:webos-ui` foi adicionado ao `package.json`.

## Procedimento

```powershell
corepack pnpm build:webos:debug
corepack pnpm check:webos-compat
corepack pnpm verify:hosted-build
corepack pnpm verify:webos-ui build --cdp <target> --route '#/intro' --runs 5 --output tests/webos/t17-ui-smoke.json
corepack pnpm verify:webos-ui build --cdp <target> --route '#/' --runs 1 --output tests/webos/t17-board-smoke.json
corepack pnpm verify:webos-ui build --cdp <target> --route '#/debug' --runs 1 --output tests/webos/t17-debug-smoke.json
```

## Resultado

### Intro, cinco recargas frias

| Medicao | Resultado |
|---|---:|
| `#app` com filhos | 6 em 5/5 rodadas |
| Controles da Intro | presentes em 5/5 |
| Chaves de traducao cruas | 0 |
| `queueMicrotask` | disponivel; ordem microtask -> timer em 5/5 |
| `entry` -> `app-render` | 2,760.0-2,860.6 ms |
| `entry` -> `core-ready` | 2,760.0-2,860.6 ms |
| `entry` -> FCP | 3,519.7-3,589.9 ms |
| Heap JS observado | 18.2 MiB |
| Limite de heap reportado | 286 MiB |

### Board

- Rota final: `/`.
- `board-visible`: 3,490.2 ms desde a navegacao.
- `board-interactive`: 3,490.2 ms desde a navegacao.
- Elementos focaveis: 9.
- Chaves de traducao cruas: 0.
- `queueMicrotask`: passou.
- Heap JS: 18.2 MiB.

### i18n

- `stremio-translations` carregou 51 modulos JSON no bundle.
- O build reportou 5.99 MiB de modulos JSON e `main.js` com 9,344,206 bytes.
- Carga dos recursos: 129.4-149.0 ms nas cinco rodadas; mediana de 140.6 ms.
- `i18n-ready` ocorreu 324.7-390.2 ms apos `entry`.
- A inicializacao apos os recursos ficou entre aproximadamente 3 e 5 ms.

### Console

Nenhuma excecao inesperada foi capturada. Os registros conhecidos foram:

- registro de Service Worker rejeitado por origem HTTP insegura;
- `window.cast` indisponivel no emulador;
- aviso de politica de autoplay do Web Audio no Chromium 68;
- tentativas de fetch do core sem endpoint de catalogo disponivel no smoke.

Os snapshots sanitizam URLs e nao contem tokens, dados de perfil ou URLs privadas.

## Limites

- O FCP observado em hosted HTTP ficou acima do budget preliminar de 1.5 s. Esse
  budget foi definido para packaged frio; a medicao hosted nao deve ser comparada
  diretamente e deve ser repetida na T6.4.
- O caminho packaged completo depende do `.ipk` da T6.4.
- O `deep-freeze` real do `WebOsVideo` nao e exercitado pelo boot da Intro/Board;
  o smoke confirmou `Object.freeze` disponivel e deixa o fluxo do player para a
  Fase 5.

## Evidencias

- `tests/webos/t17-ui-smoke.json`
- `tests/webos/t17-board-smoke.json`
- `tests/webos/t17-debug-smoke.json`
- `webos/t16-core-wasm.md`

## Aceite T1.7

- [x] `createRoot` + `StrictMode` montam a UI no Chromium 68.
- [x] i18n inicializa com as traducoes carregadas e sem chaves cruas na UI.
- [x] `queueMicrotask` e o scheduler concluem o boot sem erro.
- [x] Intro e Board renderizam no emulador.
- [ ] Repetir o mesmo smoke no packaged frio quando a T6.4 produzir o `.ipk`.
