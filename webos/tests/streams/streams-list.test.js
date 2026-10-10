/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeAll, afterAll */
// F6.2: the webOS overrides of the streams list (StreamsList.webos.js, Stream.webos.js and
// useC8Ranking.js) rendered with React in jsdom, over the test addon streams. The upstream
// StreamsList and Stream are replaced by small stand-ins with the same render shape (they need the
// whole app); the overrides, the rules and the probe queue are the real ones, and the probe reads
// the addon media from disk. Covers: order and labels from the names, the first probes after the
// list shows up (top 4, never the uncached stream), the reorder they cause, the frozen order once
// the user moves, the probe on focus and the cancel on unmount.

const path = require('path');
const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

const SRC = path.resolve(__dirname, '..', '..', '..', 'src', 'routes', 'MetaDetails', 'StreamsList');

jest.mock('stremio/common', () => ({
    useProfile: () => ({ settings: { audioLanguage: 'por', secondaryAudioLanguage: 'eng' } }),
}), { virtual: true });

// The probe reads the files of the test addon (helpers.js), through this mock of probeUrl.
jest.mock('../../lib/header-probe', () => {
    const actual = jest.requireActual('../../lib/header-probe');
    return Object.assign({}, actual, { probeUrl: jest.fn() });
});

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

// Stand-in for the upstream StreamsList: same render shape (header, then the scrolling container
// with `filteredStreams.map(…)` and the install button, then the loading bar).
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
            h('div', { className: 'select-choices-wrapper' }, null, null),
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

const { probeUrl } = require('../../lib/header-probe');
const { LIST_SETTINGS } = require('../../lib/stream-ranking');
const { setup, entryOf } = require('./helpers');
const StreamsList = require(path.join(SRC, 'StreamsList.webos.js'));

global.IS_REACT_ACT_ENVIRONMENT = true;

let media;
let container;
let root;
let addonStreams;

