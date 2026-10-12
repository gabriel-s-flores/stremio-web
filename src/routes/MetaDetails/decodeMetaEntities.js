// HTML entities in the metadata of the details page (F8.3): Cinemeta sends some names escaped
// ("Josh O&apos;Connor" in the cast of tt15047880, also in the search link of that name), and the
// page showed them as they came. Used by useMetaDetails.webos.js on the ready meta item: its name,
// description, links (names and URLs) and the titles and overviews of its videos.

const { decodeEntities, decodeUrlEntities } = require('../../../webos/lib/tv-text');

const decodeLink = (link) => {
    if (link === null || typeof link !== 'object') return link;
    const name = decodeEntities(link.name);
    const url = decodeUrlEntities(link.url);
    return name === link.name && url === link.url ? link : { ...link, name, url };
};

const decodeVideo = (video) => {
    if (video === null || typeof video !== 'object') return video;
    const title = decodeEntities(video.title);
    const overview = decodeEntities(video.overview);
    return title === video.title && overview === video.overview ? video : { ...video, title, overview };
};

// The same array when no element changed.
const mapArray = (array, decode) => {
    if (!Array.isArray(array)) return array;
    const next = array.map(decode);
    return next.some((element, index) => element !== array[index]) ? next : array;
};

// `meta` is the content of a Ready meta item. Returns the same object when nothing was escaped.
const decodeMetaEntities = (meta) => {
    if (meta === null || typeof meta !== 'object') return meta;
    const name = decodeEntities(meta.name);
    const description = decodeEntities(meta.description);
    const links = mapArray(meta.links, decodeLink);
    const videos = mapArray(meta.videos, decodeVideo);
    return name === meta.name && description === meta.description && links === meta.links && videos === meta.videos ?
        meta
        :
        { ...meta, name, description, links, videos };
};

module.exports = { decodeMetaEntities };
