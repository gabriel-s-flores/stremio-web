# Backlog do port webOS 4 (Fases 0–7)

Definições das tarefas. O **status** de cada uma fica no `PAINEL.md` (fora do repo). A ordem é a do
caminho crítico. Cada tarefa vale como um PR para `webos` a partir da branch `port/<id-minúsculo>`.

**Definição de pronto comum** (está no brief de todo implementador): lint, testes e build desktop
passam; a partir da F1.2, build webOS e checagem de sintaxe passam; critérios verificados no
emulador com evidências; relatório preenchido; PR vinculado à thread; premissas P1–P3.

**Paralelismo:** tudo que tem as dependências mergeadas pode rodar ao mesmo tempo. No início ficam
prontas F0.5, F0.7, F0.8, F0.9, F0.10, F1.1 e F5.2.

Modelos: **O** = `claude-opus-5-5`, **S** = `claude-sonnet-5-5`; effort entre parênteses.

---

## Fase 0 — viabilidade

### F0.5 · Core MVP reprodutível
- **Depende de:** —  · **Modelo:** O (high)
- **Escopo:** `webos/core/` com o script de build do `stremio-core-web` 0.65.0 como WASM MVP
  (receita A: Rust 1.77.2, `gloo-utils 0.2`, wasm-bindgen CLI 0.2.121, `wasm-opt -O
  --signext-lowering`, glue transpilada com Babel como o build oficial), partindo do clone em
  `~/webos-tv-sdk/src/stremio-core` (tag `stremio-core-web-v0.65.0`) e do patch
  `~/webos-tv-sdk/spikes/core-mvp/recipe-a.patch`. Artefatos versionados em
  `webos/vendor/stremio-core-web/` (wasm, js, worker, bridge, `package.json` `0.65.0-mvp`, `SOURCE.md`
  com origem e checksums). Gate `webos/core/check-wasm` (pode reaproveitar
  `~/webos-tv-sdk/spikes/core-mvp/scripts/wasmfeat.py`).
- **Aceite:** (1) o script reproduz o artefato (duas execuções com o mesmo checksum, ou diferença
  explicada); (2) o gate reprova o wasm oficial do npm e aprova o MVP (sem opcodes pós-MVP, sem i64
  em imports/exports, `target_features` só `mutable-globals`); (3) uma página de teste empacotada em
  `webos/tests/core-smoke/` roda no emulador: worker com o core vendorizado, `initialize_api`,
  `initialize_runtime`, `getState('ctx')` responde e uma ação que carrega um catálogo do Cinemeta
  devolve itens; (4) tempo de init e memória medidos.
- **Evidências:** log do build, saída do gate, JSON do smoke com tempos, captura do emulador.

### F0.6 · Fallback wasm2js automático
- **Depende de:** F0.5  · **Modelo:** O (high)
- **Escopo:** gerar a variante wasm2js do mesmo core (Binaryen em `~/webos-tv-sdk/tools`), com o
  patch da glue (`buffer !== wasm.memory.buffer` nas duas checagens de memória), e um carregador em
  `webos/core/` que escolhe WASM ou wasm2js em runtime (sem `WebAssembly` ou se a compilação
  falhar). Integrar ao `core-smoke`.
- **Aceite:** no emulador, o smoke passa com WASM e passa com `WebAssembly` escondido (usando
  wasm2js); tamanho, tempo de init e memória das duas variantes comparados.
- **Evidências:** saídas dos dois smokes, tabela comparativa.

### F0.7 · Certificados Let's Encrypt no Chromium 53
- **Depende de:** —  · **Modelo:** O (high)
- **Escopo:** spike em `webos/spikes/tls/`. Problema: o Chromium 53 do emulador recusa cadeias Let's
  Encrypt (`net::ERR_INSECURE_RESPONSE`), o que derruba os pôsteres de `images.metahub.space` e
  hosts como `debrid-link.com` (ver PESQUISA, seção 7). Avaliar: (a) serviço JS do webOS (Node
  0.12) atuando como proxy local com a CA ISRG embutida; (b) proxy de imagens com cadeia compatível;
  (c) HTTP onde o host permitir; (d) outra saída. Escolher, prototipar e documentar.
