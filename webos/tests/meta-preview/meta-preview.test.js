/**
 * @jest-environment jsdom
 */
/* global describe, it, expect */
// F8.6: the details page shows the poster that was opened while the core has no meta yet
// (webos/lib/meta-preview).

const { findPreview, optimisticMetaItem, MEMORY_SIZE } = require('../../lib/meta-preview');

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

    it('stands in for a meta item that is null or loading', () => {
        const loading = optimisticMetaItem({ addon, content: { type: 'Loading' } }, preview);
        expect(loading.optimistic).toBe(true);
        expect(loading.addon).toBe(addon);
        expect(loading.content.type).toBe('Ready');
        expect(loading.content.content).toMatchObject({ id: 'tt15047880', type: 'movie', name: 'Disclosure Day', logo: 'l', background: 'b', videos: [], links: [] });
        expect(Number.isNaN(loading.content.content.released.getTime())).toBe(true);
        expect(optimisticMetaItem(null, preview).content.content.name).toBe('Disclosure Day');
    });

    it('leaves the real answer, an error, or no preview alone', () => {
        const ready = { addon, content: { type: 'Ready', content: { id: 'tt15047880', name: 'Disclosure Day' } } };
        const error = { addon, content: { type: 'Err', content: {} } };
        expect(optimisticMetaItem(ready, preview)).toBe(ready);
        expect(optimisticMetaItem(error, preview)).toBe(error);
        expect(optimisticMetaItem(null, null)).toBeNull();
    });
});
