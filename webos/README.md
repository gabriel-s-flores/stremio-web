# webOS Branch

> Branch de longa duração para o port do Stremio Web para **webOS TV 5** (Chromium 68).
> Criado a partir de `development`, conforme decisão **D9** das Decisões Arquiteturais do Port.

## Estratégia

Mesmo repositório + branch `webos` (opção "monorepo por flag", D9). O upstream oficial
(Stremio/stremio-web) continua sendo incorporado periodicamente — não é um fork hard.

## O que este branch carrega de diferente

As diferenças em relação a `development` ficam concentradas em:

1. **`src/common/Platform`** — módulo de plataforma (detecção/capabilities de `webos`).
2. **Webpack config condicional** — flag de build `WEBOS=1` (Fase 0, T0.7) com
   transpile/compatibilidade para Chromium 68.
3. **Esta pasta `webos/`** — assets do app para webOS (`appinfo.json`, ícones, scripts
   de empacotamento `ares-*`).
4. **Compatibilidade de entry** — `webpack.config.js` injeta `core-js/stable`
    antes dos entries `main` e `worker` somente com `WEBOS=1`; `tsconfig.webos.json`
    mantém o emit TypeScript em ES2018 sem afetar o desktop. `src/index.js` possui
    apenas marcas de boot quando `WEBOS_DEBUG=1`.

Nenhum código do app desktop é alterado fora desses pontos; o build normal deve
permanecer bit-a-bit igual quando `WEBOS` não está definida.

## Cadência de sync com o upstream

**Gatilho:** a cada tag `v5.0.0-beta.*` publicada no upstream (Stremio/stremio-web).

**Fluxo:**

```powershell
git checkout development
git fetch upstream --tags
git merge --ff-only upstream/development
git push origin development

git checkout webos
git rebase development
git push --force-with-lease origin webos
```

- O rebase mantém o histórico linear e os commits do port sempre no topo, fáceis de inspecionar.
- `--force-with-lease` é obrigatório após o rebase (histórico reescrito) e é seguro aqui
  porque há apenas um mantenedor.
- **Alternativa:** se um ciclo de rebase ficar conflituoso demais, usar
  `git merge development` naquele ciclo e registrar a exceção aqui neste README.

## Status das fases do port

| Fase | Descrição | Status |
|---|---|---|
| 0 | Fundação e Setup | 🟡 Em andamento (T0.1–T0.8 concluídas; critério de TV real continua aberto) |
| 1 | Build e Compatibilidade JS | 🟡 Em andamento (T1.1–T1.9 implementadas; proteção de merge pendente; packaged aguarda T6.4) |
| 2 | CSS e Layout | ⬜ Pendente |
| 3 | Plataforma webOS | ⬜ Pendente |
| 4 | Navegação TV e Controle Remoto | ⬜ Pendente |
| 5 | Player, Vídeo e Streaming | ⬜ Pendente |
| 6 | Empacotamento e Pipeline | ⬜ Pendente |
| 7 | Testes, Performance e Qualidade | ⬜ Pendente |
| 8 | Distribuição e Lançamento | ⬜ Pendente |

Planejamento detalhado por fase e decisões (D1–D10): vault do projeto em
`obsidian/stremio/11 - Port webOS 5/`.

## T1.2 — Polyfills

`core-js@3.49.0` entra em ambos os entries webOS antes da aplicação e do worker WASM,
pois workers não compartilham os globais da janela. O build normal mantém os mesmos
entries e o mesmo output. A auditoria de sintaxe T1.4 agora transpila somente os pacotes
incompatíveis (`i18next`, `react-i18next` e `use-long-press`); o smoke no emulador e o
init do core continuam nas T1.6/T1.7.

## T1.3 — Babel preset-env

A seleção de `Chrome 68` no Babel já estava configurada pela T1.1. Os testes em
[`tests/webosTranspilation.spec.js`](../tests/webosTranspilation.spec.js) agora
protegem essa seleção e validam `?.`, `??` e campos de classe em bundles isolados
JS/TS/TSX, usando os loaders e o minificador reais nos builds webOS normal/debug.
As saídas passam em ES2018 e preservam o comportamento dos operadores e campos.

`es-check@9.6.4` está fixado em `devDependencies`. Não foi adicionado `corejs: 3`
ao preset: a T1.2 usa `core-js/stable` explícito nos entries, sem `useBuiltIns`.
TS/TSX continuam com target ES2018 no `ts-loader`, sem uma segunda etapa Babel.

Os 91 testes e os builds passaram; desktop e webOS ficaram equivalentes aos
baselines em 85 arquivos, normalizando somente o caminho temporário no source map
do Workbox. No baseline da T1.3, `i18next`, `react-i18next` e `use-long-press`
continham sintaxe incompatível; a T1.4 corrigiu o bundle webOS sem alterar o desktop.
Evidências da T1.3: [T1.3 - Transpilação](t13-transpilation.md).

