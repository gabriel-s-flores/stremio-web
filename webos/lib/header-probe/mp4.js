// ISO BMFF (MP4/MOV) header parser. Finds the moov box (before or after mdat) and descends only
// into the boxes that describe tracks (tkhd, mdhd, hdlr, elng, stsd); the large sample tables
// are skipped by size, so a moov of several MB costs a few small Range reads.

const { u8, u16, u32, u64, fourcc, text, BitReader } = require('./bytes');
const codecs = require('./codecs');
const { ProbeError } = require('./source');

const MAX_LEAF_BOX = 1024 * 1024;
const HANDLERS = { vide: 'video', soun: 'audio', sbtl: 'subtitle', subt: 'subtitle', text: 'subtitle', clcp: 'subtitle' };
const GENERIC_HANDLER_NAME = /handler|^core media|^iso media|gpac|l-smash|bento4|mainconcept|^apple |^dash-if|^\s*$/i;
const DOVI_BOXES = ['dvcC', 'dvvC', 'dvwC'];
const DOVI_SAMPLE_ENTRIES = ['dvh1', 'dvhe', 'dva1', 'dvav', 'dav1'];

// Box header at `offset` of an in-memory buffer; `base` is the absolute offset of data[0].
const boxAt = (data, offset, base, fileEnd) => {
    if (offset + 8 > data.length) return null;
    let size = u32(data, offset);
    const type = fourcc(data, offset + 4);
    let headerSize = 8;
    if (size === 1) {
        if (offset + 16 > data.length) return null;
        size = u64(data, offset + 8);
        headerSize = 16;
    } else if (size === 0) {
        size = fileEnd === Infinity ? Infinity : fileEnd - (base + offset);
    }
    if (type === 'uuid') headerSize += 16;
    if (size < headerSize) return null;
    const start = base + offset;
    return { type, offset: start, dataOffset: start + headerSize, size, end: start + size };
};

const childBoxes = (data, start, end) => {
    const list = [];
    let position = start;
    while (position + 8 <= end) {
        const box = boxAt(data, position, 0, end);
        if (box === null || box.end > end) break;
        list.push(box);
        position = box.end;
    }
    return list;
};

const findChild = (data, start, end, type) => {
    return childBoxes(data, start, end).filter((box) => box.type === type)[0] || null;
};

const readBoxHeader = (source, offset) => source.read(offset, 32).then((data) => boxAt(data, 0, offset, source.end()));

const readBox = (source, box) => {
    if (box.size > MAX_LEAF_BOX) {
        return Promise.reject(new ProbeError('INVALID', 'box too large: ' + box.type));
    }
    return source.readExact(box.offset, box.size).then((data) => ({
        data,
        box: boxAt(data, 0, 0, data.length),
    }));
};

// Calls `visit(box)` for each child box in [start, end); a visit may return a promise.
const walkBoxes = (source, start, end, visit) => {
    if (start + 8 > end) return Promise.resolve();
    return readBoxHeader(source, start).then((box) => {
        if (box === null || box.end > end) return null;
        return Promise.resolve(visit(box)).then((stop) => {
            if (stop === true || box.end === Infinity) return null;
            return walkBoxes(source, box.end, end, visit);
        });
    });
};

// --- leaf boxes ----------------------------------------------------------------------------

const parseTkhd = (data, box) => {
    const p = box.dataOffset;
    const version = u8(data, p);
    const flags = u8(data, p + 3);
    const idOffset = version === 1 ? p + 4 + 16 : p + 4 + 8;
    const sizeOffset = version === 1 ? p + 4 + 32 + 52 : p + 4 + 20 + 52;
    return {
        id: u32(data, idOffset),
        enabled: (flags & 1) === 1,
        width: sizeOffset + 8 <= data.length ? Math.round(u32(data, sizeOffset) / 65536) : null,
        height: sizeOffset + 8 <= data.length ? Math.round(u32(data, sizeOffset + 4) / 65536) : null,
    };
};

