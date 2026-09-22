const validate = require('../tools/t41-runtime.cjs');

const ua = 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/68.0.3440.106';
const version = { product: '', jsVersion: '6.8.275.26', userAgent: ua };
const identity = { ua: ua + ' WebAppManager', width: 1920, height: 1080, scale: 1, devicePixelRatio: 0 };
const metrics = { visualViewport: { scale: 1 } };
const command = '/usr/bin/WebAppMgr --webos-wam --user-agent-suffix=SmartTV';

test('native page scale 1 passes independently of the WAM diagnostic DPR value', () => {
    const result = validate(version, metrics, identity, command);
    expect(result.failures).toEqual([]);
    expect(result.runtime.scale).toBe(1);
    expect(result.runtime.devicePixelRatio).toBe(0);
    expect(result.runtime.overridesIssued).toEqual([]);
});

test.each([{ width: 1280 }, { height: 720 }, { scale: 2 }, { scale: null }])('rejects an incorrect or unverified viewport/page scale: %j', change => {
    expect(validate(version, metrics, { ...identity, ...change }, command).failures).not.toEqual([]);
});

test('cross-checks the page scale against the native CDP layout metrics', () => {
    expect(validate(version, { visualViewport: { scale: 2 } }, identity, command).failures).not.toEqual([]);
});

test('a modern engine cannot pass using a Chromium 68 User-Agent', () => {
    expect(() => validate({ ...version, jsVersion: '14.0.0' }, metrics, identity, command)).toThrow('Native Chromium 68');
});

test('rejects page User-Agent overrides and launch overrides', () => {
    expect(() => validate(version, metrics, { ...identity, ua: ua + ' spoof' }, command)).toThrow('User-Agent override');
    expect(() => validate(version, metrics, identity, command + ' --user-agent=spoof')).toThrow('without --user-agent');
});

test('requires independent native process evidence', () => {
    expect(() => validate(version, metrics, identity, '')).toThrow('Native Chromium 68');
});
