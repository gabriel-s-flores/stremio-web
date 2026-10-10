// Codec-level parsers shared by the MKV and MP4 parsers: Dolby Vision configuration, HEVC/AVC
// configuration and SPS colour info, AC-3/E-AC-3 (Atmos), TrueHD, DTS and AAC headers.

const { u8, u16, indexOfSequence, unescapeRbsp, BitReader } = require('./bytes');

// ---------------------------------------------------------------------------------------------
// Dolby Vision: DOVIDecoderConfigurationRecord (dvcC, dvvC, dvwC; same layout in MKV
// BlockAddIDExtraData). Dolby "Dolby Vision Streams Within the ISO Base Media File Format".

const DV_COMPATIBILITY = {
    0: 'none',
    1: 'hdr10',
    2: 'sdr',
    4: 'hlg',
    6: 'hdr10',
};

const parseDoviConfig = (data, offset, length) => {
    if (length < 5) return null;
    const versionMajor = u8(data, offset);
    const versionMinor = u8(data, offset + 1);
    const word = u16(data, offset + 2);
    const profile = word >> 9;
    const level = (word >> 3) & 0x3f;
    const rpuPresent = ((word >> 2) & 1) === 1;
    const elPresent = ((word >> 1) & 1) === 1;
    const blPresent = (word & 1) === 1;
    const compatibilityId = u8(data, offset + 4) >> 4;
    let profileName = String(profile);
    if (profile === 8 || profile === 10) {
        profileName = profile + '.' + compatibilityId;
    }
    return {
        profile,
        profileName,
        level,
        compatibilityId,
        baseLayer: blPresent ? (DV_COMPATIBILITY[compatibilityId] || 'unknown') : 'none',
        rpuPresent,
        elPresent,
        blPresent,
        version: versionMajor + '.' + versionMinor,
    };
};

// ---------------------------------------------------------------------------------------------
// Colour description (ISO/IEC 23091-2 code points, shared by MKV Colour, MP4 colr and VUI).

const TRANSFER = {
    1: 'bt709',
    4: 'bt470m',
    5: 'bt470bg',
    6: 'bt601',
    7: 'smpte240m',
    8: 'linear',
    11: 'iec61966-2-4',
    13: 'srgb',
    14: 'bt2020-10',
    15: 'bt2020-12',
    16: 'pq',
    18: 'hlg',
};

const PRIMARIES = {
    1: 'bt709',
    4: 'bt470m',
    5: 'bt470bg',
    6: 'bt601',
    7: 'smpte240m',
    9: 'bt2020',
    11: 'dci-p3',
    12: 'display-p3',
};

const MATRIX = {
    0: 'rgb',
    1: 'bt709',
    5: 'bt470bg',
    6: 'bt601',
    9: 'bt2020nc',
    10: 'bt2020c',
    14: 'ictcp',
};

const colourInfo = (primaries, transfer, matrix, fullRange) => ({
    primaries: primaries === undefined || primaries === null ? null : (PRIMARIES[primaries] || null),
    transfer: transfer === undefined || transfer === null ? null : (TRANSFER[transfer] || null),
    matrix: matrix === undefined || matrix === null ? null : (MATRIX[matrix] || null),
    fullRange: fullRange === undefined || fullRange === null ? null : Boolean(fullRange),
});

// ---------------------------------------------------------------------------------------------
// HEVC: HEVCDecoderConfigurationRecord (hvcC, also the MKV CodecPrivate) and the SPS VUI colour.

const HEVC_PROFILES = {
    1: 'Main',
    2: 'Main 10',
    3: 'Main Still Picture',
    4: 'Range Extensions',
};

const skipProfileTierLevel = (reader, maxSubLayersMinus1) => {
    reader.skip(96);
    const profilePresent = [];
    const levelPresent = [];
    for (let i = 0; i < maxSubLayersMinus1; i++) {
        profilePresent.push(reader.bit());
        levelPresent.push(reader.bit());
    }
    if (maxSubLayersMinus1 > 0) {
        for (let i = maxSubLayersMinus1; i < 8; i++) reader.skip(2);
    }
    for (let i = 0; i < maxSubLayersMinus1; i++) {
        if (profilePresent[i]) reader.skip(88);
        if (levelPresent[i]) reader.skip(8);
    }
};

