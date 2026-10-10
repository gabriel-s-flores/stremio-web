# Core MVP (`@stremio/stremio-core-web` para o webOS TV 4.x)

O Chromium 53 do webOS TV 4.x (V8 5.8) só aceita WebAssembly MVP. O wasm publicado no npm usa
externref, multivalue, bulk memory e conversões sem trap, e falha com `invalid local type`. Esta
pasta gera o mesmo pacote como MVP e o versiona em `webos/vendor/stremio-core-web/`, com os mesmos
nomes de arquivos do npm (`bridge.js`, `worker.js`, `stremio_core_web.js`,
`stremio_core_web_bg.wasm`, `package.json`). Do mesmo wasm sai a variante **wasm2js**
(`stremio_core_web_bg.wasm2js.js`), que o carregador (`loader.js`) usa quando o WebAssembly falta ou
falha. Origem e checksums ficam em `SOURCE.md`.

```bash
webos/tools/build-run -- webos/core/build          # ~4 min; termina com o gate
webos/core/check-wasm arquivo.wasm                  # gate sozinho (--json para saída em JSON)
```

## Receita A

1. `git archive` da tag `stremio-core-web-v0.65.0` do clone em `~/webos-tv-sdk/src/stremio-core`.
2. `recipe-a.patch`: `gloo-utils` 0.3 → 0.2, a única dependência do lockfile que exige Rust acima de 1.77.
3. Rust 1.77.2: `cargo build --release --locked --target wasm32-unknown-unknown`. O Rust 1.77 ainda
   gera wasm32 sem reference types e sem multivalue. `--remap-path-prefix` tira os caminhos locais
   das mensagens de panic, e o binário sai igual em qualquer pasta.
4. wasm-bindgen CLI 0.2.121, a mesma versão do lockfile: `--target web --no-typescript`.
5. **Correções na glue** (a mesma para as duas variantes; o build falha se um trecho não aparecer
   exatamente uma vez):
   1. em `getStringFromWasm0`, `TextDecoder.decode` passa a receber `slice()`, uma cópia, em vez
      de `subarray()`, que é uma view do `memory.buffer`. Sem isso o core cai no primeiro
      crescimento da memória, ao serializar o `ctx` (detalhes abaixo);
   2. e 3. o `DataView` e o `Uint8Array` em cache são refeitos quando
      `buffer !== wasm.memory.buffer`. No wasm2js o `grow` troca o `ArrayBuffer` por outro maior
      sem destacar o antigo, e as checagens originais (`detached`, `byteLength === 0`) não percebem:
      a glue passaria a ler e escrever no buffer velho. No WASM o buffer também muda a cada `grow`,
      então a checagem equivale à original;
   4. `__wbg_load` aceita um objeto com `webosInstantiate(imports)`, que devolve
      `{ instance, module }`. É o gancho do carregador.

   Sobre a correção 1:

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
7. `wasm2js -O` (Binaryen 133) sobre esse mesmo wasm. A saída é um módulo ES que se instancia ao
   carregar; o build a reembala como script clássico que só define a fábrica `asmFunc(imports)` no
   global `stremio_core_web_wasm2js` (ou `module.exports` no Node). É ES5 e não passa pelo Babel.
   O `-O` sai menor que o `-O2` (32,7 MB contra 34,3 MB; 3,7 MB contra 3,8 MB com gzip).
8. Babel com as `devDependencies` e o `.babelrc` do upstream (`npm ci` do lockfile do pacote), como
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

## Carregador (`loader.js`): WASM ou wasm2js em runtime

O `worker.js` vendorizado (igual ao do npm) chama
`initialize_api(require('./stremio_core_web_bg.wasm'))`. No build webOS esse `require` aponta, por
alias, para `wasm-module.js`, que devolve `loadCore()`: a promessa de um objeto com
`webosInstantiate(imports)`, que a glue chama (correção 4). O carregador decide:

| Situação | Variante | `reason` |
|---|---|---|
| sem o objeto `WebAssembly` (ou sem `compile`/`instantiate`) | wasm2js | `no-webassembly` |
| `WebAssembly.compile` do `.wasm` falha (por exemplo, wasm pós-MVP: `invalid local type`) | wasm2js | `compile-failed` |
| `WebAssembly.instantiate` falha | wasm2js | `instantiate-failed` |
| senão | wasm | `webassembly` |