const parseMdhd = (data, box) => {
    const p = box.dataOffset;
    const version = u8(data, p);
    const timescale = version === 1 ? u32(data, p + 20) : u32(data, p + 12);
    const duration = version === 1 ? u64(data, p + 24) : u32(data, p + 16);
    const packed = version === 1 ? u16(data, p + 32) : u16(data, p + 20);
    let language = String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60);
    if (packed < 0x400 || !/^[a-z]{3}$/.test(language) || language === 'und') language = null;
    return { language, durationSec: timescale ? duration / timescale : null };
};

const parseHdlr = (data, box) => {
    const p = box.dataOffset;
    const handler = fourcc(data, p + 8);
    let nameStart = p + 24;
    let nameLength = box.end - nameStart;
    if (nameLength > 0 && u8(data, nameStart) === nameLength - 1) {
        nameStart++;
        nameLength--;
    }
    const name = nameLength > 0 ? text(data, nameStart, nameLength).trim() : '';
    return { handler, name: GENERIC_HANDLER_NAME.test(name) ? null : name };
};

const parseColr = (data, box) => {
    const p = box.dataOffset;
    const type = fourcc(data, p);
    if ((type === 'nclx' || type === 'nclc') && box.end - p >= 10) {
        return codecs.colourInfo(u16(data, p + 4), u16(data, p + 6), u16(data, p + 8),
            type === 'nclx' && box.end - p >= 11 ? u8(data, p + 10) >> 7 : null);
    }
    return null;
};

const parseVpcC = (data, box) => {
    const p = box.dataOffset + 4;
    if (box.end - p < 8) return null;
    return {
        profile: 'Profile ' + u8(data, p),
        level: u8(data, p + 1) / 10,
        bitDepth: u8(data, p + 2) >> 4,
        colour: codecs.colourInfo(u8(data, p + 3), u8(data, p + 4), u8(data, p + 5), u8(data, p + 2) & 1),
    };
};

const parseAv1C = (data, box) => {
    const p = box.dataOffset;
    if (box.end - p < 4) return null;
    const reader = new BitReader(data, p + 1, 2);
    const profile = reader.bits(3);
    reader.skip(5 + 1);
    const highBitDepth = reader.bit();
    const twelveBit = reader.bit();
    return {
        profile: ['Main', 'High', 'Professional'][profile] || null,
        level: null,
        bitDepth: highBitDepth ? (twelveBit && profile === 2 ? 12 : 10) : 8,
        colour: null,
    };
};

const originalFormat = (data, entry, childStart) => {
    const sinf = findChild(data, childStart, entry.end, 'sinf');
    if (sinf === null) return null;
    const frma = findChild(data, sinf.dataOffset, sinf.end, 'frma');
    return frma === null ? null : fourcc(data, frma.dataOffset);
};

const parseVideoEntry = (data, entry) => {
    const childStart = entry.dataOffset + 78;
    let format = entry.type;
    if (format === 'encv') format = originalFormat(data, entry, childStart) || format;
    const video = {
        width: u16(data, entry.dataOffset + 24),
        height: u16(data, entry.dataOffset + 26),
        profile: null,
        level: null,
        bitDepth: null,
        colour: null,
        maxCll: null,
        maxFall: null,
        hdr: null,
        dolbyVision: null,
    };
    let containerColour = null;
    childBoxes(data, childStart, entry.end).forEach((child) => {
        let config = null;
        if (child.type === 'hvcC') config = codecs.parseHvcC(data, child.dataOffset, child.end - child.dataOffset);
        else if (child.type === 'avcC') config = codecs.parseAvcC(data, child.dataOffset, child.end - child.dataOffset);
        else if (child.type === 'vpcC') config = parseVpcC(data, child);
        else if (child.type === 'av1C') config = parseAv1C(data, child);
        else if (child.type === 'colr') containerColour = parseColr(data, child) || containerColour;
        else if (child.type === 'clli' && child.end - child.dataOffset >= 4) {
            video.maxCll = u16(data, child.dataOffset);
            video.maxFall = u16(data, child.dataOffset + 2);
        } else if (DOVI_BOXES.indexOf(child.type) !== -1 && video.dolbyVision === null) {
            video.dolbyVision = codecs.parseDoviConfig(data, child.dataOffset, child.end - child.dataOffset);
        }
        if (config !== null) {
            video.profile = config.profile;
            video.level = config.level;
            video.bitDepth = config.bitDepth;
            if (config.colour) video.colour = config.colour;
        }
    });
    if (containerColour !== null && (containerColour.transfer !== null || video.colour === null)) {
        video.colour = containerColour;
    }
    if (video.dolbyVision === null && DOVI_SAMPLE_ENTRIES.indexOf(format) !== -1) {
        video.dolbyVision = { profile: null, profileName: null, level: null, compatibilityId: null, baseLayer: null,
            rpuPresent: null, elPresent: null, blPresent: null, version: null, source: 'sample-entry' };
    }
    return { format, video };
};

