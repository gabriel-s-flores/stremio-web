// Streams that only play through the streaming server (F6.1, plan D4/P3): torrents (infoHash) and
// the archive and Usenet sources, which the server unpacks. Used by useMetaDetails.webos.js.

const SERVER_ONLY_FIELDS = ['infoHash', 'nzbUrl', 'rarUrls', 'zipUrls', '7zipUrls', 'tgzUrls', 'tarUrls'];

const needsStreamingServer = (stream) => {
    return stream !== null && typeof stream === 'object' && SERVER_ONLY_FIELDS.some((field) => {
        const value = stream[field];
        return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value !== '';
    });
};

// `streams` is MetaDetails#streams: one entry per addon, { addon, content: Loading | Err | Ready }.
// An addon whose Ready list had only server streams becomes an Err (it has nothing to show, and
// when every addon is Err the list says "no streams" instead of waiting on placeholders forever).
// Returns the same array when nothing was hidden.
const hideTorrentStreams = (streams) => {
    if (!Array.isArray(streams)) {
        return streams;
    }

    let changed = false;
    const result = streams.map((entry) => {
        if (entry?.content?.type !== 'Ready' || !Array.isArray(entry.content.content)) {
            return entry;
        }

        const playable = entry.content.content.filter((stream) => !needsStreamingServer(stream));
        if (playable.length === entry.content.content.length) {
            return entry;
        }

        changed = true;
        return {
            ...entry,
            content: playable.length === 0 ?
                { type: 'Err', content: { type: 'Other', content: { code: 0, message: 'Only streams that need the streaming server' } } }
                :
                { ...entry.content, content: playable },
        };
    });

    return changed ? result : streams;
};

module.exports = { needsStreamingServer, hideTorrentStreams };
