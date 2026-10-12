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

### F3.2b · Back sem toques extras depois de Detalhes
- **Depende de:** F3.2  · **Modelo:** O (high)
- **Escopo:** achado da F4.1a: o Back de Detalhes com origem faz `navigate(origem, { replace: true })`
  e deixa a origem duas vezes no histórico (2 Backs do Discover até o Board, 4 da Busca, onde o
  `setSearchParams` do upstream também empilha). Voltar pelo histórico quando a entrada anterior já é
  a origem, sem quebrar a saída na raiz, os overlays e o atalho de diagnóstico.
- **Aceite:** no emulador, com `remote.mjs`, cada Back volta exatamente uma tela (Board → Discover →
  Detalhes → Player e o caminho de volta; Busca → resultado → Detalhes), com o foco restaurado e a
  saída confirmada na raiz.

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

### F3.7b · Token do proxy fora dos logs
- **Depende de:** F3.7, F5.5  · **Modelo:** S (high)
- **Escopo:** achado da revisão F3.4 c2: o `console.error('Player')` do upstream registra a URL do
  proxy de certificados da F3.7 **com o token** quando falha uma legenda de addon passada pelo proxy
  (F5.5). Mascarar o token em todo log do webOS (console, relatório da tela de diagnóstico da F3.6,
  mensagens de erro) sem mexer no upstream além de overrides.
- **Aceite:** no emulador, com uma legenda de addon que falha pelo proxy, nenhum log nem tela mostra
  o token; teste automatizado que falha se o token aparecer.

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

### F4.4 · Consolidação e polimento da navegação
- **Depende de:** F4.1a, F4.1b, F4.1c, F4.3  · **Modelo:** O (high)
- **Escopo:** juntar os helpers de navegação criados em paralelo (`webos/lib/navigation/` da F4.1a,
  F4.1b, F4.1c e F4.3: foco inicial, rolagem de listas, recuperação de foco perdido, memória de foco
  por rota, overlays) num núcleo comum, sem mudar o comportamento validado, e fechar os baixos
  anotados nas revisões: título cortado com o zoom na Busca; recuperação de foco que cai no X e limpa
  a busca; memória de foco do Board ao voltar pela barra lateral; o placeholder do logo segura a
  restauração em Detalhes; UP no painel de streams vai a "Install addons" com um addon só;
  mutações sobreviventes nos helpers.
- **Aceite:** os roteiros de emulador das F4.1a–c, F4.3 e F3.2b passam sem regressão, a regressão
  visual da F2.7 passa (ou as referências são atualizadas com justificativa), o código de
  navegação fica num núcleo comum documentado e os baixos listados estão resolvidos ou registrados.

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

### F5.6b · Imagem da 2ª mídia com o guarda do pipeline
- **Depende de:** F5.6, F6.4  · **Modelo:** O (high)
- **Escopo:** achado da F6.4 (A/B no roteiro ponta a ponta): com o guarda da F5.6 ligado, a 2ª mídia
  do boot toca (o relógio anda) mas a tela da VM fica escura (0/4); com `GUARD=off`, mostra imagem
  (2/2). Descobrir se é o guarda (ex.: `holdVideosInPlace` segurando o nó/plano de vídeo antigo por cima,
  um pipeline por carga, liberação silenciosa) ou limitação do emulador, e corrigir sem perder o que a
  F5.6 resolveu (trocas sem travar, 10/10 × 0/7). Coordenar com a F4.4 (restauração de foco depois do
  Player, que depende do mesmo `holdVideosInPlace`).
- **Aceite:** no emulador, 2ª e 3ª mídias do mesmo boot com imagem (captura da VM avaliada, não só o
  relógio) e trocas seguidas sem travar, com o guarda ligado; A/B documentado; roteiros da F5.6
  (`switches.sh`) e da F6.4 (`e2e`) sem regressão.

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

## Fase 8 — correções vindas da TV real (LG OLED55C8PSA)

