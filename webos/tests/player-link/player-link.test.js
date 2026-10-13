// webos/lib/player-link (F8.7): the page builds the player link of a stream of Details, the same bytes the
// core built before webos/core/list-links.patch left it out of the list.
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { encodeStream, playerLink, linkContext, withPlayerLinks, zlibStored } from '../../lib/player-link';

describe('encodeStream and playerLink', () => {
    test('the vector of the core\'s own test (stream_deep_links_http, "stremio://" turned into "#")', () => {
        expect(playerLink({ url: 'http://domain.root/some/path' }, null))
            .toBe('#/player/eAEBJgDZ%2F3sidXJsIjoiaHR0cDovL2RvbWFpbi5yb290L3NvbWUvcGF0aCJ9AYANjw%3D%3D');
    });

    test('the keys the serializer adds around the stream are not part of it', () => {
        const stream = { url: 'http://domain.root/some/path' };
        expect(encodeStream({ ...stream, progress: 0.5, deepLinks: { externalPlayer: {} }, lastUsed: true })).toBe(encodeStream(stream));
    });

    test('with a meta: stream addon, meta addon, type, id and video, each URI-component encoded', () => {
        const link = playerLink({ url: 'http://a/b' }, { streamTransportUrl: 'http://x.example/manifest.json', metaTransportUrl: 'https://v3-cinemeta.strem.io/manifest.json', type: 'series', id: 'tt1', videoId: 'tt1:1:2' });
        expect(link).toBe(`${playerLink({ url: 'http://a/b' }, null)}/http%3A%2F%2Fx.example%2Fmanifest.json/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/series/tt1/tt1%3A1%3A2`);
    });

    test('zlibStored: valid zlib, the blocks of the core (31745 bytes, a last one with the rest, even empty)', () => {
        [0, 1, 19, 1000, 5552, 5553, 31744, 31745, 31746, 63489, 63490, 63491, 200000].forEach((size) => {
            const data = Uint8Array.from({ length: size }, (_, i) => (i * 7 + Math.floor(i / 300)) & 0xff);
            const out = zlibStored(data);
            expect(Buffer.from(zlib.inflateSync(out))).toEqual(Buffer.from(data));
            const blocks = Math.floor(size / 31745) + 1;
            expect(out.length).toBe(2 + blocks * 5 + size + 4);
            // The last block is flagged final: at the end, before the Adler-32.
            expect(out[2 + (blocks - 1) * (5 + 31745)]).toBe(1);
        });
    });
});

describe('the same encoding as the vendored core (encode_stream)', () => {
    let run;
    beforeAll(() => {
        run = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'core-encode.js')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 }));
    }, 150000);

    test('the list has no player link; the trailers keep the core\'s', () => {
        const group = run.metaDetails.streams.find((g) => g.addon.manifest.id === 'test.streams');
        expect(group.content.type).toBe('Ready');
        group.content.content.forEach((stream) => {
            expect(stream.deepLinks).not.toHaveProperty('player');
            expect(stream.deepLinks).toHaveProperty('externalPlayer');
        });
        const trailer = run.metaDetails.metaItem.content.content.trailerStreams[0];
        expect(trailer.deepLinks.player).toMatch(/^#\/player\//);
    });

    test('every stream of the list (url, debrid with emoji and numbers, YouTube, external, subtitles, a long one)', () => {
        const group = run.metaDetails.streams.find((g) => g.addon.manifest.id === 'test.streams');
        expect(group.content.content).toHaveLength(6);
        group.content.content.forEach((stream, index) => {
            expect(encodeStream(stream)).toBe(run.encoded[index]);
        });
    });

    test('withPlayerLinks: the link of a shown stream, from the context of MetaDetails', () => {
        const context = linkContext(run.metaDetails);
        expect(context).toEqual({ metaTransportUrl: 'https://v3-cinemeta.strem.io/manifest.json', type: 'movie', id: 'tt1', videoId: 'tt1' });
        const streams = withPlayerLinks(run.metaDetails.streams, context);
        const group = streams.find((g) => g.addon.manifest.id === 'test.streams');
        const first = group.content.content[0];
        expect(first.deepLinks.player).toBe(`#/player/${encodeURIComponent(run.encoded[0])}/http%3A%2F%2Faddon.example%2Fmanifest.json/https%3A%2F%2Fv3-cinemeta.strem.io%2Fmanifest.json/movie/tt1/tt1`);
        expect(first.deepLinks.externalPlayer).toBe(run.metaDetails.streams.find((g) => g.addon.manifest.id === 'test.streams').content.content[0].deepLinks.externalPlayer);
    });
});

describe('withPlayerLinks', () => {
    const stream = (url) => ({ url, deepLinks: { externalPlayer: { streaming: url } } });
    const ready = (streams, url = 'http://addon/manifest.json') => ({ addon: { transportUrl: url }, content: { type: 'Ready', content: streams } });
    const context = { metaTransportUrl: 'https://meta/manifest.json', type: 'movie', id: 'tt1', videoId: 'tt1' };

    test('the link is built when read, once; the wrapped stream is the same object on every call', () => {
        const raw = stream('http://a/1');
        const streams = [ready([raw])];
        const first = withPlayerLinks(streams, context)[0].content.content[0];
        const descriptor = Object.getOwnPropertyDescriptor(first.deepLinks, 'player');
        expect(typeof descriptor.get).toBe('function');
        expect(first.deepLinks.player).toBe(first.deepLinks.player);
        expect(first.deepLinks.player).toBe(playerLink(raw, { ...context, streamTransportUrl: 'http://addon/manifest.json' }));
        const again = withPlayerLinks(streams, context)[0].content.content[0];
        expect(again).toBe(first);
        expect(again.deepLinks).toBe(first.deepLinks);
        expect(raw.deepLinks).not.toHaveProperty('player');
    });

    test('without a Ready meta: the short link; a new context makes a new one', () => {
        const raw = stream('http://a/2');
        const short = withPlayerLinks([ready([raw])], null)[0].content.content[0];
        expect(short.deepLinks.player).toBe(playerLink(raw, null));
        const full = withPlayerLinks([ready([raw])], context)[0].content.content[0];
        expect(full).not.toBe(short);
        expect(full.deepLinks.player).toMatch(/\/movie\/tt1\/tt1$/);
    });

    test('groups that are not Ready, streams that have a link already and other values stay as they are', () => {
        const loading = { addon: { transportUrl: 'x' }, content: { type: 'Loading' } };
        const withLink = { url: 'u', deepLinks: { player: '#/player/core' } };
        const streams = [loading, ready([withLink, null, 'x'])];
        expect(withPlayerLinks(streams, context)).toBe(streams);
        expect(withPlayerLinks(null, context)).toBeNull();
    });

    test('linkContext: null until a meta is Ready', () => {
        expect(linkContext(null)).toBeNull();
        expect(linkContext({ selected: { metaPath: { type: 'movie', id: 'tt1' }, streamPath: { id: 'tt1' } }, metaItem: { content: { type: 'Loading' } } })).toBeNull();
        expect(linkContext({ selected: { metaPath: { type: 'movie', id: 'tt1' }, streamPath: null }, metaItem: { addon: { transportUrl: 'm' }, content: { type: 'Ready' } } })).toBeNull();
    });
});