const flush = async () => {
    // The probe reads the files synchronously: its promises settle in microtasks.
    for (let index = 0; index < 50; index += 1) {
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

const items = () => Array.from(container.querySelectorAll('.stream-container'));
const idOf = (item) => entryOf({ description: item.querySelector('.description-container').textContent }).id;
const order = () => items().map(idOf);
const chipsOf = (id) => {
    const item = items().filter((element) => idOf(element) === id)[0];
    return Array.from(item.querySelectorAll('.c8-labels span')).map((span) => span.textContent);
};
const probedIds = () => probeUrl.mock.calls.map((call) => entryOf(addonStreams.filter((stream) => stream.url === call[0])[0]).id);

const render = (streams) => act(async () => {
    root.render(React.createElement(StreamsList, { streams, video: { id: 'tt0111161' }, type: 'movie' }));
});

const NAME_ORDER = [
    'web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'uncached-hdr10', 'remux-unnamed', 'web-hevc10-ddp',
    'web-multi-mkv', 'web-unnamed-atmos', 'web-h264-aac', 'dts-hd-ma', 'truehd-only', 'remux-dv-p5-truehd', 'web-av1',
];

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    media = setup();
    addonStreams = media.streams.map((stream, index) => Object.assign({}, stream, { deepLinks: { player: `#/player/${index}` } }));
    probeUrl.mockImplementation((url) => media.probeUrl(url));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterAll(() => {
    act(() => root.unmount());
    media.cleanup();
    jest.useRealTimers();
});

describe('StreamsList on webOS', () => {
    it('shows the placeholders while the addon loads', async () => {
        await render([{ addon: { transportUrl: 'http://addon/manifest.json', manifest: { name: 'Debrid de teste' } }, content: { type: 'Loading' } }]);
        expect(container.querySelectorAll('.placeholder')).toHaveLength(2);
    });

    it('opens ordered and labelled by the names, with no probe yet', async () => {
        await render([{ addon: { transportUrl: 'http://addon/manifest.json', manifest: { name: 'Debrid de teste' } }, content: { type: 'Ready', content: addonStreams } }]);
        expect(order()).toEqual(NAME_ORDER);
        expect(chipsOf('web-dv-p81-mp4')).toEqual(['DV']);
        expect(chipsOf('web-dv-hdr10-atmos-mkv')).toEqual(['HDR10 nesta TV', 'Atmos']);
        expect(chipsOf('remux-dv-p5-truehd')).toEqual(['DV P5: cores erradas', 'TrueHD: pode ficar sem som']);
        expect(chipsOf('truehd-only')).toEqual(['TrueHD: pode ficar sem som']);
        expect(chipsOf('dts-hd-ma')).toEqual(['DTS a confirmar']);
        expect(chipsOf('web-av1')).toEqual(['AV1: não toca nesta TV']);
        expect(chipsOf('remux-unnamed')).toEqual([]);
        const av1 = items()[items().length - 1];
        expect(av1.className).toContain('tier-hidden');
        expect(av1.getAttribute('data-c8-tier')).toBe('hidden');
        expect(items()[0].getAttribute('data-c8-source')).toBe('name');
        // The labels come after the play icon (a row of their own under the upstream row).
        const children = Array.from(items()[0].children).map((child) => child.className);
        expect(children).toEqual(['info-container', 'description-container', 'icon', 'c8-labels']);
        // The rest of the upstream render is kept.
        expect(container.querySelector('.install-button-container')).not.toBeNull();
        expect(probeUrl).not.toHaveBeenCalled();
    });

    it('probes the top 4 after the list settles (never the uncached stream) and follows the results', async () => {
        await advance(LIST_SETTINGS.initialDelay - 1);
        expect(probeUrl).not.toHaveBeenCalled();
        await advance(1);
        expect(probedIds()).toEqual(['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'remux-unnamed']);
        // The unnamed REMUX is DV P5 + TrueHD: down to the demoted streams, with the warnings.
        // The DV P8.1 MKV has a DD+ Atmos track in Portuguese, the profile language: +20 over the DV MP4s.
        expect(order()).toEqual([
            'web-dv-hdr10-atmos-mkv', 'web-dv-p81-mp4', 'web-dv-p5-mp4', 'uncached-hdr10', 'web-hevc10-ddp', 'web-multi-mkv',
            'web-unnamed-atmos', 'web-h264-aac', 'dts-hd-ma', 'truehd-only', 'remux-dv-p5-truehd', 'remux-unnamed', 'web-av1',
        ]);
        expect(chipsOf('remux-unnamed')).toEqual(['DV P5: cores erradas', 'TrueHD: sem som nesta TV']);
        expect(items()[0].getAttribute('data-c8-source')).toBe('probe');
        // The REMUX left the top: the HEVC 10-bit took its place among the first 4 probeable streams
        // and is probed in turn; nothing below them is.
        await advance(LIST_SETTINGS.initialDelay);
        expect(probedIds()).toEqual(['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'remux-unnamed', 'web-hevc10-ddp']);
        await advance(LIST_SETTINGS.initialDelay);
        expect(probeUrl).toHaveBeenCalledTimes(5);
        expect(order().slice(0, 5)).toEqual(['web-dv-hdr10-atmos-mkv', 'web-dv-p81-mp4', 'web-dv-p5-mp4', 'uncached-hdr10', 'web-hevc10-ddp']);
    });

    it('keeps the order once the user moves; the focused stream is probed after a pause and only its labels change', async () => {
        const list = container.querySelector('.streams-container');
        await act(async () => {
            list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        const before = order();
        const target = () => items().filter((element) => idOf(element) === 'web-unnamed-atmos')[0];
        const passing = () => items().filter((element) => idOf(element) === 'web-h264-aac')[0];

        // Moving past an item does not probe it.
        await act(async () => passing().focus());
        await advance(LIST_SETTINGS.focusDelay / 2);
        await act(async () => target().focus());
        await advance(LIST_SETTINGS.focusDelay);
        expect(probedIds().slice(5)).toEqual(['web-unnamed-atmos']);
        expect(chipsOf('web-unnamed-atmos')).toEqual(['Atmos']);
        // Unfrozen, the Atmos would put it 4th; frozen, it stays where the user found it.
        expect(order()).toEqual(before);
    });

    it('does not probe the uncached stream on focus either', async () => {
        const uncached = items().filter((element) => idOf(element) === 'uncached-hdr10')[0];
        await act(async () => uncached.focus());
        await advance(LIST_SETTINGS.focusDelay * 2);
        expect(probedIds()).not.toContain('uncached-hdr10');
    });

    it('leaving the list drops the probes that have not started', async () => {
        const { getProbeQueue } = require('../../lib/stream-ranking');
        const queue = getProbeQueue();
        probeUrl.mockImplementation(() => new Promise(() => { /* never settles */ }));
        ['web-multi-mkv', 'web-h264-aac', 'dts-hd-ma'].forEach((id) => {
            const element = items().filter((item) => idOf(item) === id)[0];
            act(() => element.focus());
            act(() => jest.advanceTimersByTime(LIST_SETTINGS.focusDelay));
        });
        const urls = addonStreams.filter((stream) => ['web-multi-mkv', 'web-h264-aac', 'dts-hd-ma'].indexOf(entryOf(stream).id) !== -1).map((stream) => stream.url);
        expect(urls.map((url) => queue.get(url).status).sort()).toEqual(['queued', 'running', 'running']);
        await act(async () => root.unmount());
        expect(urls.filter((url) => queue.has(url))).toHaveLength(2);
        root = createRoot(container);
    });
});
