/* global jest */
// F6.2: shared setup of the jsdom tests of the streams list overrides (streams-list*.test.js).
// Require it first in the test file (its jest.mock calls apply to the test's module registry).
//
// The upstream StreamsList and Stream are replaced by small stand-ins with the same render shape
// (they need the whole app); the overrides, the rules, the probe queue and the header probe are the
// real ones. The network is a fake fetch() that serves the test addon media from disk with Range,
// like media-server.mjs: `hang(url)` keeps the transfers of a URL open until they are cancelled.

const path = require('path');
const fs = require('fs');

jest.mock('stremio/common', () => ({
    useProfile: () => ({ settings: { audioLanguage: 'por', secondaryAudioLanguage: 'eng' } }),
}), { virtual: true });

// The route of the list: active until the test puts another route on top (the Player).
jest.mock('stremio/common/useRouteFocused', () => {
    const ReactModule = require('react');
    const listeners = [];
    let active = true;
    return {
        useRouteActive: () => {
            const [value, setValue] = ReactModule.useState(active);
            ReactModule.useEffect(() => {
                listeners.push(setValue);
                return () => listeners.splice(listeners.indexOf(setValue), 1);
            }, []);
            return value;
        },
        setRouteActive: (value) => {
            active = value;
            listeners.forEach((listener) => listener(value));
        },
    };
}, { virtual: true });

// webpack resolves ./Stream to Stream.webos.js in the webOS build; Jest to Stream.js.
jest.mock('../../../src/routes/MetaDetails/StreamsList/Stream/index.js', () => jest.requireActual('../../../src/routes/MetaDetails/StreamsList/Stream/Stream.webos.js'));
jest.mock('../../../src/routes/MetaDetails/StreamsList/Stream/styles', () => ({ 'description-container': 'description-container', icon: 'icon' }), { virtual: true });
jest.mock('../../../src/routes/MetaDetails/StreamsList/Stream/c8-labels.less', () => ({
    'c8-labels': 'c8-labels', label: 'c8-label', warning: 'c8-warning', demote: 'demote', hide: 'hide', 'tier-hidden': 'tier-hidden',
}));

// Stand-in for the upstream Stream: a Popup whose label is the focusable item.
jest.mock('../../../src/routes/MetaDetails/StreamsList/Stream/Stream.js', () => {
    const ReactModule = require('react');
    const h = ReactModule.createElement;
    const Popup = ({ renderLabel }) => renderLabel({ className: 'label-container', children: null });
    const Stream = ({ name, description }) => {
        ReactModule.useState(false);
        return h(Popup, {
            renderLabel: ({ className, children, ...props }) => h('div', Object.assign({ className: `${className} stream-container`, tabIndex: 0 }, props),
                h('div', { className: 'info-container' }, name),
                h('div', { className: 'description-container' }, description),
                h('span', { className: 'icon' }),
                children),
        });
    };
    Stream.Placeholder = () => h('div', { className: 'placeholder' });
    return Stream;
});

// Stand-in for the upstream StreamsList: same render shape (header with the addon selector, then the
// scrolling container with `filteredStreams.map(…)` and the install button, then the loading bar).
jest.mock('../../../src/routes/MetaDetails/StreamsList/StreamsList.js', () => {
    const ReactModule = require('react');
    const h = ReactModule.createElement;
    const Stream = require('../../../src/routes/MetaDetails/StreamsList/Stream');
    const StreamsList = ({ streams }) => {
        ReactModule.useState('ALL');
        const items = [];
        streams.filter((entry) => entry.content.type === 'Ready').forEach((entry) => {
            entry.content.content.forEach((stream) => items.push(Object.assign({}, stream, { addonName: entry.addon.manifest.name })));
        });
        return h('div', { className: 'streams-list-container' },
            h('div', { className: 'select-choices-wrapper' }, h('div', { className: 'addon-selector', tabIndex: 0 }, 'All')),
            items.length === 0 ?
                h('div', { className: 'streams-container' }, h(Stream.Placeholder), h(Stream.Placeholder))
                :
                h(ReactModule.Fragment, null,
                    h('div', { className: 'streams-container' },
                        items.map((stream, index) => h(Stream, {
                            key: index,
                            addonName: stream.addonName,
                            name: stream.name,
                            description: stream.description,
                            deepLinks: stream.deepLinks,
                        })),
                        h('div', { className: 'install-button-container' })),
                    null));
    };
    return StreamsList;
});

const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');
const headerProbe = require('../../lib/header-probe');
const ranking = require('../../lib/stream-ranking');
const { setup, entryOf, MEDIA_URL } = require('./helpers');
const routeFocused = require('stremio/common/useRouteFocused');

const StreamsList = require(path.join(__dirname, '..', '..', '..', 'src', 'routes', 'MetaDetails', 'StreamsList', 'StreamsList.webos.js'));

global.IS_REACT_ACT_ENVIRONMENT = true;

