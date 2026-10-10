// webOS TV 4.x build only (resolved instead of StreamsList.js by webos/webpack/app.js, F6.2).
// The upstream list, ordered by what the LG C8 plays and with the C8 labels on each stream
// (useC8Ranking.js). The upstream render runs as is; only its array of stream items is reordered
// and given a `c8` prop, which Stream.webos.js shows.

// The explicit extension resolves to the upstream component, not to this file.
const UpstreamStreamsList = require('./StreamsList.js');
const Stream = require('./Stream');
const useC8Ranking = require('./useC8Ranking');

const isStreamItem = (element) => element.type === Stream;

const StreamsList = (props) => {
    const element = UpstreamStreamsList(props);
    const applyC8Ranking = useC8Ranking(props.streams, props.video, isStreamItem);
    return applyC8Ranking(element);
};

StreamsList.propTypes = UpstreamStreamsList.propTypes;

module.exports = StreamsList;
