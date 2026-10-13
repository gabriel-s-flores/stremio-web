/**
 * @jest-environment jsdom
 */
/* global describe, it, expect */
// F8.6: the details page shows the poster that was opened while the core has no meta yet
// (webos/lib/meta-preview).

const { findPreview, optimisticMetaItem, isOptimistic, MEMORY_SIZE } = require('../../lib/meta-preview');
const { proxyUrlFor } = require('../../tlsproxy/client');

const board = (items) => {
    document.body.innerHTML = items.map(({ href, title, src }) => (
        `<a class="meta-item-link-x1" href="${href}" title="${title}"><div><img class="poster-image" src="${src}"></div></a>`
    )).join('');
};

describe('findPreview', () => {
    it('finds the poster of the item on the screen, with the metahub logo and background of an IMDb item', () => {
        board([
            { href: '#/detail/movie/tt0111161/tt0111161', title: 'The Shawshank Redemption', src: 'https://images.metahub.space/poster/small/tt0111161/img' },
            { href: '#/detail/movie/tt15047880/tt15047880', title: 'Disclosure Day', src: 'https://images.metahub.space/poster/small/tt15047880/img' },
        ]);
        expect(findPreview(document, 'movie', 'tt15047880')).toEqual({
            id: 'tt15047880',
            type: 'movie',
            name: 'Disclosure Day',
            poster: 'https://images.metahub.space/poster/small/tt15047880/img',
            logo: 'https://images.metahub.space/logo/medium/tt15047880/img',
            background: 'https://images.metahub.space/background/medium/tt15047880/img',
        });
    });

    it('reads the poster through the tlsproxy of the C8: the original URL, no port or token kept', () => {
        const poster = 'https://images.metahub.space/poster/small/tt15047880/img';
        board([{ href: '#/detail/movie/tt15047880/tt15047880', title: 'Disclosure Day', src: proxyUrlFor(47443, 's3cr3t', poster) }]);
        const preview = findPreview(document, 'movie', 'tt15047880');
        expect(preview).toMatchObject({
            poster,
            logo: 'https://images.metahub.space/logo/medium/tt15047880/img',
            background: 'https://images.metahub.space/background/medium/tt15047880/img',
        });
        expect(JSON.stringify(preview)).not.toMatch(/127\.0\.0\.1|s3cr3t/);
        // A loopback src that is not a proxy URL is not kept at all.
        board([{ href: '#/detail/movie/tt7/tt7', title: 'Seven', src: 'http://127.0.0.1:47443/x?t=s3cr3t' }]);
        expect(findPreview(document, 'movie', 'tt7')).toMatchObject({ poster: null, logo: null });
    });

    it('takes no logo or background from a metahub poster of another item', () => {
        board([{ href: '#/detail/movie/tt15047880/tt15047880', title: 'Disclosure Day', src: 'https://images.metahub.space/poster/small/tt0111161/img' }]);
        expect(findPreview(document, 'movie', 'tt15047880')).toMatchObject({ logo: null, background: null });
    });

    it('takes no logo or background from another kind of poster, and needs a name', () => {
        board([
            { href: '#/detail/series/kitsu%3A1/kitsu%3A1%3A1', title: 'Anime', src: 'https://example.org/p.jpg' },
            { href: '#/detail/movie/tt1/tt1', title: '', src: 'https://images.metahub.space/poster/small/tt1/img' },
        ]);
        expect(findPreview(document, 'series', 'kitsu:1')).toMatchObject({ name: 'Anime', poster: 'https://example.org/p.jpg', logo: null, background: null });
        expect(findPreview(document, 'movie', 'tt1')).toBeNull();
        // Not a prefix of another id.
        board([{ href: '#/detail/movie/tt12/tt12', title: 'Other', src: 'x' }]);
        expect(findPreview(document, 'movie', 'tt1')).toBeNull();
    });

    it('remembers what it found once the poster is gone', () => {
        board([{ href: '#/detail/movie/tt0111161/tt0111161', title: 'The Shawshank Redemption', src: 'p' }]);
        expect(findPreview(document, 'movie', 'tt0111161').name).toBe('The Shawshank Redemption');
        document.body.innerHTML = '';
        expect(findPreview(document, 'movie', 'tt0111161').name).toBe('The Shawshank Redemption');
        expect(MEMORY_SIZE).toBeGreaterThan(0);
    });
});

describe('optimisticMetaItem', () => {
    const preview = { id: 'tt15047880', type: 'movie', name: 'Disclosure Day', poster: 'p', logo: 'l', background: 'b' };
    const addon = { transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: { id: 'com.linvo.cinemeta', name: 'Cinemeta' } };

    it('stands in for a meta item that is loading, marked for MetaPreview.webos.js', () => {
        const loading = optimisticMetaItem({ addon, content: { type: 'Loading' } }, preview);
        expect(loading.optimistic).toBe(true);
        expect(loading.addon).toBe(addon);
        expect(loading.content.type).toBe('Ready');
        expect(loading.content.content).toMatchObject({ id: 'tt15047880', type: 'movie', name: 'Disclosure Day', logo: 'l', background: 'b', videos: [], links: [] });
        expect(Number.isNaN(loading.content.content.released.getTime())).toBe(true);
        expect(isOptimistic(loading.content.content.links)).toBe(true);
        expect(isOptimistic([])).toBe(false);
        expect(isOptimistic(undefined)).toBe(false);
    });

    it('leaves no meta (no addon for it), the real answer, an error, or no preview alone', () => {
        const ready = { addon, content: { type: 'Ready', content: { id: 'tt15047880', name: 'Disclosure Day', links: [] } } };
        const error = { addon, content: { type: 'Err', content: {} } };
        expect(optimisticMetaItem(null, preview)).toBeNull();
        expect(optimisticMetaItem(ready, preview)).toBe(ready);
        expect(isOptimistic(ready.content.content.links)).toBe(false);
        expect(optimisticMetaItem(error, preview)).toBe(error);
        expect(optimisticMetaItem({ addon, content: { type: 'Loading' } }, null).content.type).toBe('Loading');
    });
});