const skipScalingListData = (reader) => {
    for (let sizeId = 0; sizeId < 4; sizeId++) {
        for (let matrixId = 0; matrixId < 6; matrixId += sizeId === 3 ? 3 : 1) {
            if (reader.bit() === 0) {
                reader.ue();
            } else {
                const coefNum = Math.min(64, 1 << (4 + (sizeId << 1)));
                if (sizeId > 1) reader.se();
                for (let i = 0; i < coefNum; i++) reader.se();
            }
        }
    }
};

// Parses an HEVC SPS NAL unit (with its 2-byte header) up to the VUI colour description.
const parseHevcSpsColour = (nal) => {
    const rbsp = unescapeRbsp(nal, 2, nal.length - 2);
    const reader = new BitReader(rbsp);
    reader.skip(4);
    const maxSubLayersMinus1 = reader.bits(3);
    reader.skip(1);
    skipProfileTierLevel(reader, maxSubLayersMinus1);
    reader.ue();
    const chromaFormatIdc = reader.ue();
    if (chromaFormatIdc === 3) reader.skip(1);
    reader.ue();
    reader.ue();
    if (reader.bit() === 1) {
        reader.ue();
        reader.ue();
        reader.ue();
        reader.ue();
    }
    reader.ue();
    reader.ue();
    const log2MaxPocLsb = reader.ue() + 4;
    const subLayerOrderingInfo = reader.bit();
    for (let i = subLayerOrderingInfo ? 0 : maxSubLayersMinus1; i <= maxSubLayersMinus1; i++) {
        reader.ue();
        reader.ue();
        reader.ue();
    }
    reader.ue();
    reader.ue();
    reader.ue();
    reader.ue();
    reader.ue();
    reader.ue();
    if (reader.bit() === 1 && reader.bit() === 1) {
        skipScalingListData(reader);
    }
    reader.skip(2);
    if (reader.bit() === 1) {
        reader.skip(8);
        reader.ue();
        reader.ue();
        reader.skip(1);
    }
    const numShortTermRefPicSets = reader.ue();
    const numDeltaPocs = [];
    for (let idx = 0; idx < numShortTermRefPicSets; idx++) {
        const interPrediction = idx !== 0 ? reader.bit() : 0;
        if (interPrediction) {
            reader.skip(1);
            reader.ue();
            let count = 0;
            for (let j = 0; j <= numDeltaPocs[idx - 1]; j++) {
                const used = reader.bit();
                const useDelta = used ? 1 : reader.bit();
                if (used || useDelta) count++;
            }
            numDeltaPocs.push(count);
        } else {
            const negative = reader.ue();
            const positive = reader.ue();
            for (let j = 0; j < negative + positive; j++) {
                reader.ue();
                reader.skip(1);
            }
            numDeltaPocs.push(negative + positive);
        }
    }
    if (reader.bit() === 1) {
        const numLongTerm = reader.ue();
        for (let i = 0; i < numLongTerm; i++) {
            reader.skip(log2MaxPocLsb + 1);
        }
    }
    reader.skip(2);
    if (reader.bit() === 0) return null;
    if (reader.bit() === 1) {
        if (reader.bits(8) === 255) reader.skip(32);
    }
    if (reader.bit() === 1) reader.skip(1);
    if (reader.bit() === 0) return null;
    reader.skip(3);
    const fullRange = reader.bit();
    if (reader.bit() === 0) return colourInfo(null, null, null, fullRange);
    const primaries = reader.bits(8);
    const transfer = reader.bits(8);
    const matrix = reader.bits(8);
    return colourInfo(primaries, transfer, matrix, fullRange);
};

