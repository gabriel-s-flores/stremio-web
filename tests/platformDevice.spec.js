const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const Bowser = require('bowser');
const ua = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36';
const source = ts.transpileModule(fs.readFileSync('src/common/Platform/device.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText;
const detect = (navigator, document, absent = false) => {
    let result;
    jest.isolateModules(() => {
        const context = { exports: {}, require };
        if (!absent) Object.assign(context, { navigator, document });
        vm.runInNewContext(source, context);
        result = context.exports;
    });
    return result;
};
const expectDevice = (navigator, document, name, isMobile = false, isTV = false) => {
    const result = detect(navigator, document);
    expect({ ...result }).toEqual({ name, isMobile, isTV });
    expect(result.isTV && result.isMobile).toBe(false);
};
test.each(['Web0S', 'WebOS', 'WebAppManager', 'SmartTV', 'wEbOs'])('%s identifies webOS', marker => {
    expectDevice({ userAgent: ua.replace('Web0S; Linux/SmartTV', marker) }, {}, 'webos', false, true);
});
test.each([
    ['Windows NT 10.0; Win64; x64', 'windows'],
    ['X11; Linux x86_64', 'linux'],
    ['Macintosh; Intel Mac OS X 10_15_7', 'macos'],
    ['Linux; Android 10; Mobile', 'android'],
])('%s preserves classification', (system, name) => {
    expectDevice({ userAgent: ua.replace('Web0S; Linux/SmartTV', system) }, {}, name, name === 'android');
});
test.each(['iPhone', 'iPad', 'iPod', 'iPad Simulator'])('%s stays iOS', platform => {
    expectDevice({ platform }, {}, 'ios', true);
});
test('modern iPadOS and visionOS retain precedence', () => {
    const navigator = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) WebOS', maxTouchPoints: 5 };
    expectDevice(navigator, { ontouchend: null }, 'ios', true);
    expectDevice({ ...navigator, xr: {} }, { ontouchend: null }, 'visionos');
});
test.each([undefined, null, {}])('incomplete navigator %p', navigator => {
    expectDevice(navigator, undefined, 'unknown');
});
test('absent globals', () => expect({ ...detect(undefined, undefined, true) }).toEqual({ name: 'unknown', isTV: false, isMobile: false }));
test.each([undefined, null, {}])('incomplete document %p', document => {
    expectDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }, document, 'macos');
});
test('viewport initialization preserves TV and clears desktop', () => {
    const initialization = fs.readFileSync('src/index.js', 'utf8').split("const React = require('react');")[0];
    for (const [userAgent, expected] of [[ua, 0], [ua.replace('Web0S; Linux/SmartTV', 'Windows NT 10.0; Win64; x64'), 1]]) {
        const setAttribute = jest.fn();
        vm.runInNewContext(initialization, { process: { env: {} }, require, window: { navigator: { userAgent } }, document: { querySelector: () => ({ setAttribute }) } });
        expect(setAttribute).toHaveBeenCalledTimes(expected);
        if (expected) expect(setAttribute).toHaveBeenCalledWith('content', '');
    }
    expect(Bowser.parse(ua).platform.type).not.toBe('desktop');
});

