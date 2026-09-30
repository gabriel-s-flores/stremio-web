// Copyright (C) 2017-2026 Smart code 203358507

// Backward-compatible entry point. The single Clipboard seam lives in
// `stremio/common/clipboard`; this module preserves the historical
// `writeTextToClipboard(text): Promise<void>` contract.
const { writeTextToClipboard } = require('./clipboard');

module.exports = writeTextToClipboard;