Insumos: `~/webos-tv-sdk/orquestrador/tarefas/F8/notas.md` (medições e capturas na TV, firmware 05.50.70,
3 GB de RAM, `devicePixelRatio` 2). Os agentes trabalham no emulador; **a validação na TV é feita pelo
orquestrador** antes do merge (os agentes não usam a TV).

### F8.1 · Stream começa rápido: link final do debrid e watchdog tolerante
- **Depende de:** G7  · **Modelo:** O (high)
- **Escopo:** na TV, o pipeline de mídia leva 1,5–3 min (ou nunca começa num `<video>` puro) quando recebe o
  link do Torrentio (`/resolve/…` → 302 para o RD); com o link final começa em ~6 s, inclusive retomando no
  meio do filme. O app passa a resolver o redirect (fetch com `Range: bytes=0-0`, `response.url`, timeout,
  sem baixar corpo; reaproveitar o probe da F5.2/F6.2 quando já seguiu o redirect) e entrega o link final ao
  `WebOsVideo`. Conferir se a liberação silenciosa (F5.6) e o probe concorrente atrasam o início. O watchdog
  de 60 s da F5.6 não pode derrubar um carregamento que ainda progride (arquivos grandes com moov no fim).
- **Aceite:** no emulador, com o `media-server.mjs` imitando um resolvedor com 302, o `<video>` recebe o link
  final e o tempo até `playing` não inclui o redirect; testes; e2e da F6.4 sem regressão. Na TV (orquestrador):
  1ª imagem de um stream do Torrentio+RD em ≲ 10 s.

### F8.2 · Navegação e abertura de telas rápidas na TV
- **Depende de:** G7  · **Modelo:** O (high)
- **Escopo:** na TV cada seta leva ~370 ms até o foco aparecer; o perfil de CPU mostra quase tudo em layout
  forçado (`getClientRects` + `focus()`), não em JS. Abrir Detalhes leva 0,9 s até a rota e 3,3 s até o título.
  Reduzir o custo de layout por tecla (limitar candidatos da busca espacial ao contêiner, ler retângulos uma
  vez, `contain` nas faixas/listas, rolar sem forçar layout) e o custo de abrir Detalhes.
- **Aceite:** no emulador (perfil c8), latência tecla→quadro e tempo de abertura de Detalhes medidos antes e
  depois com A/B; roteiros de navegação (F4.x) e e2e sem regressão. Na TV (orquestrador): seta ≲ 120 ms de
  mediana; Detalhes com título em ≲ 1,5 s.

### F8.3 · Enquadramento na TV (densidade de pixels 2)
- **Depende de:** G7  · **Modelo:** O (high)
- **Escopo:** a TV renderiza com `devicePixelRatio` 2 (o emulador, 1) e zoom 1,75; em Detalhes os nomes dos
  streams são cortados, os itens têm espaço demais, os rótulos ficam soltos, o foco envolve o painel inteiro,
  "Directors" é cortado pelos botões, emojis viram quadrados. Revisar a escala da F2.6 para dpr 2 e o layout
  de Detalhes/lista de streams; trocar emojis sem glifo na fonte da TV.
- **Aceite:** capturas no emulador (e simulando dpr 2, se possível) sem cortes; regressão visual da F2.7
  atualizada com justificativa. Na TV (orquestrador): capturas de Board, Detalhes, lista de streams, Player,
  Settings sem cortes nem sobreposição.

### F8.4 · Formatos e mensagens que a TV revelou
- **Depende de:** G7  · **Modelo:** O (high)
- **Escopo:** (1) Dolby Vision em MP4 (P8.1) toca como HDR na C8 — descobrir como ativar DV no pipeline
  (opção de mídia/Luna no load) ou documentar; (2) a C8 toca **DTS** (DTS-HD MA 5.1 testado): aceitar DTS
  nas regras C8 (`webos/lib/c8-rules`), mantendo a preferência adequada; (3) reconhecer os vídeos de aviso do
  Torrentio (`/videos/failed_*`, `downloading_*`) e mostrar a mensagem certa; (4) esconder "Open in external
  player" no webOS.
