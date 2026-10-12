// webOS TV 4.x build only (resolved instead of StreamsList.js by webos/webpack/app.js, F6.2).
// The upstream list, ordered by what the LG C8 plays and with the C8 labels on each stream
// (useC8Ranking.js). The upstream render runs as is; only its array of stream items is reordered
// and given a `c8` prop, which Stream.webos.js shows.
// F8.6: only the first streams of the ranked list are rendered, and more as the focus (or the
// scroll of the Magic Remote) gets near the end (useShownStreams.js): a Torrentio answer has 224
// streams, and rendering them all took ~4.5 s on the TV.

// The explicit extension resolves to the upstream component, not to this file.
const UpstreamStreamsList = require('./StreamsList.js');
const Stream = require('./Stream');
const useC8Ranking = require('./useC8Ranking');
const useShownStreams = require('./useShownStreams');

const isStreamItem = (element) => element.type === Stream;

const StreamsList = (props) => {
    const element = UpstreamStreamsList(props);
    const applyC8Ranking = useC8Ranking(props.streams, props.video, isStreamItem);
    const applyShown = useShownStreams(props.video, isStreamItem);
    return applyShown(applyC8Ranking(element));
};

StreamsList.propTypes = UpstreamStreamsList.propTypes;

module.exports = StreamsList;