const parseHvcC = (data, offset, length) => {
    if (length < 23) return null;
    const profileIdc = u8(data, offset + 1) & 0x1f;
    const tier = (u8(data, offset + 1) >> 5) & 1;
    const levelIdc = u8(data, offset + 12);
    const chromaFormat = u8(data, offset + 16) & 3;
    const bitDepth = (u8(data, offset + 17) & 7) + 8;
    const result = {
        profile: HEVC_PROFILES[profileIdc] || ('profile ' + profileIdc),
        level: levelIdc / 30,
        tier: tier ? 'High' : 'Main',
        chromaFormat,
        bitDepth,
        colour: null,
    };
    const numArrays = u8(data, offset + 22);
    let position = offset + 23;
    const end = offset + length;
    for (let i = 0; i < numArrays && position + 3 <= end; i++) {
        const nalType = u8(data, position) & 0x3f;
        const numNalus = u16(data, position + 1);
        position += 3;
        for (let j = 0; j < numNalus && position + 2 <= end; j++) {
            const nalLength = u16(data, position);
            position += 2;
            if (nalType === 33 && result.colour === null && position + nalLength <= end) {
                try {
                    result.colour = parseHevcSpsColour(data.subarray(position, position + nalLength));
                } catch (_e) {
                    result.colour = null;
                }
            }
            position += nalLength;
        }
    }
    return result;
};

const AVC_PROFILES = {
    66: 'Baseline',
    77: 'Main',
    88: 'Extended',
    100: 'High',
    110: 'High 10',
    122: 'High 4:2:2',
    244: 'High 4:4:4',
};

const parseAvcC = (data, offset, length) => {
    if (length < 4) return null;
    const profileIdc = u8(data, offset + 1);
    return {
        profile: AVC_PROFILES[profileIdc] || ('profile ' + profileIdc),
        level: u8(data, offset + 3) / 10,
        bitDepth: profileIdc === 110 || profileIdc === 122 || profileIdc === 244 ? null : 8,
        colour: null,
    };
};

// ---------------------------------------------------------------------------------------------
// AC-3 and E-AC-3 (ETSI TS 102 366).

const ACMOD_CHANNELS = [2, 1, 2, 3, 3, 4, 4, 5];
// dec3 chan_loc bits, MSB first: Lc/Rc, Lrs/Rrs, Cs, Ts, Lsd/Rsd, Lw/Rw, Lvh/Rvh, Cvh, LFE2.
const CHAN_LOC_CHANNELS = [2, 2, 1, 1, 2, 2, 2, 1, 1];
const AC3_SAMPLE_RATES = [48000, 44100, 32000];

const parseDac3 = (data, offset, length) => {
    if (length < 3) return null;
    const reader = new BitReader(data, offset, length);
    const fscod = reader.bits(2);
    reader.skip(5 + 3);
    const acmod = reader.bits(3);
    const lfeon = reader.bit();
    return {
        channels: ACMOD_CHANNELS[acmod] + lfeon,
        sampleRate: AC3_SAMPLE_RATES[fscod] || null,
    };
};

const parseDec3 = (data, offset, length) => {
    if (length < 5) return null;
    const reader = new BitReader(data, offset, length);
    reader.skip(13);
    const numIndSub = reader.bits(3) + 1;
    let channels = null;
    let sampleRate = null;
    for (let i = 0; i < numIndSub; i++) {
        const fscod = reader.bits(2);
        reader.skip(5 + 1 + 1 + 3);
        const acmod = reader.bits(3);
        const lfeon = reader.bit();
        reader.skip(3);
        const numDepSub = reader.bits(4);
        let extra = 0;
        if (numDepSub > 0) {
            const chanLoc = reader.bits(9);
            for (let bit = 0; bit < 9; bit++) {
                if ((chanLoc >> (8 - bit)) & 1) extra += CHAN_LOC_CHANNELS[bit];
            }
        } else {
            reader.skip(1);
        }
        if (i === 0) {
            channels = ACMOD_CHANNELS[acmod] + lfeon + extra;
            sampleRate = AC3_SAMPLE_RATES[fscod] || null;
        }
    }
    let atmos = false;
    let complexityIndex = null;
    if (reader.remaining() >= 8) {
        reader.skip(7);
        atmos = reader.bit() === 1;
        if (atmos && reader.remaining() >= 8) complexityIndex = reader.bits(8);
    }
    return { channels, sampleRate, atmos, complexityIndex };
};

