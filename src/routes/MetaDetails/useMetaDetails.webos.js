// webOS TV 4.x build only (resolved instead of useMetaDetails.js by webos/webpack/app.js, F6.1).
// Same hook, without the streams that need the streaming server (torrents): both the streams list
// and the Live TV playback read MetaDetails#streams from here. F8.3: the HTML entities of the meta
// item decoded (decodeMetaEntities.js).

const React = require('react');
// The explicit extension resolves to the upstream hook, not to this file.
const useUpstreamMetaDetails = require('./useMetaDetails.js');
const { hideTorrentStreams } = require('./hideTorrentStreams');
const { decodeMetaEntities } = require('./decodeMetaEntities');

const decodeMetaItem = (metaItem) => {
    if (metaItem === null || metaItem.content.type !== 'Ready') return metaItem;
    const content = decodeMetaEntities(metaItem.content.content);
    return content === metaItem.content.content ? metaItem : { ...metaItem, content: { ...metaItem.content, content } };
};

const useMetaDetails = (urlParams) => {
    const metaDetails = useUpstreamMetaDetails(urlParams);
    return React.useMemo(() => {
        const streams = hideTorrentStreams(metaDetails.streams);
        const metaItem = decodeMetaItem(metaDetails.metaItem);
        return streams === metaDetails.streams && metaItem === metaDetails.metaItem ? metaDetails : { ...metaDetails, streams, metaItem };
    }, [metaDetails]);
};

module.exports = useMetaDetails;
