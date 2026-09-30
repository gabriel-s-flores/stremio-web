const baseUrl = process.env.HOSTED_BASE_URL;
const httpBaseUrl = process.env.HOSTED_HTTP_BASE_URL;
const expectedCommitSha = process.env.EXPECTED_COMMIT_SHA;
const allowHttp = process.env.ALLOW_HTTP === '1';

const fail = (message) => {
    throw new Error(`Hosted deployment verification failed: ${message}`);
};

const assert = (condition, message) => {
    if (!condition) fail(message);
};

const makeUrl = (relativePath) => {
    const url = new URL(baseUrl);
    url.pathname = `/${relativePath.replace(/^\/+/, '')}`;
    url.search = '';
    url.hash = '';
    return url;
};

const get = async (relativePath) => {
    const url = makeUrl(relativePath);
    const response = await fetch(url, { redirect: 'manual' });
    assert(response.status >= 200 && response.status < 300, `${relativePath} returned HTTP ${response.status}`);
    return response;
};

const verifyHttpRedirect = async () => {
    if (!httpBaseUrl) return;

    const parsedHttpBaseUrl = new URL(httpBaseUrl);
    assert(parsedHttpBaseUrl.protocol === 'http:', 'HOSTED_HTTP_BASE_URL must use HTTP');
    assert(parsedHttpBaseUrl.pathname === '/' || parsedHttpBaseUrl.pathname === '', 'HOSTED_HTTP_BASE_URL must point to the host root');

    const response = await fetch(parsedHttpBaseUrl, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const redirectUrl = location ? new URL(location, parsedHttpBaseUrl) : null;
    assert(response.status === 301 || response.status === 308, `HTTP endpoint returned ${response.status}, expected 301 or 308`);
    assert(redirectUrl?.protocol === 'https:', `HTTP endpoint redirects to an unsafe location: ${location || '<missing>'}`);
    assert(redirectUrl.hostname === new URL(baseUrl).hostname, `HTTP endpoint redirects to another host: ${location}`);
};

try {
    assert(baseUrl, 'HOSTED_BASE_URL is required');

    const parsedBaseUrl = new URL(baseUrl);
    assert(parsedBaseUrl.pathname === '/' || parsedBaseUrl.pathname === '', 'HOSTED_BASE_URL must point to the host root');
    assert(allowHttp || parsedBaseUrl.protocol === 'https:', 'hosted deployment must use HTTPS');
    await verifyHttpRedirect();

    const indexResponse = await get('');
    const index = await indexResponse.text();
    assert(!/<%=?/.test(index), 'deployed index.html contains unresolved template markers');

    const hashMatch = index.match(/([a-f0-9]{40})\/scripts\/main\.js/i);
    assert(hashMatch, 'deployed index.html does not reference a commit-scoped main script');
    const commitHash = hashMatch[1];
    if (expectedCommitSha) assert(commitHash === expectedCommitSha, `expected ${expectedCommitSha}, found ${commitHash}`);

    const mainResponse = await get(`${commitHash}/scripts/main.js`);
    const workerResponse = await get(`${commitHash}/scripts/worker.js`);
    const serviceWorkerResponse = await get('service-worker.js');
    await get('manifest.json');

    const serviceWorkerCache = (serviceWorkerResponse.headers.get('cache-control') || '').toLowerCase();
    assert(
        serviceWorkerCache.includes('no-cache') || serviceWorkerCache.includes('max-age=0'),
        `service-worker.js has unsafe cache policy: ${serviceWorkerCache || '<missing>'}`
    );

    const mainCache = (mainResponse.headers.get('cache-control') || '').toLowerCase();
    assert(mainCache.includes('max-age=') && mainCache.includes('immutable'), 'commit-scoped assets are not immutable');

    const localReferences = [...index.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
        .map((match) => match[1])
        .filter((reference) => reference && !/^(?:[a-z]+:|\/\/|#|data:|javascript:)/i.test(reference));

    for (const reference of localReferences) {
        const relativeReference = reference.split(/[?#]/, 1)[0];
        if (!relativeReference) continue;
        assert(!relativeReference.startsWith('/'), `absolute asset reference is not supported: ${reference}`);
        await get(relativeReference);
    }

    console.log(JSON.stringify({
        baseUrl: parsedBaseUrl.origin,
        commitHash,
        checkedReferences: localReferences.length,
        serviceWorkerCache,
        mainCache
    }, null, 2));
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
