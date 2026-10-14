/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest */
// F8.6: MetaPreview.webos.js leaves out the library and watched toggles of the details page's preview
// (webos/lib/meta-preview), and passes everything else to the upstream component as is.
// F8.7: the logo only once it is loaded (webos/lib/image-ready), the name (no logo) meanwhile.

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

// The page's tlsproxy: logos of metahub go through the proxy, the rest as they are.
jest.mock('../../tlsproxy/page', () => ({
    __esModule: true,
    default: {
        subscribe: () => () => {},
        getVersion: () => 1,
        proxify: (url) => (url.indexOf('https://images.metahub.space/') === 0 ? `http://127.0.0.1:47443/proxy?url=${encodeURIComponent(url)}` : url),
    },
}));

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

    it('passes no logo until it is loaded: the upstream then shows the name', () => {
        const logo = 'https://images.metahub.space/logo/medium/tt1/img';
        expect(propsOf({ name: 'One', links: [], logo }).logo).toBeNull();
        // Loaded once (through the proxy, as the Image asks for it): from then on, at once.
        require('../../lib/image-ready').remember(`http://127.0.0.1:47443/proxy?url=${encodeURIComponent(logo)}`);
        expect(propsOf({ name: 'One', links: [], logo }).logo).toBe(logo);
        expect(propsOf({ name: 'One', links: [], logo: null }).logo).toBeNull();
    });

    it('is the upstream component for a real meta item', () => {
        const props = propsOf({ name: 'One', links: [], toggleInLibrary, toggleWatched });
        expect(props.toggleInLibrary).toBe(toggleInLibrary);
        expect(props.toggleWatched).toBe(toggleWatched);
        expect(MetaPreview.Placeholder).toBe(upstream.Placeholder);
    });
});