const parseAudioEntry = (data, entry) => {
    const p = entry.dataOffset;
    const version = u16(data, p + 8);
    let childStart = p + 28;
    let channels = u16(data, p + 16);
    let sampleRate = u32(data, p + 24) / 65536;
    if (version === 1) childStart = p + 44;
    if (version === 2) {
        childStart = p + 64;
        channels = u32(data, p + 40);
        sampleRate = null;
    }
    let format = entry.type;
    if (format === 'enca') format = originalFormat(data, entry, childStart) || format;
    // TrueHD in ISO BMFF stores the full sampling rate as a 32-bit integer.
    if (format === 'mlpa') sampleRate = u32(data, p + 24);
    const audio = { channels: channels || null, sampleRate: sampleRate || null, bitDepth: null, profile: null, atmos: null };
    let codecOverride = null;
    // QuickTime sound entries keep the codec boxes (esds…) inside a 'wave' box.
    const audioChildren = [];
    childBoxes(data, childStart, entry.end).forEach((child) => {
        if (child.type === 'wave') audioChildren.push.apply(audioChildren, childBoxes(data, child.dataOffset, child.end));
        else audioChildren.push(child);
    });
    audioChildren.forEach((child) => {
        const length = child.end - child.dataOffset;
        if (child.type === 'dec3') {
            const dec3 = codecs.parseDec3(data, child.dataOffset, length);
            if (dec3 !== null) {
                audio.channels = dec3.channels;
                audio.atmos = dec3.atmos;
                audio.profile = dec3.atmos ? 'E-AC-3 JOC' : null;
                if (dec3.atmos && dec3.complexityIndex !== null) audio.complexityIndex = dec3.complexityIndex;
            }
        } else if (child.type === 'dac3') {
            const dac3 = codecs.parseDac3(data, child.dataOffset, length);
            if (dac3 !== null) {
                audio.channels = dac3.channels;
                audio.atmos = false;
            }
        } else if (child.type === 'dmlp' && length >= 4) {
            const info = codecs.parseTrueHdFormatInfo(data, child.dataOffset);
            if (info.channels) audio.channels = info.channels;
            if (info.sampleRate) audio.sampleRate = info.sampleRate;
        } else if (child.type === 'esds') {
            const esds = codecs.parseEsds(data, child.dataOffset + 4, length - 4);
            if (esds !== null) {
                codecOverride = esds.codec;
                if (esds.channels) audio.channels = esds.channels;
                if (esds.sampleRate) audio.sampleRate = esds.sampleRate;
                audio.profile = esds.profile;
            }
        }
    });
    if (codecs.MP4_DTS_PROFILES[format]) {
        audio.profile = codecs.MP4_DTS_PROFILES[format];
        audio.atmos = false;
    }
    if (format === 'mlpa') audio.atmos = null;
    return { format, audio, codecOverride };
};

const parseStsd = (data, box, handlerType) => {
    const entry = boxAt(data, box.dataOffset + 8, 0, box.end);
    if (entry === null) return null;
    const result = { format: entry.type, codecOverride: null };
    if (handlerType === 'video') {
        const parsed = parseVideoEntry(data, entry);
        result.format = parsed.format;
        result.video = parsed.video;
    } else if (handlerType === 'audio') {
        const parsed = parseAudioEntry(data, entry);
        result.format = parsed.format;
        result.audio = parsed.audio;
        result.codecOverride = parsed.codecOverride;
    }
    return result;
};