- **Aceite:** no emulador, (1) um pôster de `images.metahub.space` aparece numa `<img>` do app de
  teste por meio da solução; (2) um `fetch` a um host Let's Encrypt funciona por meio da solução;
  (3) documento com decisão, riscos, custo de desempenho e plano de integração para a F3.7.
- **Evidências:** capturas, logs de rede via CDP, documento.

### F0.8 · Persistência entre atualizações do app
- **Depende de:** —  · **Modelo:** S (high)
- **Escopo:** spike em `webos/spikes/persistence/` com duas versões de uma sonda (v1 grava, v2 lê):
  localStorage, IndexedDB, cookies e o que mais for relevante para o core (`local_storage_*`).
- **Aceite:** tabela medida no emulador do que sobrevive a: atualização (`ares-install` de versão
  nova), reboot, desinstalar + reinstalar; recomendação para a F3.5.
- **Evidências:** saídas das sondas, tabela.

### F0.9 · Perfil C8 no emulador
- **Depende de:** —  · **Modelo:** S (high)
- **Escopo:** opção `--profile c8` no `webos/tools/emulator-qemu.sh` e no `emu-run` que aproxime a
  CPU da C8 (ex.: menos vCPUs e cota de CPU via `systemd-run --user --scope -p CPUQuota=…` em volta do
  QEMU) e mantenha 1 GB; documento `webos/docs/BASELINE-C8.md` com a justificativa da cota.
- **Aceite:** perfil aplicável por variável/opção; baseline medido com e sem perfil (tempo até a
  sonda completar, compilação do core MVP via `wasm-compile-test.sh`).
- **Evidências:** tabela de medições, comandos.

### F0.10 · Bateria de testes de mídia
- **Depende de:** —  · **Modelo:** S (high)
- **Escopo:** `webos/tools/media-suite`: lê uma lista de cenários (JSON: URL, duração, seek,
  expectativas de faixas/eventos), roda cada um num `emu-run` (em paralelo no pool), usa
  `media-server.mjs` e `play-test.sh`, gera relatório markdown. Inclui `gen-media.sh` e uma pasta de
  **cabeçalhos** reais (só os primeiros MB) de amostras públicas DV P5/P7/P8.1, DD+ Atmos, TrueHD e
  DTS, com fonte e licença registradas, para os testes de parsing da F5.2/F5.3.
- **Aceite:** os 7 cenários sintéticos rodam em paralelo e o relatório mostra o resultado de cada
  um; cabeçalhos baixados e catalogados.
- **Evidências:** relatório da bateria, catálogo das amostras.

### F0.11 · Init do core no perfil C8 (remediação do G0)
- **Depende de:** F0.5, F0.9 (usa o loader da F0.6 quando mergeado)  · **Modelo:** O (high)
- **Escopo:** spike em `webos/spikes/core-init/`. No perfil c8 o core leva ~21–29 s (WASM: `WebAssembly.compile`
  síncrono do V8 5.8) e ~23–24 s (wasm2js: parse de 32,7 MB) contra a meta de 10 s do G0. Medir com o host livre,
  quebrar o tempo por etapa, verificar se a UI fica bloqueada enquanto o core compila e testar remediações
  (build otimizado para tamanho, compilação fora do caminho crítico com o Board renderizado antes, cache de código
  do V8 para o wasm2js no 2º boot, dividir o wasm2js, outras).
- **Aceite:** tabela variante × (init por etapa, tempo até a 1ª tela útil, memória pico/estável) no perfil c8,
  ≥ 3 execuções por variante com o host livre; recomendação para o G0 com a variante escolhida e o custo de
  adotá-la; se alguma variante atingir a meta (ou uma meta revista por tempo até a 1ª tela útil), PR com ela
  mantendo build reprodutível e o gate `check-wasm`.
- **Evidências:** JSONs dos smokes, tabela, capturas.

