/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeAll, afterAll */
// F8.6: the streams list renders its first streams and more as the focus or the scroll nears the end
// (useShownStreams.js), over a Torrentio-like answer (webos/tests/addon/torrentio.js).

const { act, createHarness } = require('./render-setup');
const { torrentioStreams } = require('../addon/torrentio');
const { SHOWN } = require('../../../src/routes/MetaDetails/StreamsList/useShownStreams');

let list;
const streams = torrentioStreams('http://media.test', { count: 60 }).map((stream, index) => ({ ...stream, description: stream.title, deepLinks: { player: `#/player/${index}` } }));
const focusItem = (index) => act(async () => {
    list.items()[index].focus();
});

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    list = createHarness('shown');
    window.location.hash = '#/detail/movie/tt15047880/tt15047880';
});

afterAll(() => {
    list.cleanup();
    jest.useRealTimers();
});

describe('StreamsList on webOS, rendered on demand', () => {
    it('renders the first streams only', async () => {
        await list.render([list.addonEntry(streams)]);
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

    it('renders as many coming back to the same page, and the first ones on another', async () => {
        await list.unmount();
        await list.render([list.addonEntry(streams)]);
        expect(list.items()).toHaveLength(60);
        await list.unmount();
        window.location.hash = '#/detail/movie/tt0111161/tt0111161';
        await list.render([list.addonEntry(streams)]);
        expect(list.items()).toHaveLength(24);
    });

    it('grows when the list is scrolled near its bottom (Magic Remote)', async () => {
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
