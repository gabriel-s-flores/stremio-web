/* global describe, it, expect, jest */
// F8.3 (review c1, finding 2): useMetaDetails.webos.js hands the page the meta item with its entities
// decoded. Without the decodeMetaItem in the hook this stays green everywhere else.

const path = require('path');
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

const ready = (content) => ({ type: 'Ready', content });

describe('useMetaDetails.webos: the meta item', () => {
    it('decodes the entities of a Ready item (name, cast and the search link)', () => {
        const metaItem = { content: ready({
            name: 'Tom &amp; Jerry',
            links: [{ name: 'Josh O&apos;Connor', category: 'Cast', url: 'stremio:///search?search=Josh%20O%26apos%3BConnor' }],
            videos: [],
        }) };
        upstream.mockReturnValue({ metaItem, streams: [] });
        const decoded = renderHook(useMetaDetails).metaItem.content.content;
        expect(decoded.name).toBe('Tom & Jerry');
        expect(decoded.links[0]).toEqual({ name: 'Josh O\'Connor', category: 'Cast', url: 'stremio:///search?search=Josh%20O\'Connor' });
    });

    it('returns the same object when nothing needs decoding, and leaves a meta item that is not Ready', () => {
        const plain = { metaItem: { content: ready({ name: 'Plain', links: [], videos: [] }) }, streams: [] };
        upstream.mockReturnValue(plain);
        expect(renderHook(useMetaDetails)).toBe(plain);
        const loading = { metaItem: { content: { type: 'Loading' } }, streams: [] };
        upstream.mockReturnValue(loading);
        expect(renderHook(useMetaDetails).metaItem).toBe(loading.metaItem);
        upstream.mockReturnValue({ metaItem: null, streams: [] });
        expect(renderHook(useMetaDetails).metaItem).toBeNull();
    });
});