### F0.12 · Trava do pool de emuladores não pode ser herdada pelo QEMU
- **Depende de:** —  · **Modelo:** S (high)
- **Escopo:** `webos/tools/emu-run` e `webos/tools/emulator-qemu.sh`. Hoje o QEMU (lançado em segundo plano,
  pai `systemd --user`) herda o FD do `flock` da reserva; se o `emu-run` morre (crash do host, reinício do T3,
  kill do agente), o QEMU órfão segura `~/webos-tv-sdk/run/emu-N.lock` e a instância fica travada para sempre
  (aconteceu com as 4 instâncias em 2026-10-10). Fechar o FD da trava antes de lançar o QEMU (e qualquer outro
  processo em segundo plano), e ao adquirir uma trava detectar/limpar QEMU órfão daquela instância (pidfile).
- **Aceite:** matar o `emu-run` com SIGKILL no meio de uma reserva libera a trava (ou a próxima reserva limpa o
  órfão e segue); comportamento padrão e perfil c8 inalterados; teste automatizado do cenário.
- **Evidências:** saída do teste de kill, `fuser` das travas antes/depois.

### G0 · Gate de viabilidade
- **Depende de:** F0.5, F0.6, F0.7, F0.9
- **Critérios:** core (WASM e wasm2js) inicializa no perfil C8 em menos de 10 s; a F0.7 tem
  solução funcionando; memória projetada do app abaixo de ~250 MB. Reprovado → parar as Fases 1+
  que dependem dele e avisar o Gabriel.

## Fase 1 — build webOS e primeiro boot

### F1.1 · Esqueleto do build webOS
- **Depende de:** —  · **Modelo:** O (high)
- **Escopo:** config de webpack do webOS **separada** (ex.: `webos/webpack/` importando a config
  base e sobrescrevendo), com arquivos distintos por assunto (`babel`, `polyfills`, `core`, `trim`,
  `postcss`) para as tarefas seguintes editarem arquivos diferentes; saída `build-webos/` com caminhos
  relativos; sem Workbox/PWA/Service Worker; `webos/app/appinfo.json` (`disableBackHistoryAPI`,
  `resolution` 1920x1080, `handlesRelaunch`), ícones, webOSTV.js 1.2.13 baixado da LG e versionado
  com a licença; scripts `webos:build`, `webos:package`, `webos:install`, `webos:launch`.
- **Aceite:** `pnpm webos:package` gera o IPK; no emulador o app instala, abre e o `index.html`
  carrega os scripts (ver pelo CDP), mesmo que a UI ainda falhe; `pnpm build` desktop inalterado.
- **Evidências:** IPK gerado, log do CDP, captura.

### F1.2 · Transpilação para Chromium 53
- **Depende de:** F1.1  · **Modelo:** O (high)
- **Escopo:** Babel `preset-env` com `chrome 53`, core-js 3 por uso, transpilar `node_modules`, Babel
  depois do `ts-loader`; checagem de sintaxe (`es-check`, ES2016) de todos os `.js` do
  `build-webos/` como script `webos:check-syntax`.
- **Aceite:** checagem passa; no emulador nenhum `SyntaxError` no console ao abrir o app.

### F1.3 · Polyfills
- **Depende de:** F1.1  · **Modelo:** S (high)
- **Escopo:** entrada de polyfills só no webOS: ResizeObserver, `Intl.PluralRules` (com os locales
  usados pelo app), `Element#append/prepend/scrollTo`, AbortController, `queueMicrotask` e o que o
  core-js não cobrir. PointerEvent fica para a F4.2.
- **Aceite:** no emulador as APIs existem (verificar pelo CDP); testes unitários; o build desktop
  não inclui os polyfills.

### F1.4 · Core MVP no app
- **Depende de:** F0.5, F0.6, F1.1  · **Modelo:** O (high)
- **Escopo:** alias do `@stremio/stremio-core-web` para o pacote vendorizado no build webOS; worker
  carregando o wasm com `fetch` + `WebAssembly.instantiate` (não há `instantiateStreaming`) a partir
  de `file://`; fallback wasm2js da F0.6.
- **Aceite:** no emulador o core do app inicializa (`getState('ctx')` via CDP) com WASM e com
  `WebAssembly` escondido.

