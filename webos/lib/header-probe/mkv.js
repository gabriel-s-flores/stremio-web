// Matroska / WebM header parser. Walks the top-level Segment children with small Range reads
// (SeekHead, Info, Tracks), skipping everything else by size, and optionally reads the first
// frame of E-AC-3, TrueHD and DTS tracks to detect Atmos and the DTS flavour.

const { u8, uint, float, text } = require('./bytes');
const codecs = require('./codecs');
const { ProbeError } = require('./source');

const ID = {
    EBML: 0x1a45dfa3,
    DocType: 0x4282,
    Segment: 0x18538067,
    SeekHead: 0x114d9b74,
    Seek: 0x4dbb,
    SeekID: 0x53ab,
    SeekPosition: 0x53ac,
    Info: 0x1549a966,
    TimestampScale: 0x2ad7b1,
    Duration: 0x4489,
    Title: 0x7ba9,
    MuxingApp: 0x4d80,
    WritingApp: 0x5741,
    Tracks: 0x1654ae6b,
    TrackEntry: 0xae,
    TrackNumber: 0xd7,
    TrackType: 0x83,
    FlagEnabled: 0xb9,
    FlagDefault: 0x88,
    FlagForced: 0x55aa,
    FlagHearingImpaired: 0x55ab,
    FlagVisualImpaired: 0x55ac,
    FlagOriginal: 0x55ae,
    FlagCommentary: 0x55af,
    Name: 0x536e,
    Language: 0x22b59c,
    LanguageBCP47: 0x22b59d,
    CodecID: 0x86,
    CodecPrivate: 0x63a2,
    DefaultDuration: 0x23e383,
    Video: 0xe0,
    PixelWidth: 0xb0,
    PixelHeight: 0xba,
    Colour: 0x55b0,
    MatrixCoefficients: 0x55b1,
    BitsPerChannel: 0x55b2,
    Range: 0x55b9,
    TransferCharacteristics: 0x55ba,
    Primaries: 0x55bb,
    MaxCLL: 0x55bc,
    MaxFALL: 0x55bd,
    Audio: 0xe1,
    SamplingFrequency: 0xb5,
    Channels: 0x9f,
    BitDepth: 0x6264,
    BlockAdditionMapping: 0x41e4,
    BlockAddIDType: 0x41e7,
    BlockAddIDExtraData: 0x41ed,
    ContentEncodings: 0x6d80,
    ContentEncoding: 0x6240,
    ContentEncodingType: 0x5033,
    ContentCompression: 0x5034,
    ContentCompAlgo: 0x4254,
    ContentCompSettings: 0x4255,
    Cluster: 0x1f43b675,
    SimpleBlock: 0xa3,
    BlockGroup: 0xa0,
    Block: 0xa1,
    Cues: 0x1c53bb6b,
};

const TRACK_TYPES = { 1: 'video', 2: 'audio', 17: 'subtitle' };
const DOVI_BLOCK_ADD_TYPES = [0x64766343, 0x64767643, 0x64767743];
const SNIFF_CODECS = ['eac3', 'truehd', 'dts'];
const MAX_HEADER_ELEMENT = 4 * 1024 * 1024;

// Variable-size integer. `keepMarker` for element IDs; sizes drop the length marker and report
// all-ones values as unknown (null).
const readVint = (data, offset, keepMarker) => {
    if (offset >= data.length) return null;
    const first = data[offset];
    let length = 1;
    let mask = 0x80;
    while (length <= 8 && (first & mask) === 0) {
        length++;
        mask >>= 1;
    }
    if (length > 8 || offset + length > data.length) return null;
    let value = keepMarker ? first : first & (mask - 1);
    let allOnes = value === mask - 1;
    for (let i = 1; i < length; i++) {
        value = value * 256 + data[offset + i];
        if (data[offset + i] !== 0xff) allOnes = false;
    }
    return { value: !keepMarker && allOnes ? null : value, length };
};

// Parses the element header at `offset` of an in-memory buffer.
const elementAt = (data, offset) => {
    const id = readVint(data, offset, true);
    if (id === null) return null;
    const size = readVint(data, offset + id.length, false);
    if (size === null) return null;
    const dataOffset = offset + id.length + size.length;
    return {
        id: id.value,
        offset,
        dataOffset,
        size: size.value,
        end: size.value === null ? null : dataOffset + size.value,
    };
};

// Children of a master element held in memory.
const children = (data, start, end) => {
    const list = [];
    let position = start;
    while (position < end) {
        const element = elementAt(data, position);
        if (element === null || element.end === null || element.end > end) break;
        list.push(element);
        position = element.end;
    }
    return list;
};

