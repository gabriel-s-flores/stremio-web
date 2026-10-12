/* global describe, it, expect */
// F8.3: the HTML entities of a Cinemeta meta item decoded for the details page
// (src/routes/MetaDetails/decodeMetaEntities.js, used by useMetaDetails.webos.js).

const { decodeMetaEntities } = require('../../../src/routes/MetaDetails/decodeMetaEntities');

// Part of the answer of Cinemeta for tt15047880 (2026-10-12).
const META = {
    id: 'tt15047880',
    name: 'Disclosure Day',
    description: 'If you found out we weren\'t alone, if someone showed you, proved it to you, would that frighten you?',
    links: [
        { name: '6.4', category: 'imdb', url: 'https://imdb.com/title/tt15047880' },
        { name: 'Emily Blunt', category: 'Cast', url: 'stremio:///search?search=Emily%20Blunt' },
        { name: 'Josh O&apos;Connor', category: 'Cast', url: 'stremio:///search?search=Josh%20O%26apos%3BConnor' },
    ],
    videos: [],
};

describe('decodeMetaEntities', () => {
    it('decodes the cast name and its search link, and keeps what had no entity', () => {
        const decoded = decodeMetaEntities(META);
        expect(decoded.links[2]).toEqual({ name: 'Josh O\'Connor', category: 'Cast', url: 'stremio:///search?search=Josh%20O\'Connor' });
        expect(decoded.links[0]).toBe(META.links[0]);
        expect(decoded.links[1]).toBe(META.links[1]);
        expect(decoded.videos).toBe(META.videos);
        expect(decoded.name).toBe(META.name);
    });

    it('decodes the name, the description and the episodes', () => {
        const meta = {
            name: 'Tom &amp; Jerry',
            description: 'A &quot;classic&quot;',
            links: [],
            videos: [{ id: 'a:1:1', title: 'Jerry&#39;s Cousin', overview: 'Plain' }, { id: 'a:1:2', title: 'Plain' }],
        };
        const decoded = decodeMetaEntities(meta);
        expect(decoded.name).toBe('Tom & Jerry');
        expect(decoded.description).toBe('A "classic"');
        expect(decoded.links).toBe(meta.links);
        expect(decoded.videos[0].title).toBe('Jerry\'s Cousin');
        expect(decoded.videos[1]).toBe(meta.videos[1]);
    });

    it('returns the same object when nothing is escaped', () => {
        const meta = { name: 'Plain', description: 'Fast & Furious', links: [{ name: 'A', url: 'stremio:///search?search=A' }], videos: [] };
        expect(decodeMetaEntities(meta)).toBe(meta);
        expect(decodeMetaEntities(null)).toBe(null);
    });
});