### F1.5 · Enxugar o bundle
- **Depende de:** F1.1  · **Modelo:** S (high)
- **Escopo:** no build webOS, trocar por stubs `hls.js` e `@stremio/libass-wasm`; desligar o Sentry;
  medir tamanho antes/depois.
- **Aceite:** módulos ausentes do build webOS (stats), app abre no emulador, tamanhos no relatório.

### F1.6 · Primeiro boot completo
- **Depende de:** F1.2, F1.3, F1.4, F1.5  · **Modelo:** O (high)
- **Escopo:** corrigir o que impedir o app de chegar ao Board em **modo convidado** (sem conta).
- **Aceite:** no emulador o Board aparece com catálogos do Cinemeta; navegação básica com o mouse
  funciona; console sem erros não tratados; memória medida.

## Fase 2 — CSS e layout de TV

### F2.1 · Pipeline PostCSS do webOS
- **Depende de:** F1.1  · **Modelo:** O (medium)
- **Escopo:** `postcss-preset-env` (chrome 53), autoprefixer, `flex-gap-polyfill`, `postcss-focus-visible`
  e `postcss-focus-within` com os polyfills JS, cor `#rrggbbaa`, `inset` e propriedades lógicas.
- **Aceite:** CSS do build webOS sem `gap` em flex sem polyfill, sem seletores `:focus-visible`/
  `:focus-within` crus, a regra de destaque do `MetaItem` presente; CSS desktop inalterado.

### F2.2 · Grid → flex: Discover e Library
- **Depende de:** F2.1, F1.6  · **Modelo:** O (high)
- **Aceite:** capturas do emulador dessas telas sem quebra, comparadas com o desktop.

### F2.3 · Grid → flex: Calendar, LiveTV, GamepadModal, Scale, StatisticsMenu
- **Depende de:** F2.1, F1.6  · **Modelo:** S (high)
- **Aceite:** capturas do emulador sem quebra.

### F2.4 · `min()`/`max()`/`clamp()`
- **Depende de:** F2.1, F1.6  · **Modelo:** S (high)
- **Aceite:** nenhuma ocorrência crua no CSS webOS; telas afetadas conferidas por captura.

### F2.5 · sticky, `backdrop-filter`, `aspect-ratio`, `env()`/`dvh`, máscaras
- **Depende de:** F2.1, F1.6  · **Modelo:** S (high)
- **Aceite:** fallbacks aplicados; capturas das telas afetadas.

### F2.6 · Escala de TV
- **Depende de:** F2.2, F2.3, F2.4, F2.5  · **Modelo:** O (high)
- **Escopo:** tipografia, áreas de foco e foco bem visível para 3 m; margem de overscan; só no webOS.
- **Aceite:** capturas de todas as telas principais.

### F2.7 · Regressão visual
- **Depende de:** F1.6  · **Modelo:** S (high)
- **Escopo:** script que captura as telas principais no emulador e no Chrome desktop e gera uma
  página de comparação.
- **Aceite:** comparação gerada para Board, Discover, Library, Detalhes, Settings e Busca.

## Fase 3 — plataforma webOS

### F3.1 · Plataforma e webOSTV.js
- **Depende de:** F1.6  · **Modelo:** S (high)
- **Escopo:** detectar webOS, expor `webOS` para o stremio-video (o Bowser dá `webos`), carregar o
  webOSTV.js, ler capacidades (Luna: `tv.config.supportDolbyHDRContents`, `tv.model.edidType`,
  `tv.hw.dtsType`).
- **Aceite:** no emulador, a plataforma é `webOS` e as capacidades são lidas (emulador devolve os
  valores dele).

### F3.2 · Back e saída
- **Depende de:** F1.6  · **Modelo:** O (high)
- **Escopo:** Back (461) com `disableBackHistoryAPI`: fecha overlays, volta rotas e, na raiz,
  confirma a saída.
- **Aceite:** sequência de Back via `remote.mjs` no emulador sem navegação dupla e com saída
  confirmada.

