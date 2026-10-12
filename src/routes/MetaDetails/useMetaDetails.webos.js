// webOS TV 4.x build only (resolved instead of useMetaDetails.js by webos/webpack/app.js, F6.1).
// Same hook, without the streams that need the streaming server (torrents): both the streams list
// and the Live TV playback read MetaDetails#streams from here. F8.3: the HTML entities of the meta
// item decoded (decodeMetaEntities.js). F8.6: while the core has no meta yet (null or Loading), the
// streams page of a movie or an episode shows the name, logo and background of the poster that was
// opened (webos/lib/meta-preview): on the TV the core took tens of seconds to answer.

const React = require('react');
// The explicit extension resolves to the upstream hook, not to this file.
const useUpstreamMetaDetails = require('./useMetaDetails.js');
const { hideTorrentStreams } = require('./hideTorrentStreams');
const { decodeMetaEntities } = require('./decodeMetaEntities');
const { findPreview, optimisticMetaItem } = require('../../../webos/lib/meta-preview');

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
        const streams = hideTorrentStreams(metaDetails.streams);
        // The state may still be the one of the page opened before (the Load not processed yet).
        const selected = metaDetails.selected;
        const current = !selected || (selected.metaPath && selected.metaPath.id === id && selected.metaPath.type === type);
        const metaItem = optimisticMetaItem(decodeMetaItem(metaDetails.metaItem), current ? preview : null);
        return streams === metaDetails.streams && metaItem === metaDetails.metaItem ? metaDetails : { ...metaDetails, streams, metaItem };
    }, [metaDetails, preview, id, type]);
};

module.exports = useMetaDetails;