const childMap = (data, start, end) => {
    const map = {};
    children(data, start, end).forEach((element) => {
        if (!map[element.id]) map[element.id] = [];
        map[element.id].push(element);
    });
    return map;
};

const uintOf = (data, map, id, fallback) => {
    const element = map[id] && map[id][0];
    return element ? uint(data, element.dataOffset, element.size) : fallback;
};

const floatOf = (data, map, id, fallback) => {
    const element = map[id] && map[id][0];
    return element ? float(data, element.dataOffset, element.size) : fallback;
};

const textOf = (data, map, id, fallback) => {
    const element = map[id] && map[id][0];
    return element ? text(data, element.dataOffset, element.size) : fallback;
};

const bytesOf = (data, map, id) => {
    const element = map[id] && map[id][0];
    return element ? data.subarray(element.dataOffset, element.end) : null;
};

const parseSeekHead = (data, element, segmentStart) => {
    const seeks = [];
    children(data, element.dataOffset, element.end).forEach((seek) => {
        if (seek.id !== ID.Seek) return;
        const map = childMap(data, seek.dataOffset, seek.end);
        const idBytes = bytesOf(data, map, ID.SeekID);
        const position = uintOf(data, map, ID.SeekPosition, null);
        if (idBytes !== null && position !== null) {
            seeks.push({ id: uint(idBytes, 0, idBytes.length), offset: segmentStart + position });
        }
    });
    return seeks;
};

const parseInfo = (data, element) => {
    const map = childMap(data, element.dataOffset, element.end);
    const scale = uintOf(data, map, ID.TimestampScale, 1000000);
    const duration = floatOf(data, map, ID.Duration, null);
    return {
        durationSec: duration === null ? null : Math.round(duration * scale / 1e6) / 1e3,
        title: textOf(data, map, ID.Title, null),
        muxingApp: textOf(data, map, ID.MuxingApp, null),
        writingApp: textOf(data, map, ID.WritingApp, null),
    };
};

const languageOf = (value) => (value === null || value === 'und' ? null : value);

const parseVideo = (data, map, codec, codecPrivate) => {
    const video = {
        width: null,
        height: null,
        profile: null,
        level: null,
        bitDepth: null,
        colour: null,
        maxCll: null,
        maxFall: null,
        hdr: null,
        dolbyVision: null,
    };
    const videoElement = map[ID.Video] && map[ID.Video][0];
    if (videoElement) {
        const videoMap = childMap(data, videoElement.dataOffset, videoElement.end);
        video.width = uintOf(data, videoMap, ID.PixelWidth, null);
        video.height = uintOf(data, videoMap, ID.PixelHeight, null);
        const colourElement = videoMap[ID.Colour] && videoMap[ID.Colour][0];
        if (colourElement) {
            const colourMap = childMap(data, colourElement.dataOffset, colourElement.end);
            const range = uintOf(data, colourMap, ID.Range, null);
            video.colour = codecs.colourInfo(
                uintOf(data, colourMap, ID.Primaries, null),
                uintOf(data, colourMap, ID.TransferCharacteristics, null),
                uintOf(data, colourMap, ID.MatrixCoefficients, null),
                range === 1 ? 0 : range === 2 ? 1 : null
            );
            video.bitDepth = uintOf(data, colourMap, ID.BitsPerChannel, null) || null;
            video.maxCll = uintOf(data, colourMap, ID.MaxCLL, null);
            video.maxFall = uintOf(data, colourMap, ID.MaxFALL, null);
        }
    }
    let config = null;
    if (codecPrivate !== null && codec === 'hevc') config = codecs.parseHvcC(codecPrivate, 0, codecPrivate.length);
    if (codecPrivate !== null && codec === 'avc') config = codecs.parseAvcC(codecPrivate, 0, codecPrivate.length);
    if (config !== null) {
        video.profile = config.profile;
        video.level = config.level;
        if (video.bitDepth === null) video.bitDepth = config.bitDepth;
        if (config.colour && (video.colour === null || video.colour.transfer === null)) {
            video.colour = config.colour;
        }
    }
    (map[ID.BlockAdditionMapping] || []).forEach((mapping) => {
        const mappingMap = childMap(data, mapping.dataOffset, mapping.end);
        const type = uintOf(data, mappingMap, ID.BlockAddIDType, 0);
        const extra = bytesOf(data, mappingMap, ID.BlockAddIDExtraData);
        if (DOVI_BLOCK_ADD_TYPES.indexOf(type) !== -1 && extra !== null && video.dolbyVision === null) {
            video.dolbyVision = codecs.parseDoviConfig(extra, 0, extra.length);
        }
    });
    return video;
};

