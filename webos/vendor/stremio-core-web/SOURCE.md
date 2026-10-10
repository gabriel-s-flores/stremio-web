# @stremio/stremio-core-web 0.65.0-mvp (WebAssembly MVP)

Gerado por `webos/core/build`. Não edite à mão: rode o script de novo.

- **Upstream:** https://github.com/Stremio/stremio-core, tag `stremio-core-web-v0.65.0` (commit `fa22c9ca8b8574fe7a72460023d05beff2b74026`), pasta `stremio-core-web`
- **Patch:** `webos/core/recipe-a.patch` (sha256 `f156707377c68a750aa32fe953474c1b01477aaa384cf974f23612552a1b0776`): `gloo-utils` 0.3 → 0.2, a única dependência do lockfile que exige Rust acima de 1.77
- **Rust:** rustc 1.77.2 (25ef9e3d8 2024-04-09), `cargo build --release --locked --target wasm32-unknown-unknown` com `--remap-path-prefix` da pasta de trabalho e do `CARGO_HOME`
- **wasm-bindgen:** wasm-bindgen 0.2.121, `--target web --no-typescript`
- **Binaryen:** wasm-opt version 133 (version_133), `wasm-opt -O --signext-lowering`
- **Babel:** @babel/core 7.24.3, @babel/cli 7.24.1, @babel/preset-env 7.24.3, @babel/plugin-transform-runtime 7.24.3, babel-plugin-bundled-import-meta 0.3.2, com o `.babelrc` do upstream (como `scripts/build.sh`)
- **Glue:** em `getStringFromWasm0`, `TextDecoder.decode` recebe `slice()` (cópia) em vez de `subarray()` (view da memória wasm). No Chromium 53 do webOS, uma view do `memory.buffer` entregue ao Blink seguida de `memory.grow` derruba o renderer
- **Diferenças para o pacote npm:** só o `stremio_core_web_bg.wasm` (MVP), a glue `stremio_core_web.js` gerada para ele (com a correção acima) e a versão `0.65.0-mvp` no `package.json`. O `bridge.js` e o `worker.js` saem da mesma fonte e do mesmo Babel. `README.md` e `rust-toolchain.toml` do pacote npm não são copiados.

## Checksums (sha256)

| Arquivo | Bytes | sha256 |
|---|---|---|
| `bridge.js` | 3926 | `51c490dcde610baad20f6bf0c2cfc87e6b886830c2c6f80080ce4a7a796199d1` |
| `worker.js` | 5122 | `455af735f709befb35ea2b66ae70059551413d39fab5154b8de94823c288ddcc` |
| `stremio_core_web.js` | 34139 | `b9f94819a8c23fa59ac42c38a6f14d616da1a1ba39b5b35b21dc0f162b7203a9` |
| `stremio_core_web_bg.wasm` | 4913718 | `0607123a2b13b4179cabf719d94980fbb10a0853d4a327d7dfa793e8368ea505` |
| `package.json` | 881 | `9dc4e0e231f1ae701b30e4116e519f9c375ecc07a51a426088b8946431d7d5d8` |
