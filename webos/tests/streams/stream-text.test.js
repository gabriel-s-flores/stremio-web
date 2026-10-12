/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, beforeAll, afterAll */
// F8.3 (review c1, finding 2): Stream.webos.js passes the addon name, the name and the description
// through tvText. jsdom has no 2D canvas, so the emoji stay as they came and only the entities change;
// without the tvText call in Stream.webos.js the text would show `&apos;`.

const { createHarness } = require('./render-setup');

let list;

beforeAll(() => {
    list = createHarness('text');
});

afterAll(() => {
    list.cleanup();
});

describe('Stream on webOS: text for the TV', () => {
    it('decodes the entities of the name, the description and the addon name, and keeps the emoji', async () => {
        const stream = Object.assign({}, list.addonStreams[0], {
            name: '[RD+] Tom &amp; Jerry\n4k',
            description: 'Film.O&apos;Neill.2160p.mp4\n👤 30 💾 14 GB ⚙️ 1337x',
        });
        await list.render([{ addon: { transportUrl: 'http://addon/manifest.json', manifest: { name: 'Addon &amp; Co' } }, content: { type: 'Ready', content: [stream] } }]);
        const item = list.items()[0];
        expect(item.querySelector('.info-container').textContent).toBe('[RD+] Tom & Jerry\n4k');
        expect(item.querySelector('.description-text').textContent).toBe('Film.O\'Neill.2160p.mp4\n👤 30 💾 14 GB ⚙️ 1337x');
        expect(item.textContent).not.toContain('&apos;');
    });
});
