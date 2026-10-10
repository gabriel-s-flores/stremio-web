# Core MVP (`@stremio/stremio-core-web` para o webOS TV 4.x)

O Chromium 53 do webOS TV 4.x (V8 5.8) só aceita WebAssembly MVP. O wasm publicado no npm usa
externref, multivalue, bulk memory e conversões sem trap, e falha com `invalid local type`. Esta
pasta gera o mesmo pacote como MVP e o versiona em `webos/vendor/stremio-core-web/`, com os mesmos
nomes de arquivos do npm (`bridge.js`, `worker.js`, `stremio_core_web.js`,
`stremio_core_web_bg.wasm`, `package.json`). Do mesmo wasm sai a variante **wasm2js**
(`stremio_core_web_bg.wasm2js.js`). O carregador (`loader.js`) escolhe uma das duas em runtime: no
webOS 4 prefere o wasm2js, e cada variante serve de reserva para a outra. Origem e checksums ficam em
`SOURCE.md`.

```bash
webos/tools/build-run -- webos/core/build          # ~5–11 min, conforme a carga; termina com o gate
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
   O `-O` sai menor que o `-O2` (32,7 MB contra 34,3 MB). Por fim, `wasm2js-finish.js`:
   - minifica com o terser do repo, opções padrão (o mesmo que o `ares-package` faria sem
     `--no-minify`): 32,6 MB → 9,4 MB (3,4 MB com gzip);
   - põe a fábrica e `asmFunc` entre parênteses, depois do terser, localizando-as pela AST. É a
     heurística do V8 para "função chamada logo": o V8 5.8 analisa e compila as duas já no
     `importScripts`, numa passada só, em vez de pré-analisar o arquivo, analisar a fábrica inteira
     ao chamá-la e analisar `asmFunc` de novo ao chamá-la.

   No perfil C8 do emulador, isso leva o init do wasm2js de ~19 s (arquivo de 32,6 MB, embrulho
   simples) para ~9 s, com pico de memória menor (spike `webos/spikes/core-init`, relatório da
   F0.11). Os números da F0.6 (13,7–14,2 s) eram do arquivo minificado sem querer pelo
   `ares-package` do smoke, sem os parênteses. O WASM segue em ~21–25 s no C8: o V8 5.8 compila o
   wasm inteiro com o TurboFan antes de rodar. No emulador padrão, os dois levam ~3,8 s.
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
alias, para `wasm-module.js`, que devolve `loadConfigured()`: a promessa de um objeto com
`webosInstantiate(imports)`, que a glue chama (correção 4).

**Variante preferida.** No webOS 4 o carregador tenta primeiro o **wasm2js** (`defaults.prefer`). É a
condição do gate G0: no perfil C8 o wasm2js inicializa em ~9 s e o WASM em 20–25 s, com pico de
memória maior. A chave **`webos.coreVariant`** do `localStorage` da página troca a preferência:
`"wasm"` ou `"wasm2js"`. Qualquer outro valor, ou a chave ausente, mantém o padrão. O
`loadConfigured()` lê a chave no `init` do worker, pelo Bridge (`self.local_storage_get_item`, o
mesmo caminho que o core usa para o storage), e vale a partir do próximo lançamento do app. É para
a tela de diagnóstico (F3.6) e para a Fase 8 na TV real, onde a relação entre as duas variantes
pode se inverter:

```js
localStorage.setItem('webos.coreVariant', 'wasm');   // WASM primeiro; removeItem volta ao padrão
```

O carregador decide:

| Preferida | Situação | Variante | `reason` |
|---|---|---|---|
| wasm2js | o wasm2js carrega e instancia (com ou sem `WebAssembly`) | wasm2js | `preferred` |
| wasm2js | o wasm2js falha (`importScripts` ou a fábrica) e há `WebAssembly` | wasm | `wasm2js-failed` |
| wasm | sem o objeto `WebAssembly` (ou sem `compile`/`instantiate`) | wasm2js | `no-webassembly` |
| wasm | `WebAssembly.compile` do `.wasm` falha (por exemplo, wasm pós-MVP: `invalid local type`) | wasm2js | `compile-failed` |
| wasm | `WebAssembly.instantiate` falha | wasm2js | `instantiate-failed` |
| wasm | senão | wasm | `webassembly` |

Se as duas variantes falham, ou se o wasm2js falha sem `WebAssembly`, o status fica com `ok: false`.

- Os bytes do `.wasm` vêm por **XHR** (`fetch()` de `file://` é recusado no worker do Chromium 53),
  só quando o WASM é tentado. O wasm2js entra por `importScripts`, só quando escolhido. Falha ao ler
  o `.wasm` rejeita em vez de cair no wasm2js: é erro de empacotamento, não do motor.
- **Memória:** o `WebAssembly.Module` compilado (código nativo do wasm inteiro, ~100 MB no V8 5.8)
  só fica vivo enquanto a glue o usa. A promessa de `loadCore()` fica no cache de módulos do webpack
  durante toda a vida do worker, então o objeto entregue à glue é de uso único: na primeira chamada
  ele solta o `Module`, e se o `instantiate` falha o handler solta a sua cópia antes de subir o
  wasm2js. Sem isso, o caminho `instantiate-failed` ficava com o código nativo e o wasm2js juntos
  (158–163 MB no estável do processo, contra 129–134 MB). Mesmo assim, o pico desse caminho (~255–295 MB no processo)
  dura até o GC coletar o `Module`, uns 50 s depois do init.