## T1.4 - Auditoria de compatibilidade ES2018

`tools/check-es-compat.mjs` percorre todos os arquivos `build/**/*.js` e executa o
parser ES2018 do `es-check@9.6.4`, incluindo `main.js`, `worker.js`, chunks e os dois
artefatos do Service Worker. A regra Babel mantém `node_modules` excluído no desktop e
abre exceções somente no build webOS para `i18next`, `react-i18next` e `use-long-press`.

O build webOS final passou em 6/6 arquivos. O relatório completo, com hashes e a
explicação da descoberta transitiva de `react-i18next`, está em
[`webos/t14-es-compatibility.md`](t14-es-compatibility.md).

## T1.6 - Worker do core (WASM) no Chromium 68

`@stremio/stremio-core-web@0.62.1` emitia tipos `externref` no WASM e falhava no
Chromium 68 com `invalid local type @+151`. O branch fixa `0.57.0`, cujo artefato
nao usa tipos de referencia e compila no emulador. O worker continua passando no
ES-Check sem nova excecao Babel.

O smoke hosted confirmou `transport.init`, `window.core` e `getState('ctx')`. O
verificador estatico e o probe opcional do emulador podem ser executados com:

```powershell
corepack pnpm verify:webos-core
node scripts/verify-webos-core.mjs build --cdp 10.0.2.2
```

Evidencia detalhada: [`webos/t16-core-wasm.md`](t16-core-wasm.md). A memoria do
worker/WASM continua sem metrica direta e sera refinada na T7.4; o modo packaged
continua na T6.4.

## T1.7 - Boot da UI React 18

O build debug agora mede as fases de carga dos recursos de i18n e inicializacao do
`i18next`. O verificador CDP `pnpm verify:webos-ui` recarrega o app no Chromium 68,
captura excecoes, valida Intro/Board, testa `queueMicrotask` e arquiva snapshots
sanitizados em `tests/webos/t17-*.json`.

O smoke hosted passou em cinco recargas da Intro e em uma rodada da Board. O
`createRoot`/`StrictMode`, o core, o i18n e a UI completaram o boot sem erros
inesperados. Avisos de Service Worker em HTTP, Cast indisponivel e fetchs de
catalogo sao esperados neste modo. O packaged frio sera repetido na T6.4.

Evidencia detalhada: [`webos/t17-react-ui.md`](t17-react-ui.md).

## T2.1/T2.10 - Player, Flexbox e screenshots

O build debug inclui `#/debug/player`, um fixture estático que monta os componentes
reais do Player com tracks de áudio/legendas, estatísticas, Cast, episódios, SideDrawer
e NextVideoPopup. Isso permite testar os overlays sem depender do endpoint de tracks ou
de um `WebOsVideo` real no emulador.

```powershell
corepack pnpm build:webos:debug
corepack pnpm verify:webos-ui build --cdp <target> --route '#/debug/player' --player --strict-player --screenshots tests\webos\t21-player-fixture-screenshots --output tests\webos\t21-player-fixture-smoke.json
```

`--strict-player` exige a abertura dos menus de buttons, velocidade, opcoes, legendas,
audio, estatisticas, Cast, videos e SideDrawer, alem da visibilidade do NextVideoPopup.
O fixture e restrito a `WEBOS_DEBUG=1`; o build webOS normal continua sem a rota.
O resultado validado no emulador esta em
[`tests/webos/t21-player-fixture-smoke.json`](../tests/webos/t21-player-fixture-smoke.json),
com a galeria em `tests/webos/t21-player-fixture-screenshots/`.

## T1.9 - Gate de CI

O workflow [`webos-build-check.yml`](../.github/workflows/webos-build-check.yml)
executa automaticamente em pushes para `webos`, pull requests destinados a `webos`
e execucoes manuais selecionadas nessa branch. O job se chama
`webos-build-check` e usa Node da `.nvmrc`, pnpm `11.8.0` e lockfile congelado.

Os passos obrigatorios sao executados sobre o mesmo artefato:

```text
pnpm build:webos
pnpm check:webos-compat
pnpm test
pnpm lint
```

`check:webos-compat` percorre todos os JavaScript gerados, exige o `worker.js` e
retorna falha quando qualquer arquivo nao passa em ES2018. O build desktop continua
no workflow separado `build.yml`; o gate webOS nao publica no GitHub Pages.

O workflow manual `webos.yml` repete o checker quando `build_target=webos` e
preserva arquivos ocultos no artefato de deploy. A protecao da branch deve exigir o
status `webOS Build Check / webos-build-check` antes do merge.