// Parses the bit stream information of the first E-AC-3 syncframe in `data` and reports the
// Atmos (JOC) flag, flag_ec3_extension_type_a in addbsi (same logic as FFmpeg's eac3dec).
const sniffEac3Frame = (data) => {
    const sync = indexOfSequence(data, [0x0b, 0x77], 0, Math.min(data.length, 64));
    if (sync === -1 || data.length - sync < 32) return null;
    try {
        const reader = new BitReader(data, sync + 2, data.length - sync - 2);
        const frameType = reader.bits(2);
        reader.skip(3 + 11);
        const fscod = reader.bits(2);
        let numBlocks = 6;
        if (fscod === 3) {
            reader.skip(2);
        } else {
            numBlocks = [1, 2, 3, 6][reader.bits(2)];
        }
        const acmod = reader.bits(3);
        const lfeon = reader.bit();
        const bsid = reader.bits(5);
        if (bsid <= 10) return { eac3: false, atmos: false };
        if (bsid > 16) return null;
        for (let i = 0; i < (acmod === 0 ? 2 : 1); i++) {
            reader.skip(5);
            if (reader.bit()) reader.skip(8);
        }
        if (frameType === 1 && reader.bit()) reader.skip(16);
        if (reader.bit()) {
            if (acmod > 2) {
                reader.skip(2);
                if (acmod & 1) reader.skip(6);
                if (acmod & 4) reader.skip(6);
            }
            if (lfeon && reader.bit()) reader.skip(5);
            if (frameType === 0) {
                for (let i = 0; i < (acmod === 0 ? 2 : 1); i++) {
                    if (reader.bit()) reader.skip(6);
                }
                if (reader.bit()) reader.skip(6);
                const mixdef = reader.bits(2);
                if (mixdef === 1) reader.skip(5);
                else if (mixdef === 2) reader.skip(12);
                else if (mixdef === 3) reader.skip((reader.bits(5) + 2) * 8);
                if (acmod < 2) {
                    for (let i = 0; i < (acmod === 0 ? 2 : 1); i++) {
                        if (reader.bit()) reader.skip(14);
                    }
                }
                if (reader.bit()) {
                    for (let blk = 0; blk < numBlocks; blk++) {
                        if (numBlocks === 1 || reader.bit()) reader.skip(5);
                    }
                }
            }
        }
        if (reader.bit()) {
            reader.skip(3 + 2);
            if (acmod === 2) reader.skip(4);
            if (acmod >= 6) reader.skip(2);
            for (let i = 0; i < (acmod === 0 ? 2 : 1); i++) {
                if (reader.bit()) reader.skip(8);
            }
            if (fscod !== 3) reader.skip(1);
        }
        if (frameType === 0 && numBlocks !== 6) reader.skip(1);
        if (frameType === 2 && (numBlocks === 6 || reader.bit())) reader.skip(6);
        let atmos = false;
        if (reader.bit()) {
            reader.skip(6);
            reader.skip(7);
            atmos = reader.bit() === 1;
        }
        return { eac3: true, atmos };
    } catch (_e) {
        return null;
    }
};

// ---------------------------------------------------------------------------------------------
// TrueHD: major sync of the first access unit (FFmpeg mlp_parse.c / mlpdec.c).

// Channel counts per bit of the TrueHD channel arrangement, LSB first: L/R, C, LFE, Ls/Rs, Lvh/Rvh,
// Lc/Rc, Lrs/Rrs, Cs, Ts, Lsd/Rsd, Lw/Rw, Cvh, LFE2.
const TRUEHD_CHANNEL_COUNTS = [2, 1, 1, 2, 2, 2, 2, 1, 1, 2, 2, 1, 1];
const TRUEHD_SAMPLE_RATES = { 0: 48000, 1: 96000, 2: 192000, 8: 44100, 9: 88200, 10: 176400 };

