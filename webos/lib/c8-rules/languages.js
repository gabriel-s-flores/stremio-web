// Language codes come in several forms: the probe gives ISO 639-2 (MKV uses the bibliographic
// codes, "fre", "ger"; MP4 the terminological ones, "fra", "deu"), the app settings keep ISO
// 639-2 from the `langs` package, and video.audioTracks gives ISO 639-1 ("pt"). Everything is
// folded to ISO 639-2/T so that the three compare equal. Unknown codes pass through lowercased.

const ALPHA2 = {
    ar: 'ara', bg: 'bul', ca: 'cat', cs: 'ces', da: 'dan', de: 'deu', el: 'ell', en: 'eng',
    es: 'spa', et: 'est', eu: 'eus', fa: 'fas', fi: 'fin', fr: 'fra', gl: 'glg', he: 'heb',
    hi: 'hin', hr: 'hrv', hu: 'hun', hy: 'hye', id: 'ind', is: 'isl', it: 'ita', ja: 'jpn',
    ka: 'kat', ko: 'kor', lt: 'lit', lv: 'lav', mk: 'mkd', ms: 'msa', nb: 'nob', nl: 'nld',
    nn: 'nno', no: 'nor', pl: 'pol', pt: 'por', ro: 'ron', ru: 'rus', sk: 'slk', sl: 'slv',
    sq: 'sqi', sr: 'srp', sv: 'swe', ta: 'tam', te: 'tel', th: 'tha', tr: 'tur', uk: 'ukr',
    vi: 'vie', zh: 'zho',
};

// ISO 639-2/B -> 639-2/T (the 20 codes that differ).
const BIBLIOGRAPHIC = {
    alb: 'sqi', arm: 'hye', baq: 'eus', bur: 'mya', chi: 'zho', cze: 'ces', dut: 'nld',
    fre: 'fra', geo: 'kat', ger: 'deu', gre: 'ell', ice: 'isl', mac: 'mkd', mao: 'mri',
    may: 'msa', per: 'fas', rum: 'ron', slo: 'slk', tib: 'bod', wel: 'cym',
};

const UNDEFINED = ['und', 'mis', 'mul', 'zxx', ''];

// "pt-BR", "por", "pt", "fre" -> "por", "por", "por", "fra". null for missing/undefined.
const normalizeLanguage = (code) => {
    if (typeof code !== 'string') return null;
    const base = code.trim().toLowerCase().split(/[-_]/)[0];
    if (UNDEFINED.indexOf(base) !== -1) return null;
    if (base.length === 2) return ALPHA2[base] || base;
    return BIBLIOGRAPHIC[base] || base;
};

module.exports = {
    normalizeLanguage,
};