const parseAudio = (data, map) => {
    const audio = { channels: null, sampleRate: null, bitDepth: null, profile: null, atmos: null };
    const audioElement = map[ID.Audio] && map[ID.Audio][0];
    if (audioElement) {
        const audioMap = childMap(data, audioElement.dataOffset, audioElement.end);
        audio.channels = uintOf(data, audioMap, ID.Channels, 1);
        audio.sampleRate = floatOf(data, audioMap, ID.SamplingFrequency, 8000);
        audio.bitDepth = uintOf(data, audioMap, ID.BitDepth, null);
    }
    return audio;
};

// Header stripping (ContentCompAlgo 3) removes the first bytes of every frame; they are needed
// back to find the sync words. Other compressions make the frames unreadable here.
const parseContentEncoding = (data, map) => {
    const encodings = map[ID.ContentEncodings] && map[ID.ContentEncodings][0];
    if (!encodings) return { strippedHeader: null, readable: true };
    let strippedHeader = null;
    let readable = true;
    children(data, encodings.dataOffset, encodings.end).forEach((encoding) => {
        if (encoding.id !== ID.ContentEncoding) return;
        const encodingMap = childMap(data, encoding.dataOffset, encoding.end);
        if (uintOf(data, encodingMap, ID.ContentEncodingType, 0) !== 0) {
            readable = false;
            return;
        }
        const compression = encodingMap[ID.ContentCompression] && encodingMap[ID.ContentCompression][0];
        if (!compression) return;
        const compressionMap = childMap(data, compression.dataOffset, compression.end);
        const algo = uintOf(data, compressionMap, ID.ContentCompAlgo, 0);
        if (algo === 3) {
            strippedHeader = bytesOf(data, compressionMap, ID.ContentCompSettings);
        } else {
            readable = false;
        }
    });
    return { strippedHeader, readable };
};

const parseTrackEntry = (data, element) => {
    const map = childMap(data, element.dataOffset, element.end);
    const codecId = textOf(data, map, ID.CodecID, null);
    const codec = codecs.mkvCodec(codecId);
    const typeCode = uintOf(data, map, ID.TrackType, null);
    const type = TRACK_TYPES[typeCode] || 'other';
    const language = textOf(data, map, ID.Language, 'eng');
    const track = {
        id: uintOf(data, map, ID.TrackNumber, null),
        type,
        codec,
        codecId,
        language: languageOf(language),
        languageBcp47: textOf(data, map, ID.LanguageBCP47, null),
        name: textOf(data, map, ID.Name, null),
        default: uintOf(data, map, ID.FlagDefault, 1) === 1,
        forced: uintOf(data, map, ID.FlagForced, 0) === 1,
        enabled: uintOf(data, map, ID.FlagEnabled, 1) === 1,
        hearingImpaired: uintOf(data, map, ID.FlagHearingImpaired, 0) === 1,
        visualImpaired: uintOf(data, map, ID.FlagVisualImpaired, 0) === 1,
        commentary: uintOf(data, map, ID.FlagCommentary, 0) === 1,
        original: map[ID.FlagOriginal] ? uintOf(data, map, ID.FlagOriginal, 0) === 1 : null,
    };
    const codecPrivate = bytesOf(data, map, ID.CodecPrivate);
    if (type === 'video') {
        track.video = parseVideo(data, map, codec, codecPrivate);
    } else if (type === 'audio') {
        track.audio = parseAudio(data, map);
        if (codec === 'aac' && codecPrivate !== null) {
            const asc = codecs.parseAudioSpecificConfig(codecPrivate, 0, codecPrivate.length);
            if (asc !== null) track.audio.profile = asc.profile;
        }
        if (codec === 'dts') {
            track.audio.profile = codecId === 'A_DTS/LOSSLESS' ? 'DTS-HD MA' : codecId === 'A_DTS/EXPRESS' ? 'DTS Express' : null;
        }
    } else if (type === 'subtitle') {
        track.subtitle = { text: codecs.BITMAP_SUBTITLES.indexOf(codec) === -1 };
    }
    track.encoding = parseContentEncoding(data, map);
    return track;
};

const parseTracks = (data, element) => children(data, element.dataOffset, element.end)
    .filter((entry) => entry.id === ID.TrackEntry)
    .map((entry) => parseTrackEntry(data, entry));

