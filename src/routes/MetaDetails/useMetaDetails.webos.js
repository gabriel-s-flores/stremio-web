// webOS TV 4.x build only (resolved instead of useMetaDetails.js by webos/webpack/app.js, F6.1).
// Same hook, without the streams that need the streaming server (torrents): both the streams list
// and the Live TV playback read MetaDetails#streams from here.

const React = require('react');
// The explicit extension resolves to the upstream hook, not to this file.
const useUpstreamMetaDetails = require('./useMetaDetails.js');
const { hideTorrentStreams } = require('./hideTorrentStreams');

const useMetaDetails = (urlParams) => {
    const metaDetails = useUpstreamMetaDetails(urlParams);
    return React.useMemo(() => {
        const streams = hideTorrentStreams(metaDetails.streams);
        return streams === metaDetails.streams ? metaDetails : { ...metaDetails, streams };
    }, [metaDetails]);
};

module.exports = useMetaDetails;