// --- tracks --------------------------------------------------------------------------------

// Audio whose Atmos flag or DTS flavour is only in the bitstream: the first sample is read.
const needsFirstSample = (codec, audio) => codec === 'truehd' || (codec === 'dts' && audio.profile === null) ||
    (codec === 'eac3' && audio.atmos === null);

const codecOf = (stsd) => (stsd.codecOverride ? stsd.codecOverride : (codecs.MP4_CODECS[stsd.format] || 'unknown'));

const parseTrak = (source, trak, options, warnings) => {
    const found = {};
    const leaf = (box) => readBox(source, box).then((result) => {
        found[box.type] = result;
    });
    const sniff = options.sniffFrames !== false;
    // After stsd, keep walking stbl (headers only) up to the chunk offsets when the first sample is needed.
    const visitStbl = (box) => {
        if (box.type === 'stsd') {
            return leaf(box).then(() => {
                if (!sniff || !found.hdlr || HANDLERS[parseHdlr(found.hdlr.data, found.hdlr.box).handler] !== 'audio') return true;
                const stsd = parseStsd(found.stsd.data, found.stsd.box, 'audio');
                return !(stsd !== null && stsd.audio && needsFirstSample(codecOf(stsd), stsd.audio));
            });
        }
        if (box.type === 'stco' || box.type === 'co64') {
            found.chunkOffsets = box;
            return true;
        }
        return null;
    };
    const visitMinf = (box) => (box.type === 'stbl' ? walkBoxes(source, box.dataOffset, box.end, visitStbl).then(() => true) : null);
    const visitMdia = (box) => {
        if (box.type === 'mdhd' || box.type === 'hdlr' || box.type === 'elng') return leaf(box);
        if (box.type === 'minf') return walkBoxes(source, box.dataOffset, box.end, visitMinf);
        return null;
    };
    const visitTrak = (box) => {
        if (box.type === 'tkhd') return leaf(box);
        if (box.type === 'mdia') return walkBoxes(source, box.dataOffset, box.end, visitMdia);
        return null;
    };
    return walkBoxes(source, trak.dataOffset, trak.end, visitTrak).then(() => {
        if (!found.tkhd || !found.hdlr) return null;
        const tkhd = parseTkhd(found.tkhd.data, found.tkhd.box);
        const hdlr = parseHdlr(found.hdlr.data, found.hdlr.box);
        const mdhd = found.mdhd ? parseMdhd(found.mdhd.data, found.mdhd.box) : { language: null, durationSec: null };
        const type = HANDLERS[hdlr.handler] || 'other';
        const stsd = found.stsd ? parseStsd(found.stsd.data, found.stsd.box, type) : null;
        const format = stsd !== null ? stsd.format : null;
        const codec = stsd !== null ? codecOf(stsd) : 'unknown';
        const track = {
            id: tkhd.id,
            type,
            codec,
            codecId: format,
            language: mdhd.language,
            languageBcp47: found.elng ? text(found.elng.data, found.elng.box.dataOffset + 4, found.elng.box.end - found.elng.box.dataOffset - 4) || null : null,
            name: hdlr.name,
            default: tkhd.enabled,
            forced: false,
            enabled: tkhd.enabled,
            hearingImpaired: false,
            visualImpaired: false,
            commentary: false,
            original: null,
            durationSec: mdhd.durationSec,
        };
        if (type === 'video') {
            track.video = stsd !== null && stsd.video ? stsd.video : null;
            if (track.video !== null && (!track.video.width || !track.video.height)) {
                track.video.width = tkhd.width;
                track.video.height = tkhd.height;
            }
        } else if (type === 'audio') {
            track.audio = stsd !== null && stsd.audio ? stsd.audio : null;
        } else if (type === 'subtitle') {
            track.subtitle = { text: codecs.BITMAP_SUBTITLES.indexOf(codec) === -1 };
        }
        if (!sniff || !track.audio || !needsFirstSample(track.codec, track.audio)) return track;
        let failed = false;
        // Fragmented files have empty chunk tables: their samples are in the moof/mdat pairs.
        const attempt = found.chunkOffsets ? sniffFirstSample(source, found.chunkOffsets, track) : Promise.resolve();
        return attempt.catch((error) => {
            if (!(error instanceof ProbeError)) throw error;
            failed = true;
            warnings.push({ code: 'READ_LIMIT', track: track.id, message: 'first sample not read: ' + error.message });
        }).then(() => {
            const unresolved = track.codec === 'truehd' ? track.audio.atmos === null : needsFirstSample(track.codec, track.audio);
            if (unresolved && !failed) {
                warnings.push({ code: 'FRAME_NOT_FOUND', track: track.id, message: 'first sample not found or not recognised (' + track.codec + ')' });
            }
            return track;
        });
    });
};

