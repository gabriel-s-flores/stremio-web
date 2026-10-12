/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest, beforeEach */
// F8.6: useMetaDetails.webos.js shows the poster that was opened while the core has no meta yet, only
// on a streams page (a video in the path) and only for the item of the path.

const path = require('path');
const util = require('util');
// react-dom/server needs it, jsdom has none.
global.TextEncoder = global.TextEncoder || util.TextEncoder;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const META_DIR = path.join(__dirname, '..', '..', '..', 'src', 'routes', 'MetaDetails');
jest.mock('../../../src/routes/MetaDetails/useMetaDetails.js', () => jest.fn());

const upstream = require(path.join(META_DIR, 'useMetaDetails.js'));
const useMetaDetails = require(path.join(META_DIR, 'useMetaDetails.webos.js'));

const renderHook = (hook) => {
    let result = null;
    const Probe = () => {
        result = hook();
        return null;
    };
    renderToStaticMarkup(React.createElement(Probe));
    return result;
};

const MOVIE = { type: 'movie', id: 'tt15047880', videoId: 'tt15047880' };
const addon = { transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: { id: 'com.linvo.cinemeta', name: 'Cinemeta' } };
const selected = (id) => ({ metaPath: { resource: 'meta', type: 'movie', id, extra: [] }, streamPath: null });

describe('useMetaDetails.webos: the opened poster before the meta', () => {
    beforeEach(() => {
        document.body.innerHTML = '<a href="#/detail/movie/tt15047880/tt15047880" title="Disclosure Day"><img src="https://images.metahub.space/poster/small/tt15047880/img"></a>';
    });

    it('stands in for the meta while the core has none (Load not processed, then Loading)', () => {
        upstream.mockReturnValue({ selected: null, metaItem: null, streams: [] });
        const before = renderHook(() => useMetaDetails(MOVIE)).metaItem;
        expect(before).toMatchObject({ optimistic: true, content: { type: 'Ready', content: { name: 'Disclosure Day', logo: 'https://images.metahub.space/logo/medium/tt15047880/img' } } });
        upstream.mockReturnValue({ selected: selected('tt15047880'), metaItem: { addon, content: { type: 'Loading' } }, streams: [] });
        const loading = renderHook(() => useMetaDetails(MOVIE)).metaItem;
        expect(loading.optimistic).toBe(true);
        expect(loading.addon).toBe(addon);
    });

    it('gives way to the real meta, and stays out of the episodes page and of another item', () => {
        const ready = { addon, content: { type: 'Ready', content: { id: 'tt15047880', name: 'Disclosure Day', videos: [], links: [] } } };
        upstream.mockReturnValue({ selected: selected('tt15047880'), metaItem: ready, streams: [] });
        expect(renderHook(() => useMetaDetails(MOVIE)).metaItem).toBe(ready);
        const loading = { selected: selected('tt15047880'), metaItem: { addon, content: { type: 'Loading' } }, streams: [] };
        upstream.mockReturnValue(loading);
        expect(renderHook(() => useMetaDetails({ type: 'series', id: 'tt15047880' })).metaItem).toBe(loading.metaItem);
        upstream.mockReturnValue({ ...loading, selected: selected('tt0111161') });
        expect(renderHook(() => useMetaDetails(MOVIE)).metaItem).toBe(loading.metaItem);
    });
});
