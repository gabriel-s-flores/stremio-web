# perf: medições do app no perfil C8 (F7.1)

Refaz, no emulador com `--profile c8`, as medições de [`docs/BASELINE-C8.md`](../../docs/BASELINE-C8.md): boot até o Board, navegação, memória e trocas de stream (`perf.mjs`), mais o A/B de builds e de variantes do core, os ciclos de Detalhes e o tamanho do build (scripts à parte, abaixo). A compilação isolada do core MVP é a `webos/tools/baseline-c8.sh` (F0.9), fora do `perf.mjs`; os tempos do carregador do core (wasm2js × WASM) saem do `boot`. Serve à F7.2 (otimizações), à F7.3 (resistência) e ao G7. Tudo roda **dentro de uma reserva do pool** (`webos/tools/emu-run`), uma reserva por cenário, com o app empacotado (`pnpm webos:package`).

```bash
# boot (as 2 variantes do core), nav e play, com repetição das rodadas em host ocupado e resumo no fim (uma reserva por cenário).
# Uma rodada de reprodução cujo renderer o kernel mata (OOM) é um RESULTADO: fica no resumo, com a fase do salto e o pico.
node webos/tests/perf/perf.mjs --ipk dist-webos/<id>_<versão>_all.ipk --out ~/webos-tv-sdk/run/perf-1 --rounds 3

# Um cenário só (reserva à mão):
webos/tools/emu-run --profile c8 --timeout 45 -- webos/tests/perf/run.sh <saída> boot --ipk <ipk> --launches 4          # --warmup 1 é o padrão: o 1º lançamento depois de instalar não conta
webos/tools/emu-run --profile c8 --timeout 45 -- webos/tests/perf/run.sh <saída> boot --ipk <ipk> --launches 3 --variant wasm
webos/tools/emu-run --profile c8 --timeout 40 -- webos/tests/perf/run.sh <saída> nav  --ipk <ipk>
webos/tools/emu-run --profile c8 --timeout 50 -- webos/tests/perf/run.sh <saída> play --ipk <ipk> --switches 5
webos/tools/emu-run --profile c8 --timeout 45 -- webos/tests/perf/run.sh <saída> streams-cycle --ipk <ipk> [--no-addon] [--variant wasm]

# A/B (ou bisect) de dois ou mais IPKs, intercalados NA MESMA reserva (a única comparação justa num host compartilhado):
webos/tests/perf/build-ipk.sh [--keep] <commit> <saída.ipk>    # IPK de qualquer commit; a worktree é removida no fim
webos/tools/emu-run --profile c8 --timeout 58 -- webos/tests/perf/ab-boot.sh <saída> <rodadas> <a.ipk> <b.ipk> ...
#   a entrada pode ser <ipk>:<variante> (wasm | wasm2js): o mesmo IPK com as duas variantes do core.
#   As rodadas pares percorrem a lista ao contrário (ABBA); avisa acima de 8 instalações por reserva.

# Quem move a memória? Amostra os ticks de CPU das threads do renderer junto com o RSS (PERF_THREADS=1 no run.sh) e procura os saltos:
PERF_THREADS=1 webos/tools/emu-run --profile c8 --timeout 50 -- webos/tests/perf/run.sh <saída> play --ipk <ipk> --switches 5
node webos/tests/perf/thread-bursts.mjs <saída>/mem.log <saída>/mem.threads.log <saída>/phases.jsonl

# Tabelas (mediana, faixa, rodadas descartadas por carga) e tamanhos:
node webos/tests/perf/summarize.mjs [--max-load 8] [--max-ref 850] [--max-psi 60] <pasta>...   # boot (com os marcos do app e do core), nav, play (uma linha por rodada, OOM por condição), streams-cycle
node webos/tests/perf/size.mjs --dir build-webos --ipk <ipk> --compare build
node webos/tests/perf/mem-chart.mjs <pasta>/mem.log <pasta>/phases.jsonl <saída>.svg "<título>"
```

## O que cada cenário mede

