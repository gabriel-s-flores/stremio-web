const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('src/common/Platform/device.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText;
const detect = (navigator, document) => {
    const exports = {};
    vm.runInNewContext(source, { exports, ...(navigator === undefined ? {} : { navigator }), document,
        require: id => require(id) });
    return exports;
};
test.each(['Web0S', 'webOS', 'WebAppManager', 'SmartTV'])('detects TV UA %s', token => {
    expect(detect({ userAgent: 'Mozilla/5.0 ' + token })).toMatchObject({ name: 'webos', isTV: true, isMobile: false });
});
test.each([undefined, null, {}, { userAgent: '' }])('safe without navigator fields: %p', navigator => {
    expect(detect(navigator)).toMatchObject({ name: 'unknown', isTV: false, isMobile: false });
});
test.each([
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, undefined, 'windows', false],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 10)' }, undefined, 'android', true],
    [{ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5, xr: {} }, { ontouchend: null }, 'visionos', false],
    [{ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 }, { ontouchend: null }, 'ios', true],
])('preserves platform classification %p', (navigator, document, name, isMobile) => {
    expect(detect(navigator, document)).toMatchObject({ name, isMobile, isTV: false });
});