- **Aceite:** testes das regras e das mensagens; no emulador, os cenários de faixas e de erro; na TV
  (orquestrador): DV em MP4 com selo DV (ou limitação documentada), DTS escolhido quando for o melhor.

### F8.5 · Integração F8.1 × F8.4, testes que faltaram (F8.2, F8.3) e limpeza
- **Depende de:** F8.1–F8.4 (merge das quatro)  · **Modelo:** S (medium)
- **Escopo:** (1) `final-url` `isKeepable` também recusa `debridLink.noticeOf(finalUrl)` (aviso servido de outro
  host não fica guardado; achado B1 da revisão c2 da F8.1); se o link final for um aviso conhecido, falhar logo com
  a mensagem da F8.4 em vez de tocar o MP4 do aviso; (2) cenário de emulador em que o `/redirect/` vai para **outra**
  origem, cobrindo o `known` vindo do probe da lista (B2 da c2 da F8.1); (3) testes da F8.3: o ramo "bandeira sem
  ligadura" sem colisão no fake do `measureText` e a ligação `tvText`/`decodeMetaItem` com a tela (B1 e B2 da revisão
  c1 da F8.3); (4) da revisão c1 da F8.2: README da navegação com as medianas finais (697→32 ms, 297→7 ms),
  testes jsdom do polyfill de focus-within (foco redirecionado num handler de `focus`; elemento focado removido)
  e remover a dependência direta `postcss-focus-within`, que ficou sem uso.
- **Aceite:** testes com mutações que caem; cenário novo no emulador; e2e da F6.4 sem regressão.

### F8.6 · Detalhes rápido na TV (core no worker e lista de streams)
- **Depende de:** F8.2 (mesclada)  · **Modelo:** O (high)
- **Escopo:** na TV, abrir um filme com ~224 streams (Torrentio AD) leva **25–47 s** até a meta e os streams aparecerem
  (juntos), com ou sem as F8. Rede descartada: os addons respondem à TV em 33–152 ms. O **worker do core (wasm2js) fica
  100 % ocupado por ~28 s**: ~13 s atendendo mensagens da página (dispatch/get_state), ~12 s em futures do core
  (respostas dos addons), 3,8 s de GC. Depois, a página gasta ~4,5 s renderizando os streams. O localStorage da TV tem
  `library` com 198 KB e `library_recent` com 118 KB (hipótese: o `ctx` com a biblioteca grande é serializado a cada
  mudança). (1) Reproduzir no emulador c8 com um perfil parecido (biblioteca grande e ~224 streams de fixture) e
  perfilar o worker. Use `~/webos-tv-sdk/orquestrador/tarefas/F8/bin/perfil-worker.mjs` (domínio `Worker` do CDP) e
  símbolos do build do core para dar nome às funções. (2) Cortar o trabalho do lado do app: `getState` redundantes,
  `ctx` pedido sem necessidade, renderização incremental e virtualizada da lista de streams, e mostrar já o
  nome/pôster do item do catálogo (UI otimista). (3) **Mexer no core está autorizado** pelo Gabriel (2026-10-12)
  se o perfil mostrar que o gargalo é lá (por exemplo, serialização do `ctx`/biblioteca a cada mudança, ou o
  processamento dos streams). Faça isso como patch reprodutível na receita do `webos/core` (como o
  `recipe-a.patch`), mínimo e documentado, mantendo os dois caminhos (wasm2js e WASM) e o gate `check-wasm`.
- **Aceite:** A/B no emulador c8 (antes e depois, com o mesmo fixture): meta visível e 1º stream, CPU do worker por
  abertura; testes; e2e da F6.4 e regressão visual sem regressão; nada muda no desktop. Na TV (orquestrador):
  meta em ≲ 3 s e streams em ≲ 8 s no mesmo filme.