const sniffFirstSample = (source, chunkOffsets, track) => {
    const wide = chunkOffsets.type === 'co64';
    return source.readExact(chunkOffsets.dataOffset, 8 + (wide ? 8 : 4)).then((table) => {
        if (u32(table, 4) === 0) return null;
        const offset = wide ? u64(table, 8) : u32(table, 8);
        return source.read(offset, codecs.SNIFF_BYTES[track.codec] || 512).then((frame) => {
            codecs.applyFrameSniff(track, frame);
        });
    });
};

const parseMvhd = (data, box) => {
    const p = box.dataOffset;
    const version = u8(data, p);
    const timescale = version === 1 ? u32(data, p + 20) : u32(data, p + 12);
    const duration = version === 1 ? u64(data, p + 24) : u32(data, p + 16);
    return timescale ? Math.round(duration / timescale * 1000) / 1000 : null;
};

// --- top level -----------------------------------------------------------------------------

const probeMp4 = (source, options) => {
    const warnings = [];
    const state = { brand: null, moov: null, moovAtStart: null, fragmented: false, sawMdat: false };

    const findMoov = (offset) => readBoxHeader(source, offset).then((box) => {
        if (box === null) return null;
        if (box.type === 'ftyp') {
            return source.readExact(box.dataOffset, 4).then((brand) => {
                state.brand = fourcc(brand, 0);
                return findMoov(box.end);
            });
        }
        if (box.type === 'moov') {
            state.moov = box;
            state.moovAtStart = !state.sawMdat;
            return null;
        }
        if (box.type === 'mdat') state.sawMdat = true;
        if (box.type === 'moof') state.fragmented = true;
        if (box.end === Infinity) return null;
        return findMoov(box.end);
    });

    return findMoov(0).then(() => {
        if (state.moov === null) {
            throw new ProbeError('NO_TRACKS', 'moov box not found');
        }
        const traks = [];
        let durationSec = null;
        return walkBoxes(source, state.moov.dataOffset, state.moov.end, (box) => {
            if (box.type === 'trak') traks.push(box);
            if (box.type === 'mvex') state.fragmented = true;
            if (box.type === 'mvhd') {
                return readBox(source, box).then((result) => {
                    durationSec = parseMvhd(result.data, result.box);
                });
            }
            return null;
        }).then(() => traks.reduce((chain, trak) => chain.then((tracks) => parseTrak(source, trak, options, warnings).then((track) => {
            if (track !== null) tracks.push(track);
            return tracks;
        })), Promise.resolve([]))).then((tracks) => ({
            container: 'mp4',
            brand: state.brand,
            durationSec: durationSec || null,
            moovAtStart: state.moovAtStart,
            fragmented: state.fragmented,
            seekIndex: !state.fragmented || null,
            tracks: tracks.map((track) => {
                const result = Object.assign({}, track);
                delete result.durationSec;
                return result;
            }),
            warnings,
        }));
    });
};

const MP4_TOP_LEVEL = ['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pdin', 'sidx', 'moof'];

const isMp4 = (head) => head.length >= 8 && MP4_TOP_LEVEL.indexOf(fourcc(head, 4)) !== -1;

module.exports = {
    probeMp4,
    isMp4,
};
