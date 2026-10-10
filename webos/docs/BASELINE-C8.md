# Perfil C8 no emulador: cota de CPU e baseline

O emulador roda a imagem oficial do webOS TV 4.0 em QEMU/KVM no PC de desenvolvimento (i7-7700HQ, até 3,8 GHz). A C8 tem uma CPU ARM bem mais lenta, então medir tempos no emulador "solto" é otimista. O **perfil C8** é um opt-in que limita a CPU da VM para o caso pior ficar mais perto da TV. Ele **estima**, não reproduz: a calibração final só acontece na Fase 8, com a TV.

## Como usar

```bash
webos/tools/emu-run --profile c8 -- <comando>           # ou EMU_PROFILE=c8
EMU_CPU_QUOTA=25 webos/tools/emu-run --profile c8 -- …   # cota diferente (% de um núcleo do host)
webos/tools/emulator-qemu.sh -i N start headless --profile c8 [--cpu-quota PCT] [--smp N] [--mem MB]
```

| | Sem perfil (padrão, inalterado) | `--profile c8` |
|---|---|---|
| RAM | 1024 MB | 1024 MB (`EMU_C8_MEM`) |
| vCPUs | `emu-run`: 2; `start` direto: 3 | 2 (`EMU_C8_SMP`) |
| Cota de CPU | nenhuma | `CPUQuota=40%` para a VM inteira (`EMU_CPU_QUOTA` ou `EMU_C8_QUOTA`) |
| Espera pelo boot no `emu-run` | 240 s | 900 s (`EMU_BOOT_WAIT`) |

Precedência: opção explícita (`--smp`, `--mem`, `--cpu-quota`) > variável de ambiente > perfil > padrão. `EMU_CPU_PERIOD_MS` (opcional) troca o período do CFS (padrão do systemd: 100 ms). Dentro do comando do `emu-run`, `EMU_PROFILE=c8` fica definido. A trava `run/emu-N.lock` e o resto do protocolo do `emu-run` não mudaram.

**Como a cota é aplicada.** O `flatpak run` move o QEMU para um scope transitório próprio (`app-flatpak-org.gnome.Boxes-<id>.scope`), então um `systemd-run --user --scope -p CPUQuota=… flatpak run …` por fora **não alcança o QEMU** (medido: o processo fica no scope do flatpak). Por isso `start` espera o processo aparecer, lê o scope em `/proc/<pid>/cgroup` e roda `systemctl --user set-property --runtime <scope> CPUQuota=40%`. A cota vale para todas as threads do QEMU (vCPUs, I/O, rede) e some quando o QEMU sai. Se o scope não for o esperado, `start` mata o QEMU e falha em vez de seguir sem limite. Exige cgroup v2 com o controlador `cpu` delegado ao usuário (é o caso desta máquina).

## Justificativa da cota

- **CPU da C8: não verificada.** Não achei fonte confiável para o SoC da OLED55C8 (o "α9" é o processador de imagem). A única pista é uma planilha de hobby de uma B8 (LG1313, 4 × Cortex-A53 a ~1,0 GHz), sem confirmação. Hipótese de trabalho: núcleos ARM em ordem de 1,0 a 1,4 GHz.
- **Relação estimada com o host:** um A53 desses rende em JS de uma thread algo como 1/6 a 1/10 de um núcleo do i7 em turbo. Isso pediria cota por núcleo de 10 a 17 %.
- **O que escolhi: 40 %, a menor cota estável medida.** Com cota ≤ 25 % a compilação do core travou em parte das execuções (seção "Achado" abaixo), então o perfil não pode descer disso por padrão. 40 % de um núcleo (2 vCPUs dividindo 0,4 núcleo) dá, no JS de uma thread, cerca de **2,7×** mais lento que sem cota e, na compilação do core, cerca de **5×**, mais perto do que se espera da C8 do que o emulador solto, mas **ainda otimista** frente à hipótese acima. Trate os tempos do perfil como um limite inferior do tempo na TV.
- **Como recalibrar na Fase 8:** `baseline-c8.sh` mede o microbenchmark de JS (`loopMs`, `sortMs`) e a compilação do core com o mesmo código que roda na TV (via sonda). Com `loopMs` na C8 e `loopMs` do emulador sem cota (≈ 0,9 s), a cota certa é aproximadamente `100 × loopMs_emulador / loopMs_C8` (% de um núcleo). Depois é só `EMU_C8_QUOTA=<valor>`.
- 2 vCPUs: a RAM é a da TV (1 GB) e o `hardwareConcurrency` visto pela sonda passa a 2. O número de núcleos da C8 também não foi confirmado; 2 vCPUs são o que o `emu-run` já usava.

## Medições

Comandos (cada linha é uma reserva curta do pool, boot limpo, uma instância por vez):

```bash
webos/tools/emu-run --timeout 15 -- webos/tools/baseline-c8.sh none-a
EMU_CPU_QUOTA=40 webos/tools/emu-run --timeout 15 --profile c8 -- webos/tools/baseline-c8.sh c8q40-a
```

`baseline-c8.sh` mede: **boot** (idade do QEMU quando o SSH responde, precisão ~3 s), **sonda** (do `ares-package` até `__probe.complete`, via `probe-run.sh`), **JS** (laço de 30 M iterações e `sort` de 300 mil números na página da sonda, melhor de 2) e **compilação do core** MVP (`core-0.65.0-mvp.wasm`, 4,9 MB) num Worker via `wasm-compile-test.sh`. Cada execução também grava `uptime` do host (início e fim) e um laço de referência em Node no host (`host_ref_ms`; ≈ 600 ms com a máquina ociosa).