const truehdChannels = (arrangement) => {
    let channels = 0;
    for (let bit = 0; bit < 13; bit++) {
        if ((arrangement >> bit) & 1) channels += TRUEHD_CHANNEL_COUNTS[bit];
    }
    return channels;
};

// format_info (32 bits), shared by the TrueHD major sync and the MP4 dmlp box.
const parseTrueHdFormatInfo = (data, offset) => {
    const reader = new BitReader(data, offset, 4);
    const rate = reader.bits(4);
    reader.skip(4 + 2 + 2);
    const sixChannel = reader.bits(5);
    reader.skip(2);
    const eightChannel = reader.bits(13);
    return {
        channels: truehdChannels(eightChannel) || truehdChannels(sixChannel) || null,
        sampleRate: TRUEHD_SAMPLE_RATES[rate] || null,
    };
};

const sniffTrueHdFrame = (data) => {
    const sync = indexOfSequence(data, [0xf8, 0x72, 0x6f, 0xba], 0, Math.min(data.length, 64));
    if (sync === -1 || data.length - sync < 24) return null;
    const format = parseTrueHdFormatInfo(data, sync + 4);
    const reader = new BitReader(data, sync + 8, data.length - sync - 8);
    if (reader.bits(16) !== 0xb752) return null;
    reader.skip(16 + 16 + 1 + 15);
    const substreams = reader.bits(4);
    reader.skip(2);
    reader.skip(2);
    const substreamInfo = reader.bits(8);
    return {
        substreams,
        channels: format.channels,
        sampleRate: format.sampleRate,
        atmos: substreams === 4 && (substreamInfo >> 7) === 1,
    };
};

// ---------------------------------------------------------------------------------------------
// DTS: tell core, DTS-HD High Resolution, DTS-HD Master Audio and DTS Express apart by the
// sync words present in the first frame.

const DTS_CORE_SYNC = [0x7f, 0xfe, 0x80, 0x01];
const DTS_SUBSTREAM_SYNC = [0x64, 0x58, 0x20, 0x25];
const DTS_XLL_SYNC = [0x41, 0xa2, 0x95, 0x47];
const DTS_LBR_SYNC = [0x0a, 0x80, 0x19, 0x21];
// DTS:X and IMAX Enhanced data inside the lossless (XLL) extension (FFmpeg dca_syncwords.h).
const DTS_XLL_X_SYNC = [0x02, 0x00, 0x08, 0x50];
const DTS_XLL_X_IMAX_SYNC = [0xf1, 0x40, 0x00, 0xd0];

const sniffDtsFrame = (data) => {
    const core = indexOfSequence(data, DTS_CORE_SYNC, 0, Math.min(data.length, 64)) !== -1;
    const substream = indexOfSequence(data, DTS_SUBSTREAM_SYNC) !== -1;
    if (!core && !substream) return null;
    if (!substream) return { profile: 'DTS', core };
    const xll = indexOfSequence(data, DTS_XLL_SYNC);
    if (xll !== -1) {
        const x = indexOfSequence(data, DTS_XLL_X_SYNC, xll) !== -1 || indexOfSequence(data, DTS_XLL_X_IMAX_SYNC, xll) !== -1;
        return { profile: x ? 'DTS:X' : 'DTS-HD MA', core };
    }
    if (indexOfSequence(data, DTS_LBR_SYNC) !== -1) return { profile: 'DTS Express', core };
    return { profile: 'DTS-HD', core };
};

