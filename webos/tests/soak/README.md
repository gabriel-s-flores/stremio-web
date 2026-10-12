# soak: resistência no emulador (F7.3)

Duas rodadas longas no perfil C8, cada uma num boot do emulador, para achar o que só aparece com o tempo: vazamento de memória (heap do JS, memória nativa, `shmem`), nós do DOM e *listeners* que só sobem, reinício do renderer (OOM) e quedas do Player. Reaproveita a suíte `perf` da F7.1 (`run.sh` põe o amostrador de memória do convidado a cada 2 s, as fases e a checagem de OOM no `dmesg`) e o addon de teste da F6.2/F6.4.

```bash
webos/tools/build-run -- pnpm webos:package                       # o IPK em dist-webos/
webos/tests/soak/make-media.sh                                    # uma vez: ~/webos-tv-sdk/media-tests/e2e-long (arquivos de 3600 s)

# 1 h de navegação contínua (controle remoto + Magic Remote), o Board medido ao fim de cada volta
webos/tools/emu-run --profile c8 --timeout 90 -- webos/tests/perf/run.sh <saída> soak-nav --ipk <ipk> --minutes 60

# uma reprodução longa (50 min de um arquivo de 60 min), com pausa, seek, barra, ponteiro e legenda de addon
webos/tools/emu-run --profile c8 --timeout 100 -- webos/tests/perf/run.sh <saída> soak-play --ipk <ipk> --minutes 50

# as tendências (inclinação por 10 min, deriva entre o 1º e o último terço, picos, reinícios, OOM)
node webos/tests/soak/analyze.mjs <saída>... [--json resumo.json] [--skip 1]
```

## O que cada rodada faz

| Cenário | O que faz |
|---|---|
| `soak-nav` | Um boot, o addon de teste (`--set e2e`) instalado. Em voltas de ~2–4 min: Board (setas) → Detalhes (OK) → lista de streams de um filme (probe sob demanda) → Back → Discover (ponteiro na barra lateral, setas, mais itens) → Back → Busca ("matrix", Enter, setas) → Back → Library, Calendar, Addons, Settings (ponteiro na barra, setas) → diagnóstico (R-G-Y-B) e Back → Board (ponteiro) → varredura do ponteiro pelos pôsteres e a roda → uma seta (o ponteiro some). Cada passo tem uma expectativa (rota e tela); passo que falha é registrado e a rodada segue (3 seguidos: volta ao Board pelo hash) |
| `soak-play` | Um boot, uma mídia (`720p MULTI`, H.264, três faixas de áudio, 3600 s), tocada por `--minutes`. A cada 90 s uma interação (pausa/retoma, seek ←/→, barra ↓, ponteiro sobre o Player, PAUSE/PLAY, FASTFORWARD), seguida da checagem de que o vídeo anda; a legenda do addon é ligada no início (um *cue* novo a cada 2 s no overlay HTML). A cada `--sample-every` minutos (3) uma amostra; no fim: Back até o Board e 60 s parado |

## O que é medido

Uma **amostra** (`samples.jsonl`) é tirada sempre no mesmo lugar (o Board quieto, no fim de cada volta; ou a cada N minutos de reprodução), depois de um GC (`HeapProfiler.collectGarbage`), para o heap ser o que fica retido:

- renderer do app, de `/proc/<pid>/status` do convidado: `VmRSS`, `RssAnon`, `RssFile`, **`RssShmem`**, `VmData` (o *worker* do core é uma *thread* do mesmo processo, então o RSS inclui o heap dele e a memória do wasm2js);
- a página: heap do JS (`performance.memory`), nós do DOM, imagens, rotas montadas; e do inspetor `Memory.getDOMCounters`: nós, **`jsEventListeners`** e documentos;
- o core: o tamanho da memória do wasm2js (`getCoreLoaderStatus().memoryBytes`).

Também: `events.jsonl` (reinício da página, troca de PID do renderer), `steps.jsonl` (cada passo/interação e se deu certo), `video.jsonl` (o estado do `<video>` a cada 30 s), `mem.log` (o amostrador do convidado, 2 s), `dmesg-oom.txt` (o kernel matou algo?), `soak.json` (o resumo). Um **reinício** é detectado por um identificador que muda a cada documento (`window.__soak.id`) ou por uma página que não responde; o roteiro reconecta, espera o Board e conta.

## Opções

| Opção | Cenário | O que faz |
|---|---|---|
| `--worker-heap` | os dois | *snapshot* do heap V8 do **worker do core** (domínio `Worker` do inspetor: `Worker.sendMessageToWorker` com `HeapProfiler.takeHeapSnapshot`, sem `connectToWorker`) depois da 1ª volta/amostra e no fim; grava `worker-heap-<rótulo>.json` (total e os maiores construtores) e o `.heapsnapshot.gz`. Soma ~20 MB de RSS por um tempo: compare os dois *snapshots* entre si, não com as amostras |
| `--idle` | `soak-nav` | controle: as mesmas amostras sem navegar (o roteiro não deve mexer na memória) |
| `--only catalog\|local` | `soak-nav` | só as telas que carregam catálogo e pôsteres da rede (Board, Detalhes, Discover, Busca) ou só as locais (Library, Calendar, Addons, Settings, diagnóstico): o A/B de **o que cresce** |
| `--no-subtitle` | `soak-play` | sem a legenda de addon (o overlay HTML) |
| `--sampling` | `soak-play` | *sampling heap profiler* da página durante a reprodução; no fim, `heap-sampling.json` tem as alocações ainda vivas com a pilha de cada uma |

Para ler os números: `analyze.mjs` ajusta uma reta por métrica sobre as amostras (a partir de `--skip N`, para deixar de fora o preenchimento do começo) e marca `GROWS` quando a inclinação passa de 3× o erro dela. **O heap do JS da página** (`performance.memory`) é um contador grosseiro do Chromium 53, que só atualiza em GC e anda em degraus: um degrau vira `GROWS` sem ser vazamento de objetos (confira com os nós do DOM, os *listeners* e o heap do worker).

## Limites conhecidos

- O heap do JS do *worker* só se lê por *snapshot* (`performance.memory` não existe em worker no Chromium 53); a página não: `HeapProfiler.takeHeapSnapshot` dela parou depois de ~39 eventos de progresso no emulador (testado 2×, > 5 min). A página é medida por contadores, GC forçado e o *sampling heap profiler*; a bissecção de um vazamento é por A/B de builds (`webos/tests/perf/ab-boot.sh`, `build-ipk.sh`) e por `--only`.
- Mídia no emulador: um cenário por boot; no perfil C8 a imagem do vídeo é intermitente (Fase 8). A reprodução é medida por `currentTime` e `readyState`, não pela imagem.
- `Input.dispatchMouseEvent` do Chromium 53 não tem `mouseWheel`: a roda é um `Input.synthesizeScrollGesture` (que o app recebe, mas o contêiner do Board não rola no emulador).
- O amostrador do convidado (`mem.log`) lista vários `WebAppMgr`; o do app é o do PID que o `statusSnapshot` acha (o de maior RSS).