- Os bytes do `.wasm` vêm por **XHR** (`fetch()` de `file://` é recusado no worker do Chromium 53).
  O wasm2js entra por `importScripts`, só quando escolhido. Falha ao ler um arquivo do pacote
  rejeita em vez de cair no wasm2js: é erro de empacotamento, não do motor.
- **Diagnóstico (F3.6):** `getStatus()` e, no worker, `self.getCoreLoaderStatus()`, que a página lê
  com `bridge.call(['getCoreLoaderStatus'])`: `variant`, `reason`, `error`, `hasWebAssembly`, URLs,
  `wasmBytes`, `memoryBytes` (tamanho atual da memória do core) e `timings` (`readMs`, `compileMs`,
  `instantiateMs` ou `wasm2jsLoadMs` e `wasm2jsInstantiateMs`).
- **Configuração:** `require('webos/core/loader').defaults` (`wasmUrl`, `wasm2jsUrl`, relativos ao
  worker; `onStep(nome, detalhe)` para marcos), ajustada antes do `init`.

**Para a F1.4** (webpack do app), o que o smoke faz em `webos/tests/core-smoke/webpack.config.js`:

```js
resolve: { alias: { [path.join(VENDOR, 'stremio_core_web_bg.wasm')]: path.join(ROOT, 'webos/core/wasm-module.js') } },
plugins: [new CopyWebpackPlugin({ patterns: [
    { from: path.join(VENDOR, 'stremio_core_web_bg.wasm'), to: <pasta do worker.js> },
    { from: path.join(VENDOR, 'stremio_core_web_bg.wasm2js.js'), to: <pasta do worker.js>, info: { minimized: true } }
] })]
```

O `.wasm2js.js` tem 32,7 MB: não pode passar pelo Babel nem pelo Terser (por isso é copiado, não
importado, e vai marcado como `minimized`).

## Smoke no emulador

`webos/tests/core-smoke/` empacota uma página que sobe o worker vendorizado como o app (com o
carregador), mede o init, lê o `ctx` e carrega catálogos do Cinemeta como convidado. O smoke também
confere a variante e o motivo escolhidos pelo carregador em cada cenário:

```bash
webos/tools/build-run -- npx webpack --config webos/tests/core-smoke/webpack.config.js
webos/tools/emu-run -- webos/tests/core-smoke/run <pasta-de-saída>              # WASM
webos/tools/emu-run -- webos/tests/core-smoke/run --hide-wasm <pasta-de-saída>  # sem WebAssembly → wasm2js
webos/tools/emu-run -- webos/tests/core-smoke/run --npm-wasm <pasta-de-saída>   # compile falha → wasm2js
webos/tools/emu-run -- webos/tests/core-smoke/run --baseline <pasta-de-saída>   # linha de base
```

`--hide-wasm` apaga o `WebAssembly` do worker antes de qualquer código do core; `--npm-wasm` dá ao
carregador o `.wasm` do npm (pós-MVP), que o V8 5.8 recusa no `compile`. O `run` sai com 1 se o app
cair, estourar o tempo, terminar com `ok=false`, escolher outra variante ou não carregar todo o
Board. A memória do convidado (`MemAvailable` e RSS de cada processo WebAppMgr) é amostrada a cada
segundo, desde antes do lançamento até `POST_SECS` (padrão 120 s) depois do fim. O JSON registra:

- `peak`: o pior momento desde o lançamento;
- `steady`: a média dos últimos 30 s;
- os processos afetados: o processo novo do app e a variação dos outros processos WebAppMgr.

Depois do init, o app ainda libera memória por ~40–45 s, então compare sempre `steady` com
`steady` da linha de base (`--baseline`: a mesma página com um worker vazio, sem o core).

O pacote do app roda de `file://`, e no Chromium 53 `fetch()` não aceita `file://` (`Failed to
fetch`). Por isso o carregador lê o `.wasm` por XHR.

O `webos/tests/core-loader/` (jest, roda no `pnpm test`) cobre as escolhas do carregador e sobe o
core vendorizado no Node nas duas variantes até o `ctx`.