// Fills audio.atmos / audio.profile of an E-AC-3, TrueHD or DTS track from its first frame.
// Returns false when the frame could not be recognised.
const applyFrameSniff = (track, frame) => {
    if (track.codec === 'eac3') {
        const result = sniffEac3Frame(frame);
        if (result === null) return false;
        track.audio.atmos = result.atmos;
        track.audio.profile = result.atmos ? 'E-AC-3 JOC' : null;
        return true;
    }
    if (track.codec === 'truehd') {
        const result = sniffTrueHdFrame(frame);
        if (result === null) return false;
        track.audio.atmos = result.atmos;
        track.audio.profile = result.atmos ? 'TrueHD Atmos' : null;
        if (result.channels) track.audio.channels = result.channels;
        return true;
    }
    if (track.codec === 'dts') {
        const result = sniffDtsFrame(frame);
        if (result === null) return false;
        track.audio.profile = result.profile;
        track.audio.atmos = false;
        return true;
    }
    return true;
};

const SNIFF_BYTES = { eac3: 512, truehd: 512, dts: 32 * 1024 };

// ---------------------------------------------------------------------------------------------
// MPEG-4 audio: esds descriptors and AudioSpecificConfig.

const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const AAC_CHANNELS = [null, 1, 2, 3, 4, 5, 6, 8];
const AAC_OBJECT_TYPES = { 1: 'AAC Main', 2: 'AAC LC', 3: 'AAC SSR', 4: 'AAC LTP', 5: 'HE-AAC', 29: 'HE-AACv2', 42: 'xHE-AAC' };
const MPEG_OBJECT_TYPES = { 0x40: 'aac', 0x66: 'aac', 0x67: 'aac', 0x68: 'aac', 0x69: 'mp3', 0x6b: 'mp3', 0xa5: 'ac3', 0xa6: 'eac3', 0xa9: 'dts', 0xad: 'opus' };

const parseAudioSpecificConfig = (data, offset, length) => {
    if (length < 2) return null;
    try {
        const reader = new BitReader(data, offset, length);
        let objectType = reader.bits(5);
        if (objectType === 31) objectType = 32 + reader.bits(6);
        const frequencyIndex = reader.bits(4);
        const sampleRate = frequencyIndex === 15 ? reader.bits(24) : (AAC_SAMPLE_RATES[frequencyIndex] || null);
        const channelConfig = reader.bits(4);
        return {
            profile: AAC_OBJECT_TYPES[objectType] || null,
            sampleRate,
            channels: AAC_CHANNELS[channelConfig] || null,
        };
    } catch (_e) {
        return null;
    }
};

const readDescriptor = (data, position, end) => {
    if (position + 2 > end) return null;
    const tag = u8(data, position);
    let size = 0;
    let cursor = position + 1;
    for (let i = 0; i < 4 && cursor < end; i++) {
        const byte = u8(data, cursor++);
        size = (size << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) break;
    }
    return { tag, start: cursor, end: Math.min(cursor + size, end) };
};

// esds payload (after the FullBox version/flags) -> { codec, profile, channels, sampleRate }.
const parseEsds = (data, offset, length) => {
    const end = offset + length;
    const es = readDescriptor(data, offset, end);
    if (es === null || es.tag !== 3) return null;
    let position = es.start + 2;
    const flags = u8(data, position++);
    if (flags & 0x80) position += 2;
    if (flags & 0x40) position += 1 + u8(data, position);
    if (flags & 0x20) position += 2;
    const config = readDescriptor(data, position, es.end);
    if (config === null || config.tag !== 4) return null;
    const objectTypeIndication = u8(data, config.start);
    const result = {
        codec: MPEG_OBJECT_TYPES[objectTypeIndication] || 'unknown',
        profile: null,
        channels: null,
        sampleRate: null,
    };
    const specific = readDescriptor(data, config.start + 13, config.end);
    if (result.codec === 'aac' && specific !== null && specific.tag === 5) {
        const asc = parseAudioSpecificConfig(data, specific.start, specific.end - specific.start);
        if (asc !== null) {
            result.profile = asc.profile;
            result.channels = asc.channels;
            result.sampleRate = asc.sampleRate;
        }
    }
    return result;
};

// ---------------------------------------------------------------------------------------------
// Normalised codec names.

