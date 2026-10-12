/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeAll, afterAll */
// F6.2: the webOS overrides of the streams list (StreamsList.webos.js, Stream.webos.js and
// useC8Ranking.js) rendered with React in jsdom, over the test addon streams (setup and stand-ins:
// render-setup.js). Covers: order and labels from the names, the first probes after the list shows
// up (top 4, never the uncached stream) with the list's probe options, the reorder they cause, the
// frozen order once the user moves, the probe on focus and leaving the list. The freeze rules and
// the probe budget have their own file (streams-list-freeze.test.js).

const { act, createHarness, NAME_ORDER, LIST_SETTINGS, ranking } = require('./render-setup');

let list;

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    list = createHarness();
});

afterAll(() => {
    list.cleanup();
    jest.useRealTimers();
});

describe('StreamsList on webOS', () => {
    it('shows the placeholders while the addon loads', async () => {
        await list.render([{ addon: { transportUrl: 'http://addon/manifest.json', manifest: { name: 'Debrid de teste' } }, content: { type: 'Loading' } }]);
        expect(list.container.querySelectorAll('.placeholder')).toHaveLength(2);
    });

    it('opens ordered and labelled by the names, with no probe yet', async () => {
        await list.render([list.addonEntry(list.addonStreams)]);
        expect(list.order()).toEqual(NAME_ORDER);
        expect(list.chipsOf('web-dv-p81-mp4')).toEqual(['DV']);
        expect(list.chipsOf('web-dv-hdr10-atmos-mkv')).toEqual(['HDR10 nesta TV', 'Atmos']);
        expect(list.chipsOf('remux-dv-p5-truehd')).toEqual(['DV P5: cores erradas', 'TrueHD: pode ficar sem som']);
        expect(list.chipsOf('truehd-only')).toEqual(['TrueHD: pode ficar sem som']);
        expect(list.chipsOf('dts-hd-ma')).toEqual([]);
        expect(list.chipsOf('web-av1')).toEqual(['AV1: não toca nesta TV']);
        expect(list.chipsOf('remux-unnamed')).toEqual([]);
        const av1 = list.items()[list.items().length - 1];
        expect(av1.className).toContain('tier-hidden');
        expect(av1.getAttribute('data-c8-tier')).toBe('hidden');
        expect(list.items()[0].getAttribute('data-c8-source')).toBe('name');
        // F8.3: the labels come right under the text, in the description's column; the upstream row
        // keeps its children.
        const children = Array.from(list.items()[0].children).map((child) => child.className);
        expect(children).toEqual(['info-container', 'description-container', 'icon']);
        const description = Array.from(list.items()[0].querySelector('.description-container').children).map((child) => child.className);
        expect(description).toEqual(['description-text', 'c8-labels']);
        // The rest of the upstream render is kept.
        expect(list.container.querySelector('.install-button-container')).not.toBeNull();
        expect(list.readerSpy).not.toHaveBeenCalled();
    });

    it('probes the top 4 after the list settles (never the uncached stream) and follows the results', async () => {
        await list.advance(LIST_SETTINGS.initialDelay - 1);
        expect(list.readerSpy).not.toHaveBeenCalled();
        await list.advance(1);
        expect(list.probedIds()).toEqual(['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'remux-unnamed']);
        // The list's probe budget reaches the header probe (reader and parser): 2 MB, 8 requests,
        // 10 s, no bytes skipped from a server that ignores Range, through the cancellable fetch.
        const budget = { maxBytes: 2 * 1024 * 1024, maxRequests: 8, timeout: 10000, maxSkipBytes: 0 };
        list.readerSpy.mock.calls.forEach((call) => {
            expect(call[1]).toMatchObject(budget);
            expect(typeof call[1].fetch).toBe('function');
        });
        list.probeSpy.mock.calls.forEach((call) => expect(call[1]).toMatchObject(budget));
        expect(list.network.requests.every((request) => request.end - request.start + 1 <= 256 * 1024)).toBe(true);
        expect(list.network.requests.every((request) => request.options.credentials === 'omit')).toBe(true);
        // The unnamed REMUX is DV P5 + TrueHD: down to the demoted streams, with the warnings.
        // The DV P8.1 MKV has a DD+ Atmos track in Portuguese, the profile language: +20 over the DV MP4s.
        expect(list.order()).toEqual([
            'web-dv-hdr10-atmos-mkv', 'web-dv-p81-mp4', 'web-dv-p5-mp4', 'uncached-hdr10', 'dts-hd-ma', 'web-hevc10-ddp',
            'web-multi-mkv', 'web-unnamed-atmos', 'web-h264-aac', 'truehd-only', 'remux-dv-p5-truehd', 'remux-unnamed', 'web-av1',
        ]);
        expect(list.chipsOf('remux-unnamed')).toEqual(['DV P5: cores erradas', 'TrueHD: sem som nesta TV']);
        expect(list.items()[0].getAttribute('data-c8-source')).toBe('probe');
        // The REMUX left the top: the DTS-HD MA (it plays since F8.4) took its place among the first 4
        // probeable streams and is probed in turn; nothing below them is.
        await list.advance(LIST_SETTINGS.initialDelay);
        expect(list.probedIds()).toEqual(['web-dv-p81-mp4', 'web-dv-p5-mp4', 'web-dv-hdr10-atmos-mkv', 'remux-unnamed', 'dts-hd-ma']);
        await list.advance(LIST_SETTINGS.initialDelay);
        expect(list.readerSpy).toHaveBeenCalledTimes(5);
        // The DTS-HD MA track is in the profile language (eng): +20, above the HDR10 one (+10).
        expect(list.order().slice(0, 5)).toEqual(['web-dv-hdr10-atmos-mkv', 'web-dv-p81-mp4', 'web-dv-p5-mp4', 'dts-hd-ma', 'uncached-hdr10']);
        expect(list.chipsOf('dts-hd-ma')).toEqual(['DTS-HD MA']);
    });

    it('keeps the order once the user moves; the focused stream is probed after a pause and only its labels change', async () => {
        const container = list.container.querySelector('.streams-container');
        await act(async () => {
            container.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        const before = list.order();
        const target = () => list.items().filter((element) => list.idOf(element) === 'web-unnamed-atmos')[0];
        const passing = () => list.items().filter((element) => list.idOf(element) === 'web-h264-aac')[0];

        // Moving past an item does not probe it.
        await act(async () => passing().focus());
        await list.advance(LIST_SETTINGS.focusDelay / 2);
        await act(async () => target().focus());
        await list.advance(LIST_SETTINGS.focusDelay);
        expect(list.probedIds().slice(5)).toEqual(['web-unnamed-atmos']);
        expect(list.chipsOf('web-unnamed-atmos')).toEqual(['Atmos']);
        // Unfrozen, the Atmos would put it 4th; frozen, it stays where the user found it.
        expect(list.order()).toEqual(before);
    });

    it('does not probe the uncached stream on focus either', async () => {
        const uncached = list.items().filter((element) => list.idOf(element) === 'uncached-hdr10')[0];
        await act(async () => uncached.focus());
        await list.advance(LIST_SETTINGS.focusDelay * 2);
        expect(list.probedIds()).not.toContain('uncached-hdr10');
    });

    it('leaving the list drops the queued probes and stops the running ones (their transfer is cancelled)', async () => {
        const queue = ranking.getProbeQueue();
        const ids = ['web-multi-mkv', 'web-h264-aac', 'truehd-only'];
        const urls = ids.map(list.urlOf);
        urls.forEach(list.network.hang);
        for (const id of ids) {
            await act(async () => list.itemOf(id).focus());
            await list.advance(LIST_SETTINGS.focusDelay);
        }
        expect(urls.map((url) => queue.get(url).status).sort()).toEqual(['queued', 'running', 'running']);
        // (The probe itself cancels each body once it has read enough: count from here.)
        const cancelledBefore = list.network.cancels.length;
        await list.unmount();
        await list.flush();
        // Nothing left in the queue for them (the next visit probes again) and both transfers closed.
        expect(urls.filter((url) => queue.has(url))).toEqual([]);
        expect(list.network.cancels.slice(cancelledBefore).sort()).toEqual(urls.slice(0, 2).sort());
        expect(queue.stats()).toMatchObject({ queued: 0, running: 0 });
    });
});
