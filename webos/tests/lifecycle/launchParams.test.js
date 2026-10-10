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
        ['/search?search=a%20b', '/search?search=a%20b'],
        ['/search?search=matrix&streamingServerUrl=http%3A%2F%2F127.0.0.1%3A12345%2F', '/search?search=matrix'],
        ['/search?query=matrix', '/search'],
        ['/search?search=', '/search'],
        ['/discover/http%3A%2F%2Fa.example%2Fmanifest.json/movie/top', '/discover/http%3A%2F%2Fa.example%2Fmanifest.json/movie/top'],
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
        '/detail/../player/x',
        '/detail/%2e%2E/player/x',
        '/detail/movie/%2e/x',
        '/detail//movie/tt1',
        '//evil.example.com/discover',
        '/discover#fragment',
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

describe('query string', () => {
    // Screens read settings from the query: ?streamingServerUrl= saves and activates a streaming
    // server (SearchParamsHandler), /addons?addon= opens an addon by URL. A launch must not do either.
    test.each([
        ['/discover?streamingServerUrl=http%3A%2F%2F127.0.0.1%3A12345%2F', '/discover'],
        ['/addons?addon=https%3A%2F%2Fevil.example%2Fmanifest.json', '/addons'],
        ['/addons?addon=https://evil.example/manifest.json', '/addons'],
        ['/settings?streamingServerUrl=http://10.0.0.1:11470', '/settings'],
        ['/detail/movie/tt0111161?x=http://a', '/detail/movie/tt0111161'],
        ['stremio:///library?streamingServerUrl=http%3A%2F%2F127.0.0.1%3A1', '/library'],
    ])('%s -> %s', (target, expected) => {
        expect(toRoutePath(target)).toBe(expected);
        expect(resolveDeepLink({ contentTarget: target })).toBe(expected);
    });

    test('the search text is the only thing the query keeps, once', () => {
        expect(toRoutePath('/search?streamingServerUrl=x&search=a&search=b')).toBe('/search?search=a');
    });

    test('a very long search is dropped', () => {
        expect(toRoutePath(`/search?search=${'a'.repeat(201)}`)).toBe('/search');
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