- **Diagnóstico (F3.6):** `getStatus()` e, no worker, `self.getCoreLoaderStatus()`, que a página lê
  com `bridge.call(['getCoreLoaderStatus'])`: `ok` (`null` carregando, `true` pronto, `false` se uma
  etapa falhou), `stage` (a etapa em andamento ou a que falhou: `wasm-read`, `wasm-compile`,
  `wasm-instantiate`, `wasm2js-load`, `wasm2js-instantiate`, `ready`), `variant`, `reason`, `error`
  (o motivo da troca ou, com `ok: false`, o erro que parou o core), `prefer`, `preferSource`
  (`default` ou `config`), `preferConfig` (o valor lido da chave, mesmo inválido), `hasWebAssembly`, URLs,
  `wasmBytes`, `memoryBytes` (tamanho atual da memória do core) e `timings` (`readMs`, `compileMs`,
  `instantiateMs` ou `wasm2jsLoadMs` e `wasm2jsInstantiateMs`).
- **Configuração:** `require('webos/core/loader').defaults` (`wasmUrl`, `wasm2jsUrl`, relativos ao
  worker; `prefer`; `onStep(nome, detalhe)` para marcos), ajustada antes do `init`. As opções de
  `loadCore(options)` e `loadConfigured(options)` sobrepõem os `defaults`; no `loadConfigured`, a
  chave do `localStorage` sobrepõe o `prefer`.

## No app (`webos/webpack/core.js`)

O build webOS (`pnpm webos:build`) usa o core vendorizado no lugar do pacote do npm:

- `@stremio/stremio-core-web` (a página importa o `bridge`) aponta para `webos/vendor/stremio-core-web`;
- a entry do worker é o `worker.js` vendorizado, e o `require` do `.wasm` dele aponta para o
  `wasm-module.js`;
- o `.wasm` e o `.wasm2js.js` vão copiados para a pasta do `worker.js`
  (`build-webos/<commit>/scripts/`), marcados como `minimized`.

O `.wasm2js.js` já sai minificado e com a fábrica entre parênteses: não pode passar de novo pelo
Babel nem pelo Terser, que tirariam os parênteses. Por isso é copiado, não importado, e vai marcado
como `minimized`. Pelo mesmo motivo, empacote com `ares-package --no-minify` (como o
`webos/scripts/ares.sh` e o `core-smoke/run`). Duas guardas:

- `CoreArtifactsGuard` (no `core.js`) faz o `webos:build` falhar se um dos dois arquivos não sair
  byte a byte igual ao do vendor;
- o `pnpm webos:check-syntax` roda antes o `webos/scripts/check-core.js` no `build-webos/`: confere
  os bytes de novo e, pela AST, os parênteses da fábrica e de `asmFunc`. Ele aceita outra pasta (por
  exemplo, um IPK desempacotado): `node webos/scripts/check-core.js <pasta>`.

O build desktop não usa nada disto.

## Smoke no emulador

`webos/tests/core-smoke/` empacota uma página que sobe o worker vendorizado como o app (com o
carregador), mede o init, lê o `ctx` e carrega catálogos do Cinemeta como convidado. O smoke também
confere a variante e o motivo escolhidos pelo carregador em cada cenário. Ele testa o caminho com o
**WASM preferido** e as quedas para o wasm2js (o `smoke-worker.js` põe `defaults.prefer = 'wasm'`):

```bash
webos/tools/build-run -- npx webpack --config webos/tests/core-smoke/webpack.config.js
webos/tools/emu-run -- webos/tests/core-smoke/run <pasta-de-saída>              # WASM
webos/tools/emu-run -- webos/tests/core-smoke/run --hide-wasm <pasta-de-saída>  # sem WebAssembly → wasm2js
webos/tools/emu-run -- webos/tests/core-smoke/run --npm-wasm <pasta-de-saída>   # compile falha → wasm2js
webos/tools/emu-run -- webos/tests/core-smoke/run --instantiate-fail <pasta>     # instantiate falha → wasm2js
webos/tools/emu-run --profile c8 --timeout 15 -- webos/tests/core-smoke/run …    # perfil C8 (F0.9)
webos/tools/emu-run -- webos/tests/core-smoke/run --baseline <pasta-de-saída>   # linha de base
```

`--hide-wasm` apaga o `WebAssembly` do worker antes de qualquer código do core; `--npm-wasm` dá ao
carregador o `.wasm` do npm (pós-MVP), que o V8 5.8 recusa no `compile`; `--instantiate-fail` passa
imports vazios ao `instantiate` nativo, e o V8 5.8 recusa o link de verdade
(`module is not an object or function`). O `run` sai com 1 se o app cair, estourar o tempo, terminar
com `ok=false`, escolher outra variante, não carregar todo o Board ou, com `--max-steady-mb N`,
passar de N MB no estável do processo do app (155 MB pega a retenção do `Module` no
`instantiate-failed`: 158–163 MB com ela, 129–134 MB sem ela; o maior estável normal medido foi
145 MB). A memória do convidado (`MemAvailable` e RSS de cada processo WebAppMgr) é amostrada a cada
segundo, desde antes do lançamento até `POST_SECS` (padrão 120 s) depois do fim. O JSON registra:

- `peak`: o pior momento desde o lançamento;
- `steady`: a média dos últimos 30 s;
- os processos afetados: o processo novo do app e a variação dos outros processos WebAppMgr.

Depois do init, o app ainda libera memória por ~40–45 s, então compare sempre `steady` com
`steady` da linha de base (`--baseline`: a mesma página com um worker vazio, sem o core).

O pacote do app roda de `file://`, e no Chromium 53 `fetch()` não aceita `file://` (`Failed to
fetch`). Por isso o carregador lê o `.wasm` por XHR.

O `webos/tests/core-loader/` (jest, roda no `pnpm test`) cobre as escolhas do carregador, inclusive
a preferência e a chave do `localStorage`, e sobe o core vendorizado no Node nas duas variantes até
o `ctx`. O `webos/tests/core-build.test.js` cobre o `core.js` e as duas guardas.
