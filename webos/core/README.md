# Core MVP (`@stremio/stremio-core-web` para o webOS TV 4.x)

O Chromium 53 do webOS TV 4.x (V8 5.8) só aceita WebAssembly MVP. O wasm publicado no npm usa
externref, multivalue, bulk memory e conversões sem trap, e falha com `invalid local type`. Esta
pasta gera o mesmo pacote como MVP e o versiona em `webos/vendor/stremio-core-web/`, com os mesmos
nomes de arquivos do npm (`bridge.js`, `worker.js`, `stremio_core_web.js`,
`stremio_core_web_bg.wasm`, `package.json`). Origem e checksums ficam em `SOURCE.md`.

```bash
webos/tools/build-run -- webos/core/build          # ~3 min; termina com o gate
webos/core/check-wasm arquivo.wasm                  # gate sozinho (--json para saída em JSON)
```

## Receita A

1. `git archive` da tag `stremio-core-web-v0.65.0` do clone em `~/webos-tv-sdk/src/stremio-core`.
2. `recipe-a.patch`: `gloo-utils` 0.3 → 0.2, a única dependência do lockfile que exige Rust acima de 1.77.
3. Rust 1.77.2: `cargo build --release --locked --target wasm32-unknown-unknown`. O Rust 1.77 ainda
   gera wasm32 sem reference types e sem multivalue. `--remap-path-prefix` tira os caminhos locais
   das mensagens de panic, e o binário sai igual em qualquer pasta.
4. wasm-bindgen CLI 0.2.121, a mesma versão do lockfile: `--target web --no-typescript`.
5. **Correção na glue:** em `getStringFromWasm0`, `TextDecoder.decode` passa a receber `slice()`,
   uma cópia, em vez de `subarray()`, que é uma view do `memory.buffer`. Sem isso o core cai no
   primeiro crescimento da memória, ao serializar o `ctx`.

   No Chromium 53 do webOS, certos usos de uma view da memória wasm seguidos de `memory.grow`
   derrubam o processo do app. Medido no emulador, cada caso num processo novo:

   | Derruba | Não derruba |
   |---|---|
   | `TextDecoder.decode(view)` | só `memory.grow` |
   | `crypto.getRandomValues(view)` | `decode(slice)` |
   | `s = u.subarray(…); s[0] = 1; new Uint8Array(s)` (sem API do Blink) | `view.set(js)` e `subarray().set(js)` |
   | | `js.set(view)` |
   | | `new Uint8Array(subarray)` sem escrita antes |

   **Regra:** use views da memória wasm só nos padrões da glue validados no emulador: escrita
   indexada na view inteira, `subarray().set()` e `DataView`. Qualquer outro uso, inclusive uma
   cópia via construtor de view, precisa de repro no emulador antes. Os casos completos estão no
   relatório da F0.5.
6. `wasm-opt -O --signext-lowering` (Binaryen 133).
7. Babel com as `devDependencies` e o `.babelrc` do upstream (`npm ci` do lockfile do pacote), como
   o `scripts/build.sh` oficial. O `bridge.js` e o `worker.js` saem idênticos aos do npm.

## Gate (`check-wasm`)

Reprova:

- qualquer recurso pós-MVP: opcodes, tipos, tabelas, segmentos, memórias e expressões constantes
  além de `*.const` e `global.get` (extended-const);
- `i64` na assinatura de imports ou exports (o V8 5.8 não tem BigInt);
- global mutável importado ou exportado;
- `target_features` com algo além de `+mutable-globals`.

O wasm do npm 0.65.0 reprova; o MVP gerado aqui aprova. O `check-wasm-selftest` monta 34 módulos
mínimos com o Binaryen do kit e confere o veredito de cada um. O `build` roda o autoteste antes do
gate; rode-o também ao mudar o `check-wasm`.

O `build` também falha se a tag do clone apontar para outro commit, ou se o `bridge.js` e o
`worker.js` não saírem com os sha256 do npm 0.65.0 (por exemplo, por um `BROWSERSLIST` no
ambiente).

## Smoke no emulador

`webos/tests/core-smoke/` empacota uma página que sobe o worker vendorizado como o app, mede o
init, lê o `ctx` e carrega catálogos do Cinemeta como convidado:

```bash
webos/tools/build-run -- npx webpack --config webos/tests/core-smoke/webpack.config.js
webos/tools/emu-run -- webos/tests/core-smoke/run <pasta-de-saída>              # core
webos/tools/emu-run -- webos/tests/core-smoke/run --baseline <pasta-de-saída>   # linha de base
```

O `run` sai com 1 se o app cair, estourar o tempo, terminar com `ok=false` ou não carregar todo o
Board. A memória do convidado (`MemAvailable` e RSS de cada processo WebAppMgr) é amostrada a cada
segundo, desde antes do lançamento até `POST_SECS` (padrão 120 s) depois do fim. O JSON registra:

- `peak`: o pior momento desde o lançamento;
- `steady`: a média dos últimos 30 s;
- os processos afetados: o processo novo do app e a variação dos outros processos WebAppMgr.

Depois do init, o app ainda libera memória por ~40–45 s, então compare sempre `steady` com
`steady` da linha de base (`--baseline`: a mesma página com um worker vazio, sem o core).

O pacote do app roda de `file://`, e no Chromium 53 `fetch()` não aceita `file://` (`Failed to
fetch`). Por isso o worker do smoke carrega o `.wasm` por XHR quando o `fetch` falha. O app vai
precisar da mesma solução ao usar este pacote (tarefa F1.4).
