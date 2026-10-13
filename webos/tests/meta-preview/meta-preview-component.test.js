/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest */
// F8.6: MetaPreview.webos.js leaves out the library and watched toggles of the details page's preview
// (webos/lib/meta-preview), and passes everything else to the upstream component as is.

const path = require('path');
const util = require('util');
// react-dom/server needs it, jsdom has none.
global.TextEncoder = global.TextEncoder || util.TextEncoder;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

jest.mock('../../../src/components/MetaPreview/MetaPreview.js', () => {
    const mock = jest.fn(() => null);
    mock.Placeholder = () => null;
    return mock;
});

const DIR = path.join(__dirname, '..', '..', '..', 'src', 'components', 'MetaPreview');
const upstream = require(path.join(DIR, 'MetaPreview.js'));
const MetaPreview = require(path.join(DIR, 'MetaPreview.webos.js'));
const { optimisticMetaItem } = require('../../lib/meta-preview');

const propsOf = (props) => {
    upstream.mockClear();
    renderToStaticMarkup(React.createElement(MetaPreview, props));
    return upstream.mock.calls[0][0];
};

describe('MetaPreview.webos', () => {
    const toggleInLibrary = () => {};
    const toggleWatched = () => {};

    it('has no library and watched toggles for the preview', () => {
        const preview = optimisticMetaItem({ addon: {}, content: { type: 'Loading' } }, { id: 'tt1', type: 'movie', name: 'One', poster: null, logo: null, background: null }).content.content;
        const props = propsOf({ name: preview.name, links: preview.links, toggleInLibrary, toggleWatched, inLibrary: false });
        expect(props).toMatchObject({ name: 'One', toggleInLibrary: null, toggleWatched: null, inLibrary: false });
    });

    it('is the upstream component for a real meta item', () => {
        const props = propsOf({ name: 'One', links: [], toggleInLibrary, toggleWatched });
        expect(props.toggleInLibrary).toBe(toggleInLibrary);
        expect(props.toggleWatched).toBe(toggleWatched);
        expect(MetaPreview.Placeholder).toBe(upstream.Placeholder);
    });
});
