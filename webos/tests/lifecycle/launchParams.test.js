const { parseLaunchParams, resolveDeepLink, toRoutePath } = require('../../lifecycle/launchParams');

describe('parseLaunchParams', () => {
    test('reads the JSON string of PalmSystem.launchParams', () => {
        expect(parseLaunchParams('{"displayAffinity":0,"foo":"bar"}')).toEqual({ displayAffinity: 0, foo: 'bar' });
    });

    test('takes an object as is', () => {
        expect(parseLaunchParams({ contentTarget: 'x' })).toEqual({ contentTarget: 'x' });
    });

    test.each([undefined, null, '', '   ', 'not json', '[1,2]', '"text"', 42, []])('%p gives no parameters', (raw) => {
        expect(parseLaunchParams(raw)).toEqual({});
    });
});

describe('toRoutePath', () => {
    test.each([
        ['stremio:///detail/movie/tt0111161', '/detail/movie/tt0111161'],
        ['stremio://detail/series/tt0944947/tt0944947%3A1%3A1', '/detail/series/tt0944947/tt0944947%3A1%3A1'],
        ['STREMIO:///discover', '/discover'],
        ['#/discover', '/discover'],
        ['/library/movie', '/library/movie'],
        ['calendar', '/calendar'],
        ['/addons', '/addons'],
        ['/settings', '/settings'],
        ['/search?search=matrix', '/search?search=matrix'],
        ['/', '/'],
    ])('%s -> %s', (target, expected) => {
        expect(toRoutePath(target)).toBe(expected);
    });

    test.each([
        'https://example.com/discover',
        'http://127.0.0.1:11470/stream',
        'javascript:alert(1)',
        '/player/abc',
        '/intro',
        '/unknown',
        '/discover/../settings',
        '//evil.example.com/discover',
        '/discover\\evil',
        '/detail/movie',
        '',
        '   ',
        42,
        null,
        undefined,
    ])('%p is not an in-app target', (target) => {
        expect(toRoutePath(target)).toBeNull();
    });
});

describe('resolveDeepLink', () => {
    test('contentTarget is the LG key', () => {
        expect(resolveDeepLink('{"contentTarget":"stremio:///detail/movie/tt0111161"}')).toBe('/detail/movie/tt0111161');
    });

    test.each(['deepLink', 'deeplink', 'route'])('%s works too', (key) => {
        expect(resolveDeepLink({ [key]: '#/library' })).toBe('/library');
    });

    test('skips a key whose value is not allowed and takes the next one', () => {
        expect(resolveDeepLink({ contentTarget: 'https://example.com', route: '/addons' })).toBe('/addons');
    });

    test('no deep link', () => {
        expect(resolveDeepLink({ displayAffinity: 0 })).toBeNull();
        expect(resolveDeepLink('{"displayAffinity":0}')).toBeNull();
        expect(resolveDeepLink(undefined)).toBeNull();
    });
});
