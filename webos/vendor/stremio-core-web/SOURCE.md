# @stremio/stremio-core-web 0.65.0-mvp (WebAssembly MVP)

Gerado por `webos/core/build`. Não edite à mão: rode o script de novo.

- **Upstream:** https://github.com/Stremio/stremio-core, tag `stremio-core-web-v0.65.0` (commit `fa22c9ca8b8574fe7a72460023d05beff2b74026`), pasta `stremio-core-web`
- **Patch:** `webos/core/recipe-a.patch` (sha256 `f156707377c68a750aa32fe953474c1b01477aaa384cf974f23612552a1b0776`): `gloo-utils` 0.3 → 0.2, a única dependência do lockfile que exige Rust acima de 1.77; `webos/core/stream-links.patch` (sha256 `8e030cf932b82240f673d0b47d129ce38e2dc225ed1b86ba1ebd122e5ffdd5ac`): a regex dos links de player externo compilada uma vez e o zlib sem compressão do link do player escrito direto, com os mesmos bytes (F8.6)
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
| `stremio_core_web.js` | 34361 | `39bb2133b30a6775f2478ab8dfb7f20a4772df1f54dcb0f5ea77d63d45c5ded4` |
| `stremio_core_web_bg.wasm` | 4913686 | `6c40f87bf9e990a7db57c926880846ce4c68be9c40a43dcc4a7e06c9ec792b3c` |
| `stremio_core_web_bg.wasm2js.js` | 9421971 | `1a62957168244a22caf914ac261e58d02f4644c97095870e9c9202e7abaece2d` |
| `package.json` | 881 | `9dc4e0e231f1ae701b30e4116e519f9c375ecc07a51a426088b8946431d7d5d8` |