// fetch() over the media folder: Range answers (206) after the debrid-like redirect, like
// media-server.mjs. Records every request; `hang(url)` leaves its bodies open until cancelled.
const createFakeFetch = (dir) => {
    const requests = [];
    const cancels = [];
    const hanging = new Set();
    const fakeFetch = (url, init) => {
        // The query (`?v=…`, distinct URLs per test) is not part of the file name.
        const media = url.slice(`${MEDIA_URL}/redirect/`.length).split('?')[0];
        const file = path.join(dir, media);
        const range = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
        const size = fs.statSync(file).size;
        const start = Number(range[1]);
        const end = Math.min(Number(range[2]), size - 1);
        requests.push({ url, media, start, end, options: init });
        const data = Buffer.alloc(end - start + 1);
        const fd = fs.openSync(file, 'r');
        fs.readSync(fd, data, 0, data.length, start);
        fs.closeSync(fd);
        const headers = { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(data.length) };
        let sent = false;
        let finish = null;
        const reader = {
            read: () => {
                if (hanging.has(url)) return new Promise((resolve) => { finish = resolve; });
                if (sent) return Promise.resolve({ done: true });
                sent = true;
                return Promise.resolve({ done: false, value: new Uint8Array(data.buffer, data.byteOffset, data.length) });
            },
            cancel: () => {
                cancels.push(url);
                if (finish !== null) finish({ done: true });
                return Promise.resolve();
            },
        };
        return Promise.resolve({
            status: 206,
            url: `${MEDIA_URL}/${media}`,
            redirected: true,
            headers: { get: (name) => headers[name.toLowerCase()] || null },
            body: { getReader: () => reader, cancel: () => reader.cancel() },
        });
    };
    return { fetch: fakeFetch, requests, cancels, hang: (url) => hanging.add(url) };
};

// One list on the page: render(streams), the items as shown, and the probes asked for.
// `variant` makes the stream URLs unique to this harness (the probe cache is shared by the app).
const createHarness = (variant) => {
    const media = setup();
    const network = createFakeFetch(media.dir);
    global.fetch = network.fetch;
    const probeSpy = jest.spyOn(headerProbe, 'probe');
    const readerSpy = jest.spyOn(headerProbe, 'createFetchReadRange');
    const suffix = variant ? `?v=${variant}` : '';
    const addonStreams = media.streams.map((stream, index) => Object.assign({}, stream, { url: stream.url + suffix, deepLinks: { player: `#/player/${index}` } }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root = createRoot(container);

    const flush = async () => {
        // The fake network answers in microtasks.
        for (let index = 0; index < 60; index += 1) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    };
    const advance = async (ms) => {
        await act(async () => {
            jest.advanceTimersByTime(ms);
        });
        await flush();
    };
    const addonEntry = (streams) => ({ addon: { transportUrl: 'http://addon/manifest.json', manifest: { name: 'Debrid de teste' } }, content: { type: 'Ready', content: streams } });
    const render = (streams, videoId) => act(async () => {
        root.render(React.createElement(StreamsList, { streams, video: { id: videoId || 'tt0111161' }, type: 'movie' }));
    });
    const items = () => Array.from(container.querySelectorAll('.stream-container'));
    const idOf = (item) => entryOf({ description: item.querySelector('.description-container').textContent }).id;
    const itemOf = (id) => items().filter((element) => idOf(element) === id)[0];
    const order = () => items().map(idOf);
    const chipsOf = (id) => Array.from(itemOf(id).querySelectorAll('.c8-labels span')).map((span) => span.textContent);
    const urlOf = (id) => addonStreams.filter((stream) => entryOf(stream).id === id)[0].url;
    // The streams the list asked the header probe for, in order.
    const ownCalls = () => readerSpy.mock.calls.filter((call) => addonStreams.some((stream) => stream.url === call[0]));
    const probedIds = () => ownCalls().map((call) => entryOf(addonStreams.filter((stream) => stream.url === call[0])[0]).id);
    const unmount = () => act(async () => {
        root.unmount();
        root = createRoot(container);
    });
    const cleanup = () => {
        act(() => root.unmount());
        container.remove();
        media.cleanup();
    };
    return {
        media, network, probeSpy, readerSpy, addonStreams, container,
        ownCalls, flush, advance, addonEntry, render, items, idOf, itemOf, order, chipsOf, urlOf, probedIds, unmount, cleanup,
        setRouteActive: (value) => act(async () => routeFocused.setRouteActive(value)),
    };
};

const NAME_ORDER = [
    'web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'uncached-hdr10', 'remux-unnamed', 'web-hevc10-ddp',
    'web-multi-mkv', 'web-unnamed-atmos', 'web-h264-aac', 'dts-hd-ma', 'truehd-only', 'remux-dv-p5-truehd', 'web-av1',
];

module.exports = { React, act, ranking, headerProbe, createHarness, NAME_ORDER, LIST_SETTINGS: ranking.LIST_SETTINGS };
