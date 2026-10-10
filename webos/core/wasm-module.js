// Substitui o require('./stremio_core_web_bg.wasm') do worker.js vendorizado (alias no webpack):
// em vez da URL do .wasm, o worker passa à glue a promessa do carregador, que escolhe WASM ou
// wasm2js em runtime (webos/core/loader.js). O .wasm e o .wasm2js.js vão, copiados, para a pasta
// do worker.
module.exports = require('./loader').loadCore();