### F3.3 · Ciclo de vida
- **Depende de:** F1.6  · **Modelo:** S (high)
- **Aceite:** `visibilitychange`/`webOSRelaunch` pausam e retomam; relaunch preserva o estado
  (testado no emulador com HOME e reabertura).

### F3.4 · Teclado virtual e links externos
- **Depende de:** F1.6  · **Modelo:** S (high)
- **Aceite:** busca utilizável com o teclado do sistema; links externos viram QR ou ficam
  desativados.

### F3.5 · Persistência
- **Depende de:** F0.8, F1.6  · **Modelo:** O (high)
- **Aceite:** o estado do app (addons instalados, configurações) sobrevive a atualização e reboot no
  emulador, conforme a recomendação da F0.8.

### F3.6 · Tela de diagnóstico
- **Depende de:** F3.1  · **Modelo:** S (high)
- **Aceite:** tela acessível pelo app que mostra versão, WebAssembly, configs Luna de DV/Atmos/DTS,
  `canPlayType`, memória — pronta para a Fase 8.

### F3.7 · Integração da solução de certificados
- **Depende de:** F0.7, F1.6  · **Modelo:** O (high)
- **Aceite:** pôsteres do metahub aparecem no Board do app no emulador; addons em hosts Let's
  Encrypt funcionam.

## Fase 4 — navegação por controle remoto

### F4.1a · Navegação: Board, Discover e Busca
- **Depende de:** F2.6, F3.2  · **Modelo:** O (high)
### F4.1b · Navegação: Library, Calendar, Addons e Settings
- **Depende de:** F2.6, F3.2  · **Modelo:** O (high)
### F4.1c · Navegação: Detalhes e lista de streams
- **Depende de:** F2.6, F3.2  · **Modelo:** O (high)
- **Aceite (F4.1a–c):** percorrer as telas só com `remote.mjs` no emulador: foco inicial, sem perder o
  foco, restauração ao voltar, listas horizontais e verticais rolando, carregamento sob demanda.

### F4.2 · Magic Remote
- **Depende de:** F1.6  · **Modelo:** O (high)
- **Escopo:** ponteiro como mouse; adaptar os componentes com `onPointer*` (o Chromium 53 não tem
  Pointer Events); `cursorStateChange` alterna ponteiro e setas.
- **Aceite:** cliques e hover com o mouse do emulador funcionam nas telas afetadas.

### F4.3 · Modais e menus
- **Depende de:** F2.6, F3.2  · **Modelo:** S (high)
- **Aceite:** foco preso nos modais, Back fecha, nada focável escondido.

## Fase 5 — player

### F5.1 · WebOsVideo ativo
- **Depende de:** F3.1  · **Modelo:** O (high)
- **Escopo:** `WebOsVideo` em uso, sem transcodificação, **sem** `com.webos.media/subscribe` pelo app
  (congela o `currentTime` no emulador), opção de velocidade escondida, `surroundSound` ligado.
- **Aceite:** um stream de teste (via addon de teste ou URL direta da bateria) toca no Player do app
  no emulador, com tempo e duração corretos.

### F5.2 · Probe de cabeçalho
- **Depende de:** —  · **Modelo:** O (high)
- **Escopo:** biblioteca JS (compatível com Chromium 53 depois da transpilação) que lê os primeiros
  MB de um MKV ou MP4 por Range e extrai faixas (tipo, codec, idioma, canais, padrão), legendas e a
  configuração Dolby Vision (perfil, compatibilidade com HDR10). Avaliar o pacote `get-tracks-data`
  usado pelo servidor da Stremio.
- **Aceite:** testes unitários com os cabeçalhos reais da F0.10 (ou baixados por ela mesma, com
  fonte registrada) acertam perfis DV P5/P7/P8.1, Atmos (E-AC3 JOC), TrueHD e DTS; roda no emulador
  num smoke.

### F5.3 · Regras de capacidade da C8
- **Depende de:** F5.2  · **Modelo:** O (high)
- **Escopo:** `perfil-c8.json` (D6 do plano) e o motor de regras: faixa de áudio inicial compatível,
  idioma preferido, rótulos ("HDR10 nesta TV", "DV", "Atmos"), rebaixamento de DV P5 em MKV,
  TrueHD/DTS-only.
