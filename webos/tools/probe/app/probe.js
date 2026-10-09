/*
 * Sonda de capacidades do runtime webOS TV (ES5 de propósito: roda no Chromium 53).
 * Resultado em window.__probe (lido via cdp.mjs) e na tela.
 * window.probePlay(url) toca uma mídia e registra eventos do <video> e do luna://com.webos.media.
 */
(function () {
    'use strict';

    var R = {
        probeVersion: 1,
        startedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        chromium: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || null,
        screen: {
            width: screen.width, height: screen.height,
            innerWidth: window.innerWidth, innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
        },
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        jsHeapSizeLimit: window.performance && performance.memory ? performance.memory.jsHeapSizeLimit : null,
        palmSystem: (function () {
            var ps = window.PalmSystem || window.webOSSystem;
            if (!ps) return null;
            var info = {};
            ['deviceInfo', 'identifier', 'launchParams', 'locale', 'country', 'timeZone', 'isMinimal', 'activityId'].forEach(function (k) {
                try {
                    var v = ps[k];
                    if (typeof v === 'string' && /^[[{]/.test(v)) v = JSON.parse(v);
                    if (typeof v !== 'function') info[k] = v;
                } catch (e) { info[k] = 'erro: ' + e; }
            });
            return info;
        })(),
        syntax: {}, api: {}, css: {}, selectors: {},
        canPlayType: {}, mseIsTypeSupported: {},
        luna: {}, async: {}, media: { log: [] }
    };
    window.__probe = R;

    function check(bucket, name, fn) {
        try { bucket[name] = !!fn(); } catch (e) { bucket[name] = false; }
    }

    function syntax(name, src) {
        try { new Function(src); R.syntax[name] = true; } catch (e) { R.syntax[name] = false; }
    }

    // Sintaxe (cada uma isolada para não derrubar a sonda).
    syntax('arrow', 'var f = () => 1;');
    syntax('class', 'class A {}');
    syntax('let_const', 'let a = 1; const b = 2;');
    syntax('template_literal', 'var a = `x${1}`;');
    syntax('destructuring', 'var {a, b} = {a: 1, b: 2}; var [c] = [1];');
    syntax('default_params', 'function f(a = 1) { return a; }');
    syntax('spread_call', 'Math.max(...[1, 2]);');
    syntax('generators', 'function* g() { yield 1; }');
    syntax('exponent', 'var a = 2 ** 3;');
    syntax('async_await', 'async function f() { await 1; }');
    syntax('object_spread', 'var a = {...{b: 1}};');
    syntax('object_rest', 'var {a, ...r} = {a: 1, b: 2};');
    syntax('for_await', 'async function f() { for await (var x of []) {} }');
    syntax('optional_catch_binding', 'try {} catch {}');
    syntax('optional_chaining', 'var a = null; a?.b;');
    syntax('nullish_coalescing', 'var a = null ?? 1;');
    syntax('class_fields', 'class A { x = 1; }');
    syntax('private_fields', 'class A { #x = 1; }');
    syntax('bigint_literal', 'var a = 1n;');
    syntax('regex_named_groups', 'var r = /(?<y>\\d+)/;');
    syntax('regex_lookbehind', 'var r = /(?<=a)b/;');
    syntax('regex_dotall', 'var r = /a.b/s;');
    syntax('numeric_separator', 'var a = 1_000;');
    syntax('logical_assignment', 'var a; a ||= 1;');
    syntax('dynamic_import', 'import("x");');

    // APIs
    var A = R.api;
    check(A, 'WebAssembly', function () { return typeof WebAssembly === 'object'; });
    check(A, 'WebAssembly.instantiateStreaming', function () { return typeof WebAssembly.instantiateStreaming === 'function'; });
    check(A, 'Promise', function () { return typeof Promise === 'function'; });
    check(A, 'Promise.prototype.finally', function () { return typeof Promise.prototype.finally === 'function'; });
    check(A, 'Promise.allSettled', function () { return typeof Promise.allSettled === 'function'; });
    check(A, 'Object.entries', function () { return typeof Object.entries === 'function'; });
    check(A, 'Object.values', function () { return typeof Object.values === 'function'; });
    check(A, 'Object.fromEntries', function () { return typeof Object.fromEntries === 'function'; });
    check(A, 'Array.prototype.includes', function () { return typeof [].includes === 'function'; });
    check(A, 'Array.prototype.flat', function () { return typeof [].flat === 'function'; });
    check(A, 'String.prototype.padStart', function () { return typeof ''.padStart === 'function'; });
    check(A, 'String.prototype.replaceAll', function () { return typeof ''.replaceAll === 'function'; });
    check(A, 'Symbol.asyncIterator', function () { return typeof Symbol.asyncIterator === 'symbol'; });
    check(A, 'globalThis', function () { return typeof globalThis === 'object'; });
    check(A, 'queueMicrotask', function () { return typeof queueMicrotask === 'function'; });
    check(A, 'structuredClone', function () { return typeof structuredClone === 'function'; });
    check(A, 'BigInt', function () { return typeof BigInt === 'function'; });
    check(A, 'WeakRef', function () { return typeof WeakRef === 'function'; });
    check(A, 'FinalizationRegistry', function () { return typeof FinalizationRegistry === 'function'; });
    check(A, 'Proxy', function () { return typeof Proxy === 'function'; });
    check(A, 'fetch', function () { return typeof fetch === 'function'; });
    check(A, 'AbortController', function () { return typeof AbortController === 'function'; });
    check(A, 'ReadableStream', function () { return typeof ReadableStream === 'function'; });
    check(A, 'TextEncoder', function () { return typeof TextEncoder === 'function'; });
    check(A, 'TextDecoder', function () { return typeof TextDecoder === 'function'; });
    check(A, 'URL', function () { return typeof new URL('http://a/b').searchParams === 'object'; });
    check(A, 'Worker', function () { return typeof Worker === 'function'; });
    check(A, 'SharedArrayBuffer', function () { return typeof SharedArrayBuffer === 'function'; });
    check(A, 'serviceWorker', function () { return 'serviceWorker' in navigator; });
    check(A, 'IntersectionObserver', function () { return typeof IntersectionObserver === 'function'; });
    check(A, 'ResizeObserver', function () { return typeof ResizeObserver === 'function'; });
    check(A, 'MutationObserver', function () { return typeof MutationObserver === 'function'; });
    check(A, 'PointerEvent', function () { return typeof PointerEvent === 'function'; });
    check(A, 'requestIdleCallback', function () { return typeof requestIdleCallback === 'function'; });
    check(A, 'Intl.PluralRules', function () { return typeof Intl.PluralRules === 'function'; });
    check(A, 'Intl.RelativeTimeFormat', function () { return typeof Intl.RelativeTimeFormat === 'function'; });
    check(A, 'Intl.DateTimeFormat#formatToParts', function () { return typeof new Intl.DateTimeFormat().formatToParts === 'function'; });
    check(A, 'Intl.Locale', function () { return typeof Intl.Locale === 'function'; });
    check(A, 'localStorage', function () { localStorage.setItem('__p', '1'); return localStorage.getItem('__p') === '1'; });
    check(A, 'indexedDB', function () { return typeof indexedDB === 'object'; });
    check(A, 'crypto.getRandomValues', function () { return typeof crypto.getRandomValues === 'function'; });
    check(A, 'crypto.subtle', function () { return typeof crypto.subtle === 'object'; });
    check(A, 'navigator.mediaSession', function () { return 'mediaSession' in navigator; });
    check(A, 'navigator.clipboard', function () { return 'clipboard' in navigator; });
    check(A, 'Element#requestFullscreen', function () { return typeof document.documentElement.requestFullscreen === 'function'; });
    check(A, 'Element#webkitRequestFullscreen', function () { return typeof document.documentElement.webkitRequestFullscreen === 'function'; });
    check(A, 'Element#append', function () { return typeof document.body.append === 'function'; });
    check(A, 'Element#scrollTo', function () { return typeof document.body.scrollTo === 'function'; });
    check(A, 'NodeList#forEach', function () { return typeof document.childNodes.forEach === 'function'; });
    check(A, 'customElements', function () { return typeof customElements === 'object'; });
    check(A, 'MediaSource', function () { return typeof MediaSource === 'function'; });
    check(A, 'navigator.mediaCapabilities', function () { return 'mediaCapabilities' in navigator; });
    check(A, 'requestMediaKeySystemAccess', function () { return typeof navigator.requestMediaKeySystemAccess === 'function'; });
    check(A, 'HTMLMediaElement#audioTracks', function () { return 'audioTracks' in document.createElement('video'); });
    check(A, 'HTMLMediaElement#videoTracks', function () { return 'videoTracks' in document.createElement('video'); });
    check(A, 'PalmServiceBridge', function () { return typeof PalmServiceBridge === 'function'; });
    check(A, 'PalmSystem', function () { return typeof PalmSystem === 'object'; });
    check(A, 'webOSSystem', function () { return typeof webOSSystem === 'object'; });

    // CSS
    function css(name, prop, value) {
        check(R.css, name, function () { return window.CSS && CSS.supports(prop, value); });
    }
    css('display:grid', 'display', 'grid');
    css('gap', 'gap', '1px');
    css('position:sticky', 'position', 'sticky');
    css('position:-webkit-sticky', 'position', '-webkit-sticky');
    css('aspect-ratio', 'aspect-ratio', '1 / 1');
    css('inset', 'inset', '0');
    css('clamp()', 'width', 'clamp(1px, 2px, 3px)');
    css('min()', 'width', 'min(1px, 2px)');
    css('backdrop-filter', 'backdrop-filter', 'blur(2px)');
    css('-webkit-backdrop-filter', '-webkit-backdrop-filter', 'blur(2px)');
    css('mask-image', 'mask-image', 'none');
    css('-webkit-mask-image', '-webkit-mask-image', 'none');
    css('object-fit', 'object-fit', 'cover');
    css('custom-properties', '--x', '1');
    css('hex-alpha #rrggbbaa', 'color', '#ffffff80');
    css('filter', 'filter', 'blur(1px)');
    css('overscroll-behavior', 'overscroll-behavior', 'contain');
    css('scroll-behavior', 'scroll-behavior', 'smooth');
    css('env()', 'padding-top', 'env(safe-area-inset-top)');
    css('dvh', 'height', '100dvh');
    css('margin-inline-start', 'margin-inline-start', '1px');
    css('will-change', 'will-change', 'transform');
    css('touch-action', 'touch-action', 'none');
    ['focus-visible', 'focus-within', 'is(a)', 'where(a)', 'has(a)', 'not(.a, .b)'].forEach(function (sel) {
        check(R.selectors, ':' + sel, function () { document.querySelector(':' + sel); return true; });
    });
    // gap em flexbox só pode ser detectado medindo o layout.
    check(R.css, 'flex-gap (layout)', function () {
        var box = document.createElement('div');
        box.style.cssText = 'display:flex;gap:10px;position:absolute;left:-9999px';
        box.innerHTML = '<div style="width:10px;height:1px"></div><div style="width:10px;height:1px"></div>';
        document.body.appendChild(box);
        var ok = box.children[1].offsetLeft - box.children[0].offsetLeft === 20;
        document.body.removeChild(box);
        return ok;
    });

    // Mídia
    var TYPES = [
        'video/mp4; codecs="avc1.640028"',
        'video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.2.4.L153.B0"',
        'video/mp4; codecs="dvh1.05.06"', 'video/mp4; codecs="dvhe.05.06"',
        'video/mp4; codecs="dvh1.08.06"', 'video/mp4; codecs="dvhe.08.06"', 'video/mp4; codecs="dvhe.07.06"',
        'video/mp4; codecs="vp09.02.51.10"', 'video/webm; codecs="vp9"', 'video/webm; codecs="vp09.02.51.10"',
        'video/mp4; codecs="av01.0.08M.10"', 'video/webm; codecs="av01.0.08M.10"',
        'video/x-matroska', 'video/x-matroska; codecs="hev1"', 'video/mkv', 'video/mp2t', 'video/x-msvideo',
        'audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="ec-3"',
        'audio/mp4; codecs="dtsc"', 'audio/mp4; codecs="dtsh"', 'audio/mp4; codecs="dtse"', 'audio/mp4; codecs="dtsx"',
        'audio/mp4; codecs="mlpa"', 'audio/mp4; codecs="flac"', 'audio/mp4; codecs="fLaC"', 'audio/mp4; codecs="opus"',
        'audio/webm; codecs="opus"', 'audio/ogg; codecs="vorbis"', 'audio/flac', 'audio/mpeg',
        'application/x-mpegURL', 'application/vnd.apple.mpegurl', 'application/dash+xml',
        'video/mp4; codecs="hvc1.2.4.L153.B0, ec-3"'
    ];
    var video = document.getElementById('v');
    TYPES.forEach(function (t) {
        try { R.canPlayType[t] = video.canPlayType(t); } catch (e) { R.canPlayType[t] = 'erro'; }
        try { R.mseIsTypeSupported[t] = typeof MediaSource === 'function' ? MediaSource.isTypeSupported(t) : null; } catch (e) { R.mseIsTypeSupported[t] = 'erro'; }
    });

    // Luna via PalmServiceBridge (o mesmo que webOSTV.js usa por baixo).
    function luna(uri, params, cb) {
        if (typeof PalmServiceBridge !== 'function') { cb({ error: 'PalmServiceBridge ausente' }); return null; }
        var bridge = new PalmServiceBridge();
        bridge.onservicecallback = function (msg) {
            var parsed;
            try { parsed = JSON.parse(msg); } catch (e) { parsed = { raw: String(msg) }; }
            cb(parsed);
        };
        bridge.call(uri, JSON.stringify(params || {}));
        return bridge;
    }
    window.probeLuna = luna;

    var pending = 0;
    function track(name) { pending++; return function () { pending--; R.async[name + '_done'] = true; render(); }; }

    function lunaOnce(name, uri, params) {
        var done = track('luna:' + name);
        var finished = false;
        luna(uri, params, function (res) {
            if (finished) return;
            finished = true;
            R.luna[name] = res;
            done();
        });
        setTimeout(function () { if (!finished) { finished = true; R.luna[name] = { error: 'timeout' }; done(); } }, 5000);
    }
    lunaOnce('systemInfo', 'luna://com.webos.service.tv.systemproperty/getSystemInfo', {
        keys: ['modelName', 'firmwareVersion', 'UHD', 'sdkVersion', 'boardType', '_3d']
    });
    lunaOnce('configs', 'luna://com.webos.service.config/getConfigs', {
        configNames: ['tv.model.edidType', 'tv.model.*', 'tv.hw.*', 'tv.config.*']
    });
    lunaOnce('connection', 'luna://com.webos.service.connectionmanager/getStatus', {});
    lunaOnce('soundOutput', 'luna://com.webos.service.apiadapter/audio/getSoundOutput', {});
    lunaOnce('soundOutputLegacy', 'luna://com.webos.audio/getSoundOutput', {});

    // Rede (CORS a partir de file://) e servidor de streaming local.
    function fetchProbe(name, url) {
        if (typeof fetch !== 'function') return;
        var done = track('fetch:' + name);
        fetch(url).then(function (r) {
            return r.text().then(function (t) { R.async[name] = { status: r.status, readable: true, bytes: t.length }; });
        }).catch(function (e) { R.async[name] = { error: String(e) }; }).then(done);
    }
    fetchProbe('fetchCinemeta', 'https://v3-cinemeta.strem.io/manifest.json');
    fetchProbe('fetchNoCorsHeaders', 'https://example.com/');
    fetchProbe('fetchLocalStreamingServer', 'http://127.0.0.1:11470/settings');

    // Worker carregado de file://
    (function () {
        var done = track('worker');
        try {
            var w = new Worker('worker-probe.js');
            var timer = setTimeout(function () { R.async.worker = { error: 'timeout' }; done(); }, 8000);
            w.onmessage = function (e) { clearTimeout(timer); R.async.worker = e.data; done(); };
            w.onerror = function (e) { clearTimeout(timer); R.async.worker = { error: e.message || 'erro' }; done(); };
        } catch (e) {
            R.async.worker = { error: String(e) };
            done();
        }
    })();

    // Reprodução manual: window.probePlay('http://...mkv')
    window.probePlay = function (url) {
        var log = R.media.log = [];
        function push(entry) { entry.t = Date.now(); log.push(entry); }
        video.style.display = 'block';
        ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'error', 'ended'].forEach(function (ev) {
            video['on' + ev] = function () {
                push({
                    event: ev, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight,
                    duration: video.duration, error: video.error && video.error.code,
                    audioTracks: video.audioTracks ? video.audioTracks.length : null, mediaId: video.mediaId || null
                });
                if (ev === 'loadedmetadata' && video.mediaId && !R.media.subscribed) {
                    R.media.subscribed = true;
                    luna('luna://com.webos.media/subscribe', { mediaId: video.mediaId }, function (msg) { push({ luna: msg }); });
                }
            };
        });
        video.src = url;
        video.play();
        return 'carregando';
    };

    function render() {
        var s = document.getElementById('summary');
        var sys = R.luna.systemInfo || {};
        var dev = (R.palmSystem && R.palmSystem.deviceInfo) || {};
        s.innerHTML =
            'webOS <b>' + (dev.platformVersion || '?') + '</b> · ' +
            'Chromium <b>' + R.chromium + '</b> · WebAssembly <b>' + (R.api.WebAssembly ? 'sim' : 'NÃO') + '</b>' +
            ' · grid <b>' + (R.css['display:grid'] ? 'sim' : 'não') + '</b>' +
            ' · flex gap <b>' + (R.css['flex-gap (layout)'] ? 'sim' : 'não') + '</b>' +
            ' · async/await <b>' + (R.syntax.async_await ? 'sim' : 'não') + '</b><br>' +
            'Modelo <b>' + (sys.modelName || '?') + '</b> · firmware <b>' + (sys.firmwareVersion || '?') + '</b>' +
            ' · sdk <b>' + (sys.sdkVersion || '?') + '</b> · tela ' + R.screen.innerWidth + 'x' + R.screen.innerHeight +
            ' · pendentes ' + pending;
        document.getElementById('out').textContent = JSON.stringify({
            syntax: R.syntax, api: R.api, css: R.css, selectors: R.selectors, async: R.async
        });
        R.complete = pending === 0;
    }
    render();
})();