Evidencia e resultado da execucao: [`webos/t19-build-check.md`](t19-build-check.md).

## T0.5 — Hosted deployment

O workflow manual [`.github/workflows/webos.yml`](../.github/workflows/webos.yml)
builda, valida, publica e pode reverter o hosted webOS sem alterar o workflow do
desktop. Ele deve ser executado a partir da branch `webos`.

### Build

- `standard` usa `pnpm build` e mantém o artefato desktop sem as rotas de diagnóstico.
- `webos` usa `pnpm build:webos`.
- Ambos os caminhos executam `pnpm install --frozen-lockfile`, testes, lint e
  `pnpm verify:hosted-build` antes do upload do artefato.

### Servidor

O origin SSH esperado usa este layout, com o reverse proxy apontando para `current`:

```text
/var/www/stremio-web/
├── current -> releases/<commit-sha>
└── releases/
    ├── <commit-sha-1>/
    └── <commit-sha-2>/
```

O deploy envia o novo diretório antes de trocar `current` atomically. Releases
anteriores não devem ser removidas durante a janela de retenção, pois clientes
controlados por um Service Worker antigo ainda podem requisitar seus assets.
Como regra inicial, manter pelo menos 30 dias ou as três releases mais recentes,
o que for maior; a limpeza deve ser uma operação separada e auditada.

### Secrets por environment

Configure os valores em `staging` e `production` no GitHub Environments:

| Secret | Uso |
|---|---|
| `HOSTED_SSH_HOST` | Host SSH do origin |
| `HOSTED_SSH_PORT` | Porta SSH, opcional; default 22 |
| `HOSTED_SSH_USER` | Usuário sem privilégios de root |
| `HOSTED_SSH_PRIVATE_KEY` | Chave privada dedicada ao deploy |
| `HOSTED_SSH_KNOWN_HOSTS` | Chave pública fixada do host |
| `HOSTED_RELEASES_PATH` | Diretório remoto de releases |
| `HOSTED_CURRENT_PATH` | Symlink remoto `current` |
| `HOSTED_BASE_URL` | URL HTTPS pública na raiz do host |
| `HOSTED_HTTP_BASE_URL` | URL HTTP para validar o redirecionamento; opcional |

O reverse proxy deve terminar TLS, servir o diretório `current` e apontar o
subdomínio escolhido para esse origin. O workflow não cria DNS nem certificados.
Embora T0.4 tenha validado `web.stremio.com`, uma verificação de T0.5 encontrou
`Cache-Control: public, max-age=14400` no `service-worker.js` dessa origem. Ela não
deve ser considerada aprovada para esta política sem ajuste ou sem um host dedicado.

### Operação

- `action=deploy` publica uma nova release e executa o smoke test HTTP.
- `action=rollback` recebe o SHA completo de uma release já existente e troca o
  symlink atomically antes de validar o endpoint.
- O endpoint deve ser um host dedicado na raiz, por exemplo `tv.stremio.com`;
  o nome definitivo ainda precisa ser decidido pelo responsável da infraestrutura.

## T0.6 — Ambiente de medição

O runtime de diagnóstico só entra no build quando as flags `WEBOS=1` e
`WEBOS_DEBUG=1` são informadas. O build normal e `build:webos` não expõem a rota.

```powershell
# Build do app com a rota #/debug e o runtime de métricas
corepack pnpm build:webos:debug
corepack pnpm verify:webos-debug build debug

# Depois de abrir o app e localizar o alvo no CDP:
node webos\hello\tools\cdp.mjs list
node webos\hello\tools\cdp.mjs eval <id-ou-url> "location.hash = '#/debug'"
node webos\hello\tools\cdp.mjs debug <id-ou-url> tests\webos\t06-snapshot.json
```

A página mostra user agent, origem, viewport, versão, marcas de boot, Paint Timing,
heap JS e a amostra de FPS do scroll. O comando `debug` também retorna o snapshot
JSON para arquivamento sem enviar dados para um servidor.

Budgets iniciais documentados para o T0.6:

| Métrica | Alvo inicial |
|---|---|
| First Paint/FCP | p95 <= 1,5 s no packaged frio |
| Boot até Board interativa | p95 <= 5 s |
| Heap JS | <= 256 MiB após boot; <= 384 MiB durante scroll |
| Scroll | >= 45 FPS; p95 de frame <= 22,2 ms |

`performance.memory` mede apenas o heap JS da página. GPU, vídeo, worker/WASM e
memória nativa precisam ser confirmados por CDP/hardware nas fases T1.6 e T7.4.
O baseline principal ainda depende da compatibilidade do app completo com Chromium 68
(Fase 1) e do empacotamento `.ipk` (Fase 6); o `hello` permanece o instrumento para
falhas anteriores ao React/CoreProvider.