// Reads the element header at `offset` from the source.
const readElementHeader = (source, offset) => source.read(offset, 12).then((data) => {
    const element = elementAt(data, 0);
    if (element === null) return null;
    return {
        id: element.id,
        offset,
        dataOffset: offset + element.dataOffset,
        size: element.size,
        end: element.size === null ? null : offset + element.end,
    };
});

const readElement = (source, element) => {
    if (element.size > MAX_HEADER_ELEMENT) {
        return Promise.reject(new ProbeError('INVALID', 'element too large: 0x' + element.id.toString(16)));
    }
    return source.readExact(element.offset, element.end - element.offset).then((data) => ({
        data,
        element: elementAt(data, 0),
    }));
};

// --- frame sniffing ------------------------------------------------------------------------

// Offset of the first frame inside a (Simple)Block payload, after the lacing header.
const firstFrameOffset = (data, start, flags) => {
    const lacing = (flags >> 1) & 3;
    if (lacing === 0) return start;
    const frames = data[start] + 1;
    let position = start + 1;
    if (lacing === 1) {
        for (let i = 0; i < frames - 1; i++) {
            while (data[position] === 0xff) position++;
            position++;
        }
        return position;
    }
    if (lacing === 3) {
        for (let i = 0; i < frames - 1; i++) {
            const size = readVint(data, position, false);
            if (size === null) return -1;
            position += size.length;
        }
        return position;
    }
    return position;
};

const sniffFrames = (source, clusterOffset, tracks, options, warnings) => {
    const pending = {};
    tracks.forEach((track) => {
        if (track.type === 'audio' && SNIFF_CODECS.indexOf(track.codec) !== -1 && track.encoding.readable) {
            pending[track.id] = track;
        }
    });
    let remaining = Object.keys(pending).length;
    if (remaining === 0) return Promise.resolve();
    let blocks = 0;
    let clusters = 0;
    const maxBlocks = options.sniffMaxBlocks || 256;
    const maxClusters = options.sniffMaxClusters || 2;

    const inspectBlock = (blockOffset, blockEnd) => source.read(blockOffset, 12).then((head) => {
        const trackNumber = readVint(head, 0, false);
        if (trackNumber === null) return null;
        const track = pending[trackNumber.value];
        if (!track) return null;
        const flags = head[trackNumber.length + 2];
        const payloadStart = blockOffset + trackNumber.length + 3;
        return source.read(payloadStart, Math.min(codecs.SNIFF_BYTES[track.codec] + 1024, blockEnd - payloadStart)).then((payload) => {
            const frameOffset = firstFrameOffset(payload, 0, flags);
            if (frameOffset < 0) return null;
            let frame = payload.subarray(frameOffset);
            const stripped = track.encoding.strippedHeader;
            if (stripped !== null) {
                const joined = new Uint8Array(stripped.length + frame.length);
                joined.set(stripped, 0);
                joined.set(frame, stripped.length);
                frame = joined;
            }
            if (codecs.applyFrameSniff(track, frame)) {
                delete pending[track.id];
                remaining--;
            }
            return null;
        });
    });

    const walkCluster = (offset, end) => {
        if (remaining === 0 || blocks >= maxBlocks || (end !== null && offset >= end)) return Promise.resolve(end);
        return readElementHeader(source, offset).then((element) => {
            if (element === null) return null;
            if (element.id === ID.Cluster || element.id === ID.Cues || element.id === ID.Segment) {
                return offset;
            }
            if (element.end === null) return null;
            blocks++;
            let step = Promise.resolve();
            if (element.id === ID.SimpleBlock) {
                step = inspectBlock(element.dataOffset, element.end);
            } else if (element.id === ID.BlockGroup) {
                step = readElementHeader(source, element.dataOffset).then((block) => {
                    if (block !== null && block.id === ID.Block && block.end !== null) return inspectBlock(block.dataOffset, block.end);
                    return null;
                });
            }
            return step.then(() => walkCluster(element.end, end));
        });
    };

    const walkClusters = (offset) => {
        if (remaining === 0 || clusters >= maxClusters || blocks >= maxBlocks || offset === null) return Promise.resolve();
        return readElementHeader(source, offset).then((cluster) => {
            if (cluster === null || cluster.id !== ID.Cluster) return null;
            clusters++;
            return walkCluster(cluster.dataOffset, cluster.end).then(walkClusters);
        });
    };

    return walkClusters(clusterOffset).catch((error) => {
        if (!(error instanceof ProbeError)) throw error;
        warnings.push('frame sniffing stopped: ' + error.message);
    }).then(() => {
        Object.keys(pending).forEach((id) => {
            warnings.push('no frame found for track ' + id + ' (' + pending[id].codec + ')');
        });
    });
};