Medianas (host com 8 CPUs; saída bruta em `evidencias/baseline/results.jsonl`):

| Cota (perfil) | n | Boot até SSH | Sonda completa | JS laço (30 M) | JS sort | Compilação do core | Faixa da compilação |
|---|---|---|---|---|---|---|---|
| sem perfil (2 vCPU) | 2 | 25 s | 13,8 s | 0,89 s | 0,32 s | 5,2 s | 5,0–5,4 s |
| 60 % | 2 | 28 s | 27,6 s | 1,57 s | 0,66 s | 16,0 s | 15,8–16,2 s |
| 50 % | 2 | 31 s | 28,5 s | 2,17 s | 0,86 s | 19,5 s | 19,3–19,6 s |
| **40 % (padrão c8)** | 5 | 37 s | 38,8 s | 2,43 s | 1,0–2,3 s | 26,4 s | 25,2–26,8 s |
| 25 % | 3 | 49 s | 78,9 s | 4,10 s | 1,60 s | 46,7 s (2 de 3) | 45,1–48,2 s; **1 timeout** |

Sem perfil o `wasm-compile-test.sh` mediu 2,0 s com a máquina ociosa (PESQUISA, seção 2) e 3,5 a 6,3 s nesta bateria; veja a variância abaixo.

### Variância

Durante toda a medição o host esteve ocupado por outros agentes (load average de 20 a 47 em 8 CPUs; `host_ref_ms` entre 580 e 2440 ms contra ≈ 600 ms ocioso). Consequências:

- Os tempos "sem perfil" são os mais sensíveis à disputa: a compilação foi de 3,5 s (load 3) a 6,3 s (load 22), contra 2,0 s no spike com a máquina livre. Com a cota, o QEMU já está limitado e a disputa pesa menos: as 5 execuções a 40 % ficaram entre 25,2 e 26,8 s mesmo com load de 20 a 43.
- O sort e o laço de JS oscilam mais que a compilação (ex.: 1,0 a 2,3 s a 40 %), porque rodam em poucos ciclos de quota. Use o laço como indicador, não o sort.
- Para comparar duas configurações, rode-as intercaladas (como fiz) e olhe o `host_ref_ms` e o load de cada linha.
- A memória mínima disponível no convidado durante a compilação ficou em 527 a 580 MB em todas as configurações (a cota não muda a memória).

## Achado: compilação trava com cota baixa

Nas primeiras tentativas (limite de 600 s no `wasm-compile-test.sh`) a compilação do core **não terminou** em 4 de 6 execuções com cota de 25 % ou 40 % (`evidencias/sweep-r1.log` e `debug-cliff*.log`: "timeout aguardando a Promise"). Essas tentativas começaram a compilar antes de a sonda completar (o `probe-run.sh` espera só 40 s e a sonda leva 37 a 80 s nessas cotas), o que pode ter contribuído. Na bateria final a sonda sempre completou antes (`PROBE_WAIT=300`) e o limite era 180 s: 40 % passou 5 de 5; 25 % passou 2 de 3 (45 e 48 s) e teve 1 timeout; 50 e 60 % passaram sempre. Ou seja, a 25 % o problema persiste mesmo sem esse fator.

O que se sabe:
- Num travamento a 40 % (`evidencias/debug-cliff-q40.log`) o convidado ficou **ocioso** (WebAppMgr ~0 % CPU, cgroup sem novas limitações), ou seja, não é a compilação lenta demais. Em outro travamento a 25 %, o servidor estático do host registrou o `GET` do `.wasm` (200) e o convidado ainda tinha conexões abertas (`debug-cliff3-q25.log`).
- Um `fetch` simples do mesmo arquivo, feito da página, funcionou a 40 % (períodos de 10 e 100 ms), então a rede básica não quebra com a cota.

Hipótese (não confirmada): com a cota baixa a VM inteira, inclusive a rede (slirp) e o laço de eventos do QEMU, fica parada por ~75 % de cada período, e a transferência de 4,9 MB ou a entrega do resultado para o Worker perde um evento. Isso casa com a lembrança de que a NIC da VM "trava depois de transferências grandes" (comentário no `emulator-qemu.sh`). **Não foi diagnosticado**; fica fora do escopo. Efeito prático: o perfil c8 padrão é 40 %, e o `baseline-c8.sh` registra a compilação como `timeout` (limite de 180 s, `WASM_TIMEOUT_MS`) em vez de segurar a reserva.

## Ferramentas alteradas ou criadas por esta tarefa

- `emulator-qemu.sh`: `start --profile c8 [--cpu-quota PCT]`, `EMU_PROFILE`, `EMU_CPU_QUOTA`, `EMU_C8_*`, `EMU_CPU_PERIOD_MS`.
- `emu-run`: `--profile c8` / `EMU_PROFILE`; só nesse caso muda o `start` e a espera do boot.
- `baseline-c8.sh` (novo): medição acima.
- `wasm-compile-test.sh`: usa `$EMU_SSH_PORT` (antes fixo em 6622, só instância 0), e aceita `WASM_HTTP_PORT`, `WASM_MEM_LOG`, `WASM_TIMEOUT_MS`. Sem variáveis o comportamento é o antigo.
- `probe-run.sh`: `PROBE_WAIT` (segundos de espera pela sonda; padrão 40, como antes).
- `qmp.py`: `screendump` agora pede PPM ao QEMU e converte para PNG. O PNG do próprio QEMU saía com vermelho e azul trocados.
