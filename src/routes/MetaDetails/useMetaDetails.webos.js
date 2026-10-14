// webOS TV 4.x build only (resolved instead of useMetaDetails.js by webos/webpack/app.js, F6.1).
// Same hook, without the streams that need the streaming server (torrents): both the streams list
// and the Live TV playback read MetaDetails#streams from here. F8.3: the HTML entities of the meta
// item decoded (decodeMetaEntities.js). F8.6: while the core loads the meta (Loading) of the item of
// this route, the streams page of a movie or an episode shows the name, logo and background of the
// poster that was opened (webos/lib/meta-preview): on the TV the core took tens of seconds to answer.
// A null meta item (no addon for this meta) keeps the upstream message.
// F8.7: the core leaves `deepLinks.player` out of the streams of the list (webos/core/list-links.patch);
// webos/lib/player-link builds the same link when a stream item reads it (only the ones on screen).

const React = require('react');
// The explicit extension resolves to the upstream hook, not to this file.
const useUpstreamMetaDetails = require('./useMetaDetails.js');
const { hideTorrentStreams } = require('./hideTorrentStreams');
const { decodeMetaEntities } = require('./decodeMetaEntities');
const { findPreview, optimisticMetaItem } = require('../../../webos/lib/meta-preview');
const { withPlayerLinks, linkContext } = require('../../../webos/lib/player-link');

const decodeMetaItem = (metaItem) => {
    if (metaItem === null || metaItem.content.type !== 'Ready') return metaItem;
    const content = decodeMetaEntities(metaItem.content.content);
    return content === metaItem.content.content ? metaItem : { ...metaItem, content: { ...metaItem.content, content } };
};

const useMetaDetails = (urlParams) => {
    const metaDetails = useUpstreamMetaDetails(urlParams);
    const { type, id, videoId } = urlParams || {};
    // Only the streams page (a video in the path): the episodes list of a series has nothing to show
    // without the meta. Not Live TV (its own page).
    const preview = React.useMemo(() => (
        typeof document !== 'undefined' && type !== 'tv' && typeof videoId === 'string' && videoId !== '' ?
            findPreview(document, type, id)
            :
            null
    ), [type, id, videoId]);
    return React.useMemo(() => {
        // The link's meta addon is the real meta's (before the preview takes its place).
        const streams = withPlayerLinks(hideTorrentStreams(metaDetails.streams), linkContext(metaDetails));
        // Only the Loading of this route's item (not a state left by another page).
        const selected = metaDetails.selected;
        const current = !!selected && !!selected.metaPath && selected.metaPath.id === id && selected.metaPath.type === type;
        const metaItem = optimisticMetaItem(decodeMetaItem(metaDetails.metaItem), current ? preview : null);
        return streams === metaDetails.streams && metaItem === metaDetails.metaItem ? metaDetails : { ...metaDetails, streams, metaItem };
    }, [metaDetails, preview, id, type]);
};

module.exports = useMetaDetails;
