# F0.11 · Init do core no perfil C8

Pergunta do G0: o core (WASM e wasm2js) inicializa em menos de 10 s no perfil C8 do emulador? Se não,
o que dá para fazer, a que custo, e quando o usuário vê a primeira tela útil?

O spike monta **variantes** do core a partir de um build do `webos/core/build`, sem mexer no vendor,
empacota uma página de medição com o carregador `webos/core/loader.js` e mede cada variante no
emulador. A tabela completa, a recomendação e as evidências estão no relatório da tarefa
(`~/webos-tv-sdk/orquestrador/tarefas/F0.11/relatorio.md`).

## Resultado (perfil c8, host livre, 3 execuções por variante)

| Variante | Caminho | Init do core, 1º boot | Pico do processo |
|---|---|---|---|
| vendor da F0.6 | WASM | 24,6 s (24,0–28,3) | 242 MB |
| `opt-level = "z"` + `wasm-opt -Oz` | WASM | 20,2 s (19,8–20,9) | 203 MB |
| vendor da F0.6 (32,6 MB, o que o app levaria) | wasm2js | 19,3 s (18,0–20,2) | 271 MB |
| minificado (9,4 MB, o que a F0.6 mediu sem querer) | wasm2js | 16,0 s (15,5–17,6) | 161 MB |
| fábrica eager | wasm2js | 11,5 s (10,7–11,7) | 200 MB |
| **minificado + fábrica eager (o vendor atual)** | wasm2js | **9,5 s (9,3–9,8)** | **154 MB** |

- **Fábrica eager.** No V8 5.8, o embrulho da F0.6 custa três passadas de parse sobre o wasm2js
  (pré-análise no `importScripts`, a fábrica inteira ao chamá-la, `asmFunc` de novo ao chamá-la).
  Com a fábrica e `asmFunc` entre parênteses, uma só. Virou a etapa `webos/core/wasm2js-finish.js` do
  `webos/core/build`.
- **O `ares-package` minifica todo `.js` por padrão** (terser). Empacote com `--no-minify`, como o
  `webos/scripts/ares.sh`, senão o emulador recebe outro arquivo (e sem os parênteses).
- **A página não trava** enquanto o worker compila (atraso p95 de um timer de 50 ms: 37–48 ms), e o
  Board da execução anterior, guardado no `localStorage`, aparece antes do core.
- **O app só aparece na tela 4,6–6,5 s depois do lançamento** mesmo sem core (WebAppMgr, no c8); a
  página "pinta" antes disso. Use o `screen-timeline` para medir a tela, não só a página.
- **Sem atalho para o 2º boot:** o cache de código da LG para `file://` vale para `<script>` da
  página, não para `importScripts` no worker; e o Chromium 53 não guarda `WebAssembly.Module` no
  IndexedDB (`DataCloneError`).

## Peças

| Arquivo | O que faz |
|---|---|
| `build-variant` | Monta `build/variants/NOME/` (glue, `.wasm`, `.wasm2js.js`, `variant.json`) a partir de um build do core: refaz o `wasm-opt` e o `wasm2js` com outras opções, minifica e marca a fábrica eager (`webos/core/wasm2js-finish.js`). Passa o `.wasm` pelo gate `check-wasm` |
| `node-check.js` | Sobe uma variante no Node (WASM ou wasm2js) até o `ctx`, antes de gastar uma reserva do emulador |
| `page.js`, `worker.js`, `app/` | App de medição: o fluxo do `core-smoke` (init, `ctx`, catálogo, Board) mais a 1ª pintura, o Board do lançamento anterior (cache no `localStorage`) desenhado antes do core, a responsividade da página durante o init e as etapas do carregador. Parâmetros de lançamento: WebAssembly escondido (wasm2js), `early` (o worker carrega o core sem esperar o `init`), `cache=idb` (o `WebAssembly.Module` no IndexedDB) e `nocore` |
| `webpack.config.js`, `package` | `--env variant=NOME` → `build/app-NOME/`; `package` empacota em `build/ipk-NOME/` com `--no-minify`, fora da medição |
| `run` | Dentro do `emu-run`: instala, lança N vezes na mesma VM (1º boot e reaberturas), amostra a memória do convidado, tira capturas aos 4 s e 10 s de cada lançamento e grava o JSON |
| `battery` | Uma fila de `run`, uma reserva curta do `emu-run --profile c8` por item, com o `uptime` antes e depois |
| `summarize.py` | `run` (o JSON de uma execução), `table` (a tabela com medianas e faixas) e `timeline` (quando o app aparece na tela) |
| `screen-timeline` | Capturas QMP em sequência depois do lançamento, classificadas pelo brilho (TV do emulador, home, preto, app) |
| `parse-bench/` | Decompõe o parse do wasm2js no worker por forma de embrulho, e compara o cache de código no worker e na página |
| `bundle-bench` | Custo de parse do `main.js` do app (build webOS) na página |
| `flag-sweep` | Varre flags do V8 via `v8ExtraFlags` no `appinfo.json` (não usado nas medições do relatório) |

## Como reproduzir

```bash
# 1. variantes (ref = o vendor; o vendor atual já é o ref-min-eager)
V=webos/vendor/stremio-core-web
webos/spikes/core-init/build-variant ref-min-eager --from $V
CARGO_PROFILE_RELEASE_OPT_LEVEL=z webos/tools/build-run -- webos/core/build --out /tmp/z/out --work /tmp/z/work
webos/spikes/core-init/build-variant z-min-eager --from /tmp/z/out \
    --bindgen /tmp/z/work/src/stremio-core-web/wasm_build/stremio_core_web_bg.wasm --wasm-opt -Oz --minify default --wrap eager
node webos/spikes/core-init/node-check.js webos/spikes/core-init/build/variants/z-min-eager wasm2js

# 2. apps
for v in ref-min-eager z-min-eager; do
    webos/tools/build-run -- npx webpack --config webos/spikes/core-init/webpack.config.js --env variant=$v
done

# 3. medições no perfil c8 (confira o uptime no bateria.log; intercale as variantes)
webos/spikes/core-init/battery /tmp/f011/w2js "ref-min-eager --hide-wasm" "z-min-eager --hide-wasm" ...
webos/spikes/core-init/battery /tmp/f011/wasm ref-min-eager z-min-eager ...
python3 webos/spikes/core-init/summarize.py table /tmp/f011/*/*[0-9].json
webos/tools/emu-run --profile c8 -- webos/spikes/core-init/screen-timeline ref-min-eager /tmp/f011/tela \
    '{"nocore":true}' '{"webassembly":"hidden"}' '{}'
python3 webos/spikes/core-init/summarize.py timeline /tmp/f011/tela/*.jsonl
```

Cuidados: rode as baterias com o host livre e sem builds ao mesmo tempo (o clock do host cai e a
cota rende menos). Mais VMs simultâneas também pesam (HT): compare variantes da mesma bateria. As
tarefas em segundo plano do agente têm limite de tempo; uma bateria de 5 itens leva ~30 min.