| Cenário | O que faz | Saída |
|---|---|---|
| `boot` (`boot.mjs`) | N lançamentos a frio (`--warmup W` lançamentos extras antes, fora das medianas). Por lançamento: as marcas da sonda da F3.6 na linha do tempo da página (`coreReadyAt`, `firstRowAt`, `screenFullAt`), o tempo de relógio do host, 25 s parado no Board e então a tela de diagnóstico (marcas do próprio app: DOMContentLoaded, início e fim do init do core, Board montado, 1º item do Board; estado e tempos do carregador do core) | `boot.jsonl`, `info.json` |
| `nav` (`nav.mjs`) | Um boot e a navegação: Board → Detalhes (OK) → Back → Discover → Back → Busca ("matrix") → Back → Library, Calendar, Addons, Settings → Board → Detalhes → Back. Cada passo é cronometrado **na linha do tempo da página**, do evento de entrada (tecla ou clique) até o primeiro quadro com a tela pronta, e ainda o tempo até o DOM assentar | `nav.json` |
| `play` (`play.mjs`) | Um boot com o addon de teste local (`webos/tests/addon`): lista de streams, OK num stream até o vídeo estar tocando, N trocas de stream (Back, outro stream), Back até o Board. Um cenário de mídia por boot (limite do emulador) | `play.json` |
| `streams-cycle` | Detalhes com a lista de streams e de volta ao Board, vários ciclos, só a memória (a busca do estouro de memória) | `streams-cycle.json` |
| `ab-boot.sh` | Lançamentos a frio de vários IPKs intercalados na mesma reserva | uma pasta por lançamento |

Em todos: `mem.log` (amostrador do convidado, a cada 2 s: RSS do renderer do app, anon/file/shmem, pipeline de mídia, MemAvailable), `phases.jsonl` (marcas de fase, relógio do host), `mem.json` (a análise por fase, `mem-analyze.mjs`), `dmesg-oom.txt` (o kernel matou algo?), `context-*.json` (estado do host). Os cenários `nav`/`play` também guardam *snapshots* de memória (RSS por tipo, heap do V8, DOM, imagens, camadas do compositor, ticks de CPU por thread) e a linha do tempo da página; uma rodada que morre no meio (renderer morto pelo OOM) grava o que já mediu (`"incomplete": true`).

## Confiabilidade: o host é compartilhado

`context.sh` registra, antes e depois de cada rodada: `load1/5/15`, quantas instâncias do pool outros processos seguravam (`poolBusy`, lido de `/proc/locks`, sem travar nada), quantos QEMU rodam, a frequência média da CPU e um laço de referência (`hostRefMs`, ≈ 580 ms com um núcleo livre). `summarize.mjs` marca como **calma** a rodada com `load1 ≤ 8` (o número de CPUs) e `hostRefMs ≤ 850` nas duas pontas, e tira as outras das medianas (`--include-busy` as mantém). `perf.mjs` espera o host acalmar antes de cada rodada (`--wait-calm`) e repete a rodada que não foi calma (`--retries`).

Para comparar duas versões, use `ab-boot.sh` (mesma reserva, intercalado), nunca duas reservas em horários diferentes.

## Armadilhas já pagas

- **O Chromium 53 do emulador aceita um só cliente de inspetor por página**: com um script rodando, `cdp.mjs` fala "nenhum alvo". E não tem `awaitPromise`: `lib.mjs` guarda a Promise numa global e consulta, como o `cdp.mjs`.
- **O Back do sistema não chega à página como `keydown`** no emulador (chega como passo do histórico): o cronômetro da página também parte de `popstate`/`hashchange`.
- **A VM envelhece dentro de uma reserva**: depois de ~12 instalações (~24 lançamentos) no mesmo boot da VM, o boot do app fica 10–30 s mais lento, com o host calmo (4 reservas, F7.1). No máximo ~16 lançamentos (8 instalações) por reserva; no `ab-boot.sh`, alterne a ordem dos builds (`<a> <b> <b> <a> <a> <b> <b> <a>`), porque uma sequência repetida confunde a posição com o build.
- **O primeiro lançamento depois de instalar é mais lento** (sem o cache de código do Chromium): por isso `--warmup`.
- **Instalar por cima de outro build às vezes falha (255)**: `boot.mjs` remove o app antes de instalar.
- `/proc/<pid>/smaps` não é legível pelo usuário `developer`: a composição do RSS vem de `/proc/<pid>/status` (kernel 4.8: `RssAnon`, `RssFile`, `RssShmem`).

## O que está preso a esta máquina

`$HOME/webos-tv-sdk/run/ares_webos_emul` (a chave SSH do emulador) e `~/webos-tv-sdk/run/` (pool, travas, IPKs e saídas) são fixos nos scripts; o caminho do cgroup da cota (`context.sh`) é o do flatpak do GNOME Boxes sob o systemd do usuário; `--max-load 8` é o número de CPUs deste host (use o `nproc` de outro); o laço de referência de CPU (`hostRefMs`, ≈ 580 ms) é deste i7-7700HQ. Outra máquina precisa recalibrar essas quatro coisas antes de reaproveitar os limiares.
