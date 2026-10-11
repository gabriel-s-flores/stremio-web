#!/usr/bin/env node
// Test add-on of the Player remote (F5.7): one series with two episodes whose streams are files of
// the media server, with the same bingeGroup, so the core gives the Player a next video that plays
// straight away (deepLinks.player: next_stream_update in stremio-core needs a binge match).
//
//   node webos/tests/player-remote/addon.mjs --media http://10.0.2.2:<media port> [--port N] [--info file.json]
//
// Listens on 127.0.0.1 (the emulator reaches it as 10.0.2.2). Files: EPISODE_FILES below, served by
// webos/tools/media-server.mjs through /redirect/ (302, like a debrid link).

import http from 'node:http';
import fs from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
};
const MEDIA = option('--media', 'http://10.0.2.2:8099').replace(/\/$/, '');
const PORT = Number(option('--port', '0'));
const INFO = option('--info', null);
const HOST = option('--host', '10.0.2.2');

const SERIES_ID = 'tt9100001';
const BINGE_GROUP = 'f57-test-1080p';
export const EPISODE_FILES = { 1: 'ep1_10min.mp4', 2: 'ep2_90s.mp4' };

const manifest = {
    id: 'io.github.gabrielsflores.f57-test',
    version: '1.0.0',
    name: 'F5.7 teste',
    description: 'Série de teste do controle no Player (F5.7)',
    resources: ['meta', 'stream'],
    types: ['series'],
    idPrefixes: ['tt91'],
    catalogs: [],
};

const episodeStream = (episode) => ({
    url: `${MEDIA}/redirect/${EPISODE_FILES[episode]}`,
    name: 'F5.7\n1080p',
    description: `Episódio ${episode} (${EPISODE_FILES[episode]})`,
    behaviorHints: { bingeGroup: BINGE_GROUP },
});

const meta = {
    id: SERIES_ID,
    type: 'series',
    name: 'F5.7 Série de teste',
    description: 'Dois episódios servidos pelo media-server.mjs.',
    releaseInfo: '2020',
    videos: Object.keys(EPISODE_FILES).map((episode) => ({
        id: `${SERIES_ID}:1:${episode}`,
        season: 1,
        episode: Number(episode),
        title: `Episódio ${episode}`,
        released: '2020-01-0' + episode + 'T00:00:00.000Z',
    })),
};

const json = (response, body) => {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify(body));
};

const server = http.createServer((request, response) => {
    const url = decodeURIComponent(request.url.split('?')[0]);
    console.log(new Date().toISOString(), request.method, url);
    if (url === '/manifest.json') return json(response, manifest);
    if (url === `/meta/series/${SERIES_ID}.json`) return json(response, { meta });
    const stream = /^\/stream\/series\/tt9100001:1:(\d+)\.json$/.exec(url);
    if (stream) return json(response, { streams: EPISODE_FILES[stream[1]] ? [episodeStream(stream[1])] : [] });
    response.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    response.end();
});

server.listen(PORT, '127.0.0.1', () => {
    const port = server.address().port;
    const info = { port, manifestUrl: `http://${HOST}:${port}/manifest.json`, seriesId: SERIES_ID, bingeGroup: BINGE_GROUP, files: EPISODE_FILES, media: MEDIA };
    console.log(JSON.stringify(info));
    if (INFO) fs.writeFileSync(INFO, JSON.stringify(info));
});
