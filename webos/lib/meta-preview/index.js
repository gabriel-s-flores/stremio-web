// What the details page can show before the core answers (F8.6). On the TV the core worker took
// 25-47 s to answer with the meta of a film with 224 streams; meanwhile the page had only the
// placeholder (or the "no addons" message while the Load was not processed yet). The poster the
// user opened is still on the screen below the page (the Board, Discover, Search and Library stay
// mounted under it), with the name in its title: that is enough for the column's title, and, for a
// Cinemeta item (metahub images), its logo and background.
//
// findPreview(doc, type, id) -> { id, type, name, poster, logo, background } | null
// optimisticMetaItem(metaItem, preview) -> a Ready meta item with that preview (marked `optimistic`)
// while the real one is null or Loading; otherwise the meta item as is.
// The answers are remembered per item (the last MEMORY_SIZE), so a page opened again after its
// poster left the screen still has them.

'use strict';

const MEMORY_SIZE = 64;
const memory = new Map();

// The metahub images of an IMDb item: the poster URL of a Cinemeta catalog says which item it is.
const METAHUB = /^(https?:\/\/images\.metahub\.space)\/poster\/[a-z]+\/(tt\d+)\/img$/;

const pathOf = (type, id) => `#/detail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;

const findPreview = (doc, type, id) => {
    if (typeof type !== 'string' || typeof id !== 'string') return null;
    const path = pathOf(type, id);
    const links = doc.querySelectorAll('a[href^="#/detail/"]');
    for (let index = 0; index < links.length; index += 1) {
        const link = links[index];
        const href = link.getAttribute('href');
        const name = link.getAttribute('title');
        if ((href === path || href.indexOf(`${path}/`) === 0) && typeof name === 'string' && name.length > 0) {
            const image = link.querySelector('img');
            const poster = image ? image.getAttribute('src') : null;
            const metahub = typeof poster === 'string' ? METAHUB.exec(poster) : null;
            const preview = {
                id,
                type,
                name,
                poster: poster || null,
                logo: metahub && metahub[2] === id ? `${metahub[1]}/logo/medium/${id}/img` : null,
                background: metahub && metahub[2] === id ? `${metahub[1]}/background/medium/${id}/img` : null,
            };
            memory.delete(path);
            memory.set(path, preview);
            if (memory.size > MEMORY_SIZE) memory.delete(memory.keys().next().value);
            return preview;
        }
    }
    return memory.get(path) || null;
};

// The meta item of useMetaDetails (after its map: `released` is a Date, `videos` an array) with the
// preview's fields, so the upstream page renders its MetaPreview instead of the placeholder. No
// description, links or videos yet; the toggles of the column work on the preview (id, type, name,
// poster: a valid MetaItemPreview for the core).
const optimisticMetaItem = (metaItem, preview) => {
    if (preview === null || (metaItem !== null && metaItem.content.type !== 'Loading')) return metaItem;
    return {
        addon: metaItem !== null ? metaItem.addon : { transportUrl: '', manifest: { id: '', name: '', logo: null } },
        content: {
            type: 'Ready',
            content: {
                id: preview.id,
                type: preview.type,
                name: preview.name,
                poster: preview.poster,
                logo: preview.logo,
                background: preview.background,
                posterShape: 'poster',
                description: null,
                releaseInfo: null,
                runtime: null,
                released: new Date(NaN),
                links: [],
                trailerStreams: [],
                videos: [],
                behaviorHints: {},
                inLibrary: false,
                watched: false,
                deepLinks: {},
            },
        },
        optimistic: true,
    };
};

module.exports = { findPreview, optimisticMetaItem, MEMORY_SIZE };
