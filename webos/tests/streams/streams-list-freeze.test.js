/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeAll, afterAll, afterEach */
// F6.2 (review c1): the order never changes while a list item has the focus or after the first
// interaction on the screen, wherever it happened; the focus probe needs the pause on the item;
// a route on top (the Player) stops the list's probes; and the automatic probes have a ceiling.
// Each test has its own list with its own stream URLs (the probe cache is shared by the app).

const { act, createHarness, NAME_ORDER, LIST_SETTINGS, ranking } = require('./render-setup');

const ORDER_WITH_PROBES = [
    'web-dv-hdr10-atmos-mkv', 'web-dv-p81-mp4', 'web-dv-p5-mp4', 'uncached-hdr10', 'web-hevc10-ddp', 'web-multi-mkv',
    'web-unnamed-atmos', 'web-h264-aac', 'dts-hd-ma', 'truehd-only', 'remux-dv-p5-truehd', 'remux-unnamed', 'web-av1',
];

let list = null;
let variant = 0;

const open = async () => {
    variant += 1;
    list = createHarness(`freeze-${variant}`);
    await list.render([list.addonEntry(list.addonStreams)]);
    expect(list.order()).toEqual(NAME_ORDER);
};

// The top probes land (with the REMUX found to be DV P5 + TrueHD).
const probesLand = async () => {
    await list.advance(LIST_SETTINGS.initialDelay * 3);
    expect(list.probedIds().slice(0, 4)).toEqual(['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'remux-unnamed']);
    expect(list.chipsOf('remux-unnamed')).toEqual(['DV P5: cores erradas', 'TrueHD: sem som nesta TV']);
};

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
});

afterEach(async () => {
    await list.setRouteActive(true);
    list.cleanup();
    document.body.focus();
});

afterAll(() => {
    jest.useRealTimers();
});

describe('the order on screen stays put', () => {
    it('control: with no interaction and no focus in the list, the probes reorder it', async () => {
        await open();
        await probesLand();
        expect(list.order()).toEqual(ORDER_WITH_PROBES);
    });

    it('the focus entering the list without any key inside it (review c1, finding 1) freezes the order', async () => {
        await open();
        // The remote moved the focus from the addon selector to the 1st item: no key on the list.
        await act(async () => list.items()[0].focus());
        const focused = list.idOf(document.activeElement);
        await probesLand();
        expect(list.idOf(document.activeElement)).toBe(focused);
        expect(list.order()).toEqual(NAME_ORDER);
        // The labels follow the probes all the same.
        expect(list.chipsOf('web-dv-hdr10-atmos-mkv')).toEqual(['HDR10 nesta TV', 'Atmos']);
    });

    it('a key anywhere on the screen (body, the addon selector) freezes the order', async () => {
        await open();
        await act(async () => {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        await probesLand();
        expect(list.order()).toEqual(NAME_ORDER);
    });

    it('the Magic Remote pointer moving anywhere freezes the order', async () => {
        await open();
        await act(async () => {
            document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
        });
        await probesLand();
        expect(list.order()).toEqual(NAME_ORDER);
    });

    it('an item focused before the list re-renders (no event seen by the list) freezes the order', async () => {
        await open();
        // The focus moves to an item but no focusin reaches React (stopped at the window): only the
        // check of document.activeElement at the next render can see it.
        const stop = (event) => event.stopImmediatePropagation();
        window.addEventListener('focusin', stop, true);
        await act(async () => list.items()[2].focus());
        window.removeEventListener('focusin', stop, true);
        expect(list.idOf(document.activeElement)).toBe('web-dv-hdr10-atmos-mkv');
        await probesLand();
        expect(list.order()).toEqual(NAME_ORDER);
    });

    it('a key before the streams arrive freezes the first order shown', async () => {
        variant += 1;
        list = createHarness(`freeze-${variant}`);
        await list.render([{ addon: { transportUrl: 'http://addon/manifest.json', manifest: { name: 'Debrid de teste' } }, content: { type: 'Loading' } }]);
        await act(async () => {
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        await list.render([list.addonEntry(list.addonStreams)]);
        expect(list.order()).toEqual(NAME_ORDER);
        await probesLand();
        expect(list.order()).toEqual(NAME_ORDER);
    });
});

describe('focus probe', () => {
    it('leaving an item before the pause (to the addon selector) does not probe it', async () => {
        await open();
        const selector = list.container.querySelector('.addon-selector');
        await act(async () => list.itemOf('web-unnamed-atmos').focus());
        await list.advance(LIST_SETTINGS.focusDelay / 2);
        await act(async () => selector.focus());
        await list.advance(LIST_SETTINGS.focusDelay * 2);
        expect(list.probedIds()).not.toContain('web-unnamed-atmos');
        // Staying on it does.
        await act(async () => list.itemOf('web-unnamed-atmos').focus());
        await list.advance(LIST_SETTINGS.focusDelay);
        expect(list.probedIds()).toContain('web-unnamed-atmos');
    });
});

describe('another route on top (the Player)', () => {
    it('stops the running probes, drops the queued ones and asks for no more', async () => {
        await open();
        const queue = ranking.getProbeQueue();
        const top = ['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'remux-unnamed'].map(list.urlOf);
        top.forEach(list.network.hang);
        await list.advance(LIST_SETTINGS.initialDelay);
        expect(top.map((url) => queue.get(url).status)).toEqual(['running', 'running', 'queued', 'queued']);
        const cancelledBefore = list.network.cancels.length;

        await list.setRouteActive(false);
        await list.flush();
        expect(top.filter((url) => queue.has(url))).toEqual([]);
        expect(list.network.cancels.slice(cancelledBefore).sort()).toEqual(top.slice(0, 2).sort());
        expect(queue.stats()).toMatchObject({ queued: 0, running: 0 });

        // While the Player is on top, nothing new is asked for (timers or focus).
        const calls = list.ownCalls().length;
        await act(async () => list.itemOf('web-h264-aac').focus());
        await list.advance(LIST_SETTINGS.initialDelay * 3);
        expect(list.ownCalls()).toHaveLength(calls);
    });
});

describe('automatic probe ceiling', () => {
    it('stops at maxAutoProbes even when every result pushes a stream out of the top', async () => {
        variant += 1;
        list = createHarness(`ceiling-${variant}`);
        // 20 streams with nothing in the name; every file is TrueHD only, so each probe demotes its
        // stream and lets the next one into the top 4.
        const base = list.addonStreams.filter((stream) => /truehd-atmos-mp4/.test(stream.url))[0];
        const streams = Array.from({ length: 20 }, (_, index) => Object.assign({}, base, {
            name: '[RD+] Teste\n1080p',
            description: `Filme.2023.1080p.WEB-DL.${index}-GRP.mp4`,
            behaviorHints: {},
            url: `${base.url}&n=${index}`,
            deepLinks: { player: `#/player/ceiling-${index}` },
        }));
        const urls = streams.map((stream) => stream.url);
        await list.render([list.addonEntry(streams)]);
        for (let round = 0; round < 10; round += 1) {
            await list.advance(LIST_SETTINGS.initialDelay);
        }
        const probed = list.readerSpy.mock.calls.filter((call) => urls.indexOf(call[0]) !== -1);
        expect(probed).toHaveLength(LIST_SETTINGS.maxAutoProbes);
        expect(LIST_SETTINGS.maxAutoProbes).toBe(8);
    });
});
