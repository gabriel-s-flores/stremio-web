// Keep selectors observable without pulling unrelated CSS/assets into the fixture.
module.exports = function () { return 'module.exports = new Proxy({}, { get: function (_, key) { return key === "__esModule" ? false : key; } });'; };