- **Aceite:** testes unitários cobrindo as linhas da tabela "O que a C8 entrega" do plano.

### F5.4 · Faixas na interface
- **Depende de:** F5.1, F5.2, F5.3  · **Modelo:** O (high)
- **Aceite:** no emulador, o menu de áudio do Player lista as faixas do `t2_multi.mkv` com idioma e a
  troca funciona (desliga as demais).

### F5.5 · Legendas
- **Depende de:** F5.1  · **Modelo:** O (high)
- **Aceite:** legendas de texto embutidas aparecem via Luna e legendas de addon aparecem em overlay
  HTML, no emulador.

### F5.6 · Trocas de stream robustas
- **Depende de:** F5.1  · **Modelo:** O (high)
- **Escopo:** no emulador só a primeira mídia após o boot é estável (PESQUISA, seção 7). Investigar a
  liberação do pipeline (`luna unload`, recriar o elemento, recarga controlada) e deixar o player o
  mais robusto possível; documentar o que fica para a validação na TV.
- **Aceite:** 5 trocas seguidas de stream no emulador, ou explicação medida de por que não dá e qual
  estratégia ficou (com teste automatizado).

### F5.7 · Seek, retomada, próximo episódio, teclas de mídia
- **Depende de:** F5.1, F3.2  · **Modelo:** O (high)
- **Aceite:** no emulador: seek pelas setas e pelas teclas FF/RW, play/pause, retomada da posição,
  próximo episódio.

## Fase 6 — debrid e lista de streams

### F6.1 · Sem torrents e sem servidor
- **Depende de:** F1.6  · **Modelo:** S (high)
- **Aceite:** no build webOS, streams de torrent (infoHash) ocultos e telas/avisos de servidor de
  streaming fora; desktop inalterado.

### F6.2 · Ordenação pela compatibilidade com a C8
- **Depende de:** F5.3, F6.1  · **Modelo:** O (high)
- **Aceite:** lista de streams ordenada e rotulada pelas regras da F5.3 (testes unitários + captura no
  emulador com o addon de teste).

### F6.3 · Links de debrid
- **Depende de:** F5.1  · **Modelo:** S (high)
- **Aceite:** redirect, link expirado e erro de rede tratados com mensagens claras (testado com o
  `media-server.mjs`, que imita redirect e pode simular 403/404).

### F6.4 · Ponta a ponta no emulador
- **Depende de:** F6.1, F6.2, F6.3, F5.4  · **Modelo:** O (high)
- **Escopo:** addon de teste local que imita um addon de debrid (manifest e streams HTTP apontando para
  o `media-server.mjs`), instalado no app sem conta; Cinemeta para o catálogo.
- **Aceite:** no emulador: escolher um título no Board → ver streams rotulados → tocar → trocar faixa
  → voltar; tudo com o controle remoto.

## Fase 7 — desempenho e estabilidade

### F7.1 · Medições no perfil C8
- **Depende de:** F1.6, F0.9  · **Modelo:** S (high)
- **Aceite:** tempos de boot até o Board e de navegação, memória e compilação do core medidos e
  versionados em `webos/docs/BASELINE-C8.md`.

### F7.2 · Otimizações
- **Depende de:** F7.1  · **Modelo:** O (high)
- **Aceite:** metas do G7 atingidas ou explicação do que falta.

### F7.3 · Resistência
- **Depende de:** F6.4, F7.2  · **Modelo:** S (high)
- **Aceite:** 1 h de navegação contínua e uma reprodução longa por boot no emulador, sem vazamento nem
  reinício do app.

### G7 · Gate final do emulador
- **Depende de:** todas as tarefas das Fases 0–7
- **Critérios:** boot até o Board ≤ 10 s no perfil C8; memória do app ≤ 250 MB; bateria de mídia e
  ponta a ponta passando; nenhuma tarefa bloqueada sem decisão. Aprovado → parar e avisar o Gabriel
  para a Fase 8 (TV real).
