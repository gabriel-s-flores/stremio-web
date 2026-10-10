// Stub for @stremio/libass-wasm in the webOS build (F1.5). assRenderer loads the library on
// demand; constructing the renderer fails, load() rejects and withHTMLSubtitles falls back to
// the plain subtitles path (fallbackFromASS / fallbackFromEmbeddedASS).

function SubtitlesOctopus() {
    throw new Error('libass is not available in the webOS build');
}

module.exports = SubtitlesOctopus;
module.exports.default = SubtitlesOctopus;
