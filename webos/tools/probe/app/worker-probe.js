/* Executado como Web Worker a partir de file:// para medir o que o worker enxerga. */
var result = {
    WebAssembly: typeof WebAssembly === 'object',
    fetch: typeof fetch === 'function',
    TextDecoder: typeof TextDecoder === 'function',
    importScripts: typeof importScripts === 'function',
    location: String(self.location && self.location.href)
};
if (typeof fetch === 'function') {
    fetch('https://v3-cinemeta.strem.io/manifest.json').then(function (r) {
        result.fetchCinemeta = r.status;
        self.postMessage(result);
    }, function (e) {
        result.fetchCinemeta = 'erro: ' + e;
        self.postMessage(result);
    });
} else {
    self.postMessage(result);
}
