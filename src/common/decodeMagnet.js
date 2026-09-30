const magnet = require('magnet-uri');

const decodeMagnet = (text) => {
    try {
        return magnet.decode(text);
    } catch (_) {
        return null;
    }
};

module.exports = { decodeMagnet };
