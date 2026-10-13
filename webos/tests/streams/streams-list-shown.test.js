/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeAll, afterAll */
// F8.6: the streams list renders its first streams and more as the focus or the scroll nears the end
// (useShownStreams.js), over a Torrentio-like answer (webos/tests/addon/torrentio.js). The count reached
// belongs to the page's route (type, id, video), as the app's router gives it.

const { act, createHarness } = require('./render-setup');
const { torrentioStreams } = require('../addon/torrentio');
const { SHOWN } = require('../../../src/routes/MetaDetails/StreamsList/useShownStreams');

const MOVIE = '/detail/movie/tt15047880/tt15047880';
const OTHER_MOVIE = '/detail/movie/tt0111161/tt0111161';
const EPISODE = '/detail/series/tt26545992/tt26545992%3A1%3A1';

let list;
const streams = torrentioStreams('http://media.test', { count: 60 }).map((stream, index) => ({ ...stream, description: stream.title, deepLinks: { player: `#/player/${index}` } }));
const focusItem = (index) => act(async () => {
    list.items()[index].focus();
});

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    list = createHarness('shown');
});

afterAll(() => {
    list.cleanup();
    jest.useRealTimers();
});

describe('StreamsList on webOS, rendered on demand', () => {
    it('renders the first streams only', async () => {
        await list.render([list.addonEntry(streams)], null, { path: MOVIE });
        expect(SHOWN.first).toBe(24);
        expect(list.items()).toHaveLength(24);
        // The rest of the upstream render is kept after the items.
        expect(list.container.querySelector('.install-button-container')).not.toBeNull();
    });

    it('grows when the focus gets near the end, and up to the whole list', async () => {
        await focusItem(SHOWN.first - SHOWN.ahead - 1);
        expect(list.items()).toHaveLength(24);
        await focusItem(SHOWN.first - SHOWN.ahead);
        expect(list.items()).toHaveLength(16 + SHOWN.ahead + SHOWN.step);
        await focusItem(45);
        expect(list.items()).toHaveLength(60);
    });

    it('keeps its count with another route on top (the Player changes the location, not this route)', async () => {
        const hash = window.location.hash;
        window.location.hash = '#/player/eAEBAwL8';
        await list.render([list.addonEntry(streams.slice())], null, { path: MOVIE });
        expect(list.items()).toHaveLength(60);
        window.location.hash = hash;
    });

    it('renders as many coming back to the same page, and the first ones on another', async () => {
        await list.unmount();
        await list.render([list.addonEntry(streams)], null, { path: MOVIE });
        expect(list.items()).toHaveLength(60);
        await list.unmount();
        await list.render([list.addonEntry(streams)], null, { path: OTHER_MOVIE });
        expect(list.items()).toHaveLength(24);
    });

    it('keeps the count and the focus of an episode when its meta (the video) comes after the streams', async () => {
        await list.unmount();
        await list.render([list.addonEntry(streams)], null, { path: EPISODE, type: 'series', video: null });
        await focusItem(20);
        expect(list.items()).toHaveLength(52);
        await focusItem(45);
        expect(list.items()).toHaveLength(60);
        const focused = document.activeElement;
        await list.render([list.addonEntry(streams)], null, { path: EPISODE, type: 'series', video: { id: 'tt26545992:1:1', season: 1, episode: 1, title: 'Episode 1' } });
        expect(list.items()).toHaveLength(60);
        expect(document.activeElement).toBe(focused);
        expect(list.items().indexOf(document.activeElement)).toBe(45);
    });

    it('grows when the list is scrolled near its bottom (Magic Remote)', async () => {
        await list.unmount();
        await list.render([list.addonEntry(streams)], null, { path: '/detail/movie/tt1/tt1' });
        const container = list.container.querySelector('.streams-container');
        Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 3000 });
        Object.defineProperty(container, 'clientHeight', { configurable: true, value: 800 });
        container.scrollTop = 1000;
        await act(async () => container.dispatchEvent(new window.Event('scroll')));
        expect(list.items()).toHaveLength(24);
        container.scrollTop = 1700;
        await act(async () => container.dispatchEvent(new window.Event('scroll')));
        expect(list.items()).toHaveLength(48);
    });
});