const MKV_CODECS = [
    ['V_MPEGH/ISO/HEVC', 'hevc'],
    ['V_MPEG4/ISO/AVC', 'avc'],
    ['V_AV1', 'av1'],
    ['V_VP9', 'vp9'],
    ['V_VP8', 'vp8'],
    ['V_MPEG2', 'mpeg2'],
    ['V_MPEG4/', 'mpeg4'],
    ['V_MS/VFW/FOURCC', 'vfw'],
    ['A_EAC3', 'eac3'],
    ['A_AC3', 'ac3'],
    ['A_TRUEHD', 'truehd'],
    ['A_MLP', 'mlp'],
    ['A_DTS', 'dts'],
    ['A_AAC', 'aac'],
    ['A_OPUS', 'opus'],
    ['A_VORBIS', 'vorbis'],
    ['A_FLAC', 'flac'],
    ['A_MPEG/L3', 'mp3'],
    ['A_MPEG/L2', 'mp2'],
    ['A_PCM/', 'pcm'],
    ['A_AC4', 'ac4'],
    ['S_TEXT/UTF8', 'srt'],
    ['S_TEXT/ASCII', 'srt'],
    ['S_TEXT/SSA', 'ssa'],
    ['S_TEXT/ASS', 'ass'],
    ['S_SSA', 'ssa'],
    ['S_ASS', 'ass'],
    ['S_TEXT/WEBVTT', 'webvtt'],
    ['S_HDMV/PGS', 'pgs'],
    ['S_HDMV/TEXTST', 'textst'],
    ['S_VOBSUB', 'vobsub'],
    ['S_DVBSUB', 'dvbsub'],
    ['S_TEXT/USF', 'usf'],
    ['S_KATE', 'kate'],
];

const mkvCodec = (codecId) => {
    if (typeof codecId !== 'string') return 'unknown';
    const match = MKV_CODECS.filter((entry) => codecId.indexOf(entry[0]) === 0)[0];
    return match ? match[1] : 'unknown';
};

const MP4_CODECS = {
    hvc1: 'hevc',
    hev1: 'hevc',
    dvh1: 'hevc',
    dvhe: 'hevc',
    avc1: 'avc',
    avc2: 'avc',
    avc3: 'avc',
    avc4: 'avc',
    dva1: 'avc',
    dvav: 'avc',
    av01: 'av1',
    dav1: 'av1',
    vp09: 'vp9',
    vp08: 'vp8',
    mp4v: 'mpeg4',
    'ec-3': 'eac3',
    'ac-3': 'ac3',
    'ac-4': 'ac4',
    mlpa: 'truehd',
    dtsc: 'dts',
    dtsh: 'dts',
    dtsl: 'dts',
    dtse: 'dts',
    dtsx: 'dts',
    dtsy: 'dts',
    mp4a: 'aac',
    '.mp3': 'mp3',
    Opus: 'opus',
    fLaC: 'flac',
    lpcm: 'pcm',
    ipcm: 'pcm',
    sowt: 'pcm',
    twos: 'pcm',
    tx3g: 'tx3g',
    wvtt: 'webvtt',
    stpp: 'ttml',
    c608: 'cea608',
};

const MP4_DTS_PROFILES = {
    dtsc: 'DTS',
    dtsh: 'DTS-HD',
    dtsl: 'DTS-HD MA',
    dtse: 'DTS Express',
    dtsx: 'DTS:X',
    dtsy: 'DTS:X',
};

const BITMAP_SUBTITLES = ['pgs', 'vobsub', 'dvbsub'];

module.exports = {
    DV_COMPATIBILITY,
    parseDoviConfig,
    colourInfo,
    parseHvcC,
    parseHevcSpsColour,
    parseAvcC,
    parseDac3,
    parseDec3,
    sniffEac3Frame,
    sniffTrueHdFrame,
    parseTrueHdFormatInfo,
    sniffDtsFrame,
    applyFrameSniff,
    SNIFF_BYTES,
    parseEsds,
    parseAudioSpecificConfig,
    mkvCodec,
    MP4_CODECS,
    MP4_DTS_PROFILES,
    BITMAP_SUBTITLES,
};
