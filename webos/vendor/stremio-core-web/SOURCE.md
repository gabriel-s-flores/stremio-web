# @stremio/stremio-core-web 0.65.0-mvp (WebAssembly MVP)

Gerado por `webos/core/build`. Não edite à mão: rode o script de novo.

- **Upstream:** https://github.com/Stremio/stremio-core, tag `stremio-core-web-v0.65.0` (commit `fa22c9ca8b8574fe7a72460023d05beff2b74026`), pasta `stremio-core-web`
- **Patch:** `webos/core/recipe-a.patch` (sha256 `f156707377c68a750aa32fe953474c1b01477aaa384cf974f23612552a1b0776`): `gloo-utils` 0.3 → 0.2, a única dependência do lockfile que exige Rust acima de 1.77; `webos/core/stream-links.patch` (sha256 `8e030cf932b82240f673d0b47d129ce38e2dc225ed1b86ba1ebd122e5ffdd5ac`): a regex dos links de player externo compilada uma vez e o zlib sem compressão do link do player escrito direto, com os mesmos bytes (F8.6); `webos/core/guest-analytics.patch` (sha256 `d7430dab61e328fb1302c8fd8c944b27479a56dc0ac08c383f97101611e60c98`): sem sessão, o evento de analytics não é montado (o `Analytics::emit` já o descartava; F8.7); `webos/core/list-links.patch` (sha256 `8b09666da7445245c5c47c62dc222eeb5e63a20fb42ff00717a9f2e13b6801cc`): a lista de streams de `meta_details` sem o `deepLinks.player`, que a página monta com os mesmos bytes (`webos/lib/player-link`), e o progresso de cada stream comparando primeiro o vídeo (F8.7); `webos/core/fast-responses.patch` (sha256 `03360891cd63a9bd7994afd554df46380e267f98c1888159f9596a74406fd647`): as respostas dos addons lidas direto do texto, sem o `serde_json::Value` intermediário nem o `serde_path_to_error` (o mesmo resultado; uma resposta que falha é lida de novo como antes, para o mesmo erro) (F8.7); `webos/core/warm-up.patch` (sha256 `032125d100fd79db94d8d81c16dceaebb8d53b54d00eb736f4f578d9fe815718`): `webos_warm_up()`, o código de abrir Detalhes rodado num modelo à parte, sem rede nem estado, para o wasm2js compilar as funções antes do primeiro título (F8.7)
- **Rust:** rustc 1.77.2 (25ef9e3d8 2024-04-09), `cargo build --release --locked --target wasm32-unknown-unknown` com `--remap-path-prefix` da pasta de trabalho e do `CARGO_HOME`
- **wasm-bindgen:** wasm-bindgen 0.2.121, `--target web --no-typescript`
- **Binaryen:** wasm-opt version 133 (version_133), `wasm-opt -O --signext-lowering`
- **Babel:** @babel/core 7.24.3, @babel/cli 7.24.1, @babel/preset-env 7.24.3, @babel/plugin-transform-runtime 7.24.3, babel-plugin-bundled-import-meta 0.3.2, com o `.babelrc` do upstream (como `scripts/build.sh`)
- **wasm2js:** wasm2js version 133 (version_133), `wasm2js -O` sobre o mesmo `stremio_core_web_bg.wasm`; a saída (módulo ES) vira um script clássico que define a fábrica `asmFunc(imports)` no global `stremio_core_web_wasm2js` (`stremio_core_web_bg.wasm2js.js`), minificado pelo terser 5.46.2 (opções padrão) e com a fábrica e `asmFunc` entre parênteses para o V8 5.8 analisá-las numa passada só (`webos/core/wasm2js-finish.js`, acorn 8.16.0). Usado só quando falta o WebAssembly ou a compilação/instanciação do wasm falha (`webos/core/loader.js`)
- **Glue** (a mesma para WASM e wasm2js):
  1. em `getStringFromWasm0`, `TextDecoder.decode` recebe `slice()` (cópia) em vez de `subarray()` (view da memória wasm). No Chromium 53 do webOS, certos usos de uma view do `memory.buffer` seguidos de `memory.grow` derrubam o processo do app (`TextDecoder.decode(view)`, `crypto.getRandomValues(view)`, `new Uint8Array(view)` depois de escrever na view). O resto da glue só usa padrões validados no emulador (escrita indexada na view inteira, `subarray().set()`, `DataView`); qualquer outro uso de view da memória precisa de repro no emulador antes. No wasm2js a cópia é inofensiva;
  2. e 3. o `DataView` e o `Uint8Array` em cache são refeitos quando `buffer !== wasm.memory.buffer`. No wasm2js o `grow` troca o `ArrayBuffer` sem destacar o antigo, e as checagens originais (`detached`, `byteLength === 0`) não percebem a troca;
  4. `__wbg_load` aceita um objeto com `webosInstantiate(imports)`, que devolve `{ instance, module }`: é por ele que o carregador entrega à glue o core WASM ou o wasm2js
- **Diferenças para o pacote npm:** o `stremio_core_web_bg.wasm` (MVP), o `stremio_core_web_bg.wasm2js.js` (novo), a glue `stremio_core_web.js` gerada para o MVP (com as correções acima) e a versão `0.65.0-mvp` no `package.json`. O `bridge.js` e o `worker.js` saem da mesma fonte e do mesmo Babel. `README.md` e `rust-toolchain.toml` do pacote npm não são copiados.

## Checksums (sha256)

| Arquivo | Bytes | sha256 |
|---|---|---|
| `bridge.js` | 3926 | `51c490dcde610baad20f6bf0c2cfc87e6b886830c2c6f80080ce4a7a796199d1` |
| `worker.js` | 5122 | `455af735f709befb35ea2b66ae70059551413d39fab5154b8de94823c288ddcc` |
| `stremio_core_web.js` | 35905 | `6411aeb7245c98570a06f8d7ce3b817e1c3250870f2121d4549399070628bc25` |
| `stremio_core_web_bg.wasm` | 5112397 | `15aec8c981ccfb70be065c8bb0b4543531fbfe865991d531135451f89b3cefe9` |
| `stremio_core_web_bg.wasm2js.js` | 9809456 | `4e29713603aea842aa02340b12dbdc680ee96352500a7d13856187031d9fa467` |
| `package.json` | 881 | `9dc4e0e231f1ae701b30e4116e519f9c375ecc07a51a426088b8946431d7d5d8` |
