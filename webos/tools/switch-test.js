// Avaliado no app-sonda via cdp.mjs: N cargas seguidas, liberando o pipeline entre elas.
// MODE = 'same' (mesmo <video>, removeAttribute+load), 'new' (um <video> novo por carga) ou
// 'luna' (luna://com.webos.media/unload {mediaId} antes de removeAttribute+load) ou
// 'direct' (sem liberar: atribui o novo src e o Chromium desmonta o player anterior).
(function (MODE, N, URLS, GAP) {
    GAP = GAP || 1500;
    return new Promise(function (res) {
        var results = [];
        var current = document.getElementById('v');
        function release(v, done) {
            if (MODE === 'direct') { done(); return; }   // só troca o src na próxima carga
            if (MODE !== 'luna') v.pause();
            var finish = function () {
                v.removeAttribute('src');
                v.load();
                if (MODE === 'new' && v.parentNode) v.parentNode.removeChild(v);
                done();
            };
            if (MODE === 'luna' && v.mediaId && v.mediaId !== '<invalid mediaId>') {
                var called = false;
                var once = function () { if (!called) { called = true; finish(); } };
                window.probeLuna('luna://com.webos.media/unload', { mediaId: v.mediaId }, once);
                setTimeout(once, 3000);
            } else {
                finish();
            }
        }
        function step(i) {
            if (i >= N) { res(results); return; }
            var v = current;
            if (MODE === 'new') {
                v = document.createElement('video');
                v.style.cssText = 'position:fixed;right:24px;bottom:24px;width:640px;height:360px;background:#000';
                document.body.appendChild(v);
            }
            var url = URLS[i % URLS.length];
            var meta = false;
            v.onloadedmetadata = function () { meta = true; };
            v.src = url;
            v.play();
            setTimeout(function () {
                results.push({ i: i, url: url.split('/').pop(), meta: meta, t: Math.round(v.currentTime * 10) / 10, audio: v.audioTracks ? v.audioTracks.length : null });
                current = MODE === 'new' ? null : v;
                release(v, function () { setTimeout(function () { step(i + 1); }, GAP); });
            }, 5000);
        }
        if (MODE === 'new') { current.style.display = 'none'; }
        step(0);
    });
})
