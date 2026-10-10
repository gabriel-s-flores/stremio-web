/**
 * @jest-environment node
 */
const { checkService } = require('../../scripts/check-service');

test('the tlsproxy service is ES5, ca.js matches certs/ and the ids agree with the app id', () => {
    const { files, id, errors } = checkService();
    expect(errors).toEqual([]);
    expect(files).toEqual(expect.arrayContaining(['ca.js', 'proxy.js', 'service.js']));
    expect(id).toBe('io.github.gabrielsflores.stremio.tlsproxy');
});