// --- top level -----------------------------------------------------------------------------

const probeMkv = (source, options) => {
    const warnings = [];
    const state = {
        docType: null,
        segmentStart: null,
        seeks: null,
        info: null,
        tracks: null,
        firstCluster: null,
        hasCues: false,
    };

    const handle = (element) => {
        if (element.id === ID.SeekHead && state.seeks === null) {
            return readElement(source, element).then((result) => {
                state.seeks = parseSeekHead(result.data, result.element, state.segmentStart);
            });
        }
        if (element.id === ID.Info && state.info === null) {
            return readElement(source, element).then((result) => {
                state.info = parseInfo(result.data, result.element);
            });
        }
        if (element.id === ID.Tracks && state.tracks === null) {
            return readElement(source, element).then((result) => {
                state.tracks = parseTracks(result.data, result.element);
            });
        }
        if (element.id === ID.Cues) {
            state.hasCues = true;
        }
        return Promise.resolve();
    };

    const needSniff = () => options.sniffFrames !== false && state.tracks !== null &&
        state.tracks.some((track) => track.type === 'audio' && SNIFF_CODECS.indexOf(track.codec) !== -1);

    // Walks Segment children until the first Cluster (or until nothing else is needed).
    const walk = (offset, segmentEnd) => {
        if (segmentEnd !== null && offset >= segmentEnd) return Promise.resolve();
        if (state.tracks !== null && state.info !== null && !needSniff()) return Promise.resolve();
        return readElementHeader(source, offset).then((element) => {
            if (element === null) return null;
            if (element.id === ID.Cluster) {
                state.firstCluster = element.offset;
                return null;
            }
            if (element.end === null) return null;
            return handle(element).then(() => walk(element.end, segmentEnd));
        });
    };

    // Elements not reached by the linear walk (e.g. Tracks after the Clusters) via SeekHead.
    const fromSeekHead = () => {
        if (state.seeks === null) return Promise.resolve();
        state.seeks.forEach((seek) => {
            if (seek.id === ID.Cues) state.hasCues = true;
        });
        const missing = state.seeks.filter((seek) => (seek.id === ID.Tracks && state.tracks === null) ||
            (seek.id === ID.Info && state.info === null));
        return missing.reduce((chain, seek) => chain.then(() => readElementHeader(source, seek.offset).then((element) => {
            if (element !== null && element.id === seek.id && element.end !== null) return handle(element);
            return null;
        })), Promise.resolve());
    };

    return readElementHeader(source, 0).then((ebml) => {
        if (ebml === null || ebml.id !== ID.EBML || ebml.end === null) {
            throw new ProbeError('INVALID', 'missing EBML header');
        }
        return readElement(source, ebml).then((result) => {
            const map = childMap(result.data, result.element.dataOffset, result.element.end);
            state.docType = textOf(result.data, map, ID.DocType, 'matroska');
            return readElementHeader(source, ebml.end);
        });
    }).then((segment) => {
        if (segment === null || segment.id !== ID.Segment) {
            throw new ProbeError('INVALID', 'missing Segment');
        }
        state.segmentStart = segment.dataOffset;
        return walk(segment.dataOffset, segment.end);
    }).then(fromSeekHead).then(() => {
        if (state.tracks === null) {
            throw new ProbeError('NO_TRACKS', 'Tracks element not found');
        }
        if (needSniff() && state.firstCluster !== null) {
            return sniffFrames(source, state.firstCluster, state.tracks, options, warnings);
        }
        if (needSniff()) warnings.push('first Cluster not found; audio frames not inspected');
        return null;
    }).then(() => {
        const tracks = state.tracks.map((track) => {
            const result = Object.assign({}, track);
            delete result.encoding;
            return result;
        });
        return {
            container: state.docType === 'webm' ? 'webm' : 'mkv',
            durationSec: state.info ? state.info.durationSec : null,
            title: state.info ? state.info.title : null,
            muxer: state.info ? (state.info.writingApp || state.info.muxingApp) : null,
            seekIndex: state.hasCues ? true : (state.seeks !== null ? false : null),
            tracks,
            warnings,
        };
    });
};

const isMkv = (head) => head.length >= 4 && u8(head, 0) === 0x1a && u8(head, 1) === 0x45 && u8(head, 2) === 0xdf && u8(head, 3) === 0xa3;

module.exports = {
    probeMkv,
    isMkv,
    readVint,
    elementAt,
};
