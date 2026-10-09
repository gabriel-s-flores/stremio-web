#!/usr/bin/env node
// Envia teclas do controle remoto ao emulador webOS TV pela porta 19001
// (serviço usado pelo launcher Java da LG): uma conexão por tecla, com o
// código em decimal. O app recebe o keydown como na TV (BACK -> 461, RED -> 403).
//
//   node remote.mjs RIGHT RIGHT OK BACK
//   node remote.mjs --delay 600 HOME
import net from 'node:net';

const KEYS = {
    POWER: 101, MENU: 102, TV_RAD: 204, CC: 202, SETTINGS: 501, SEARCH: 402, INPUT: 203,
    '1': 301, '2': 302, '3': 303, '4': 304, '5': 305, '6': 306, '7': 307, '8': 308, '9': 309, '0': 310,
    LIST: 311, QVIEW: 312, FAV: 404, INFO: 711, MUTE: 406, GUIDE: 510, HOME: 502,
    UP: 504, LEFT: 505, OK: 506, RIGHT: 507, DOWN: 508, BACK: 509, EXIT: 511,
    SAP: 710, REC: 709, STOP: 704, REWIND: 707, PLAY: 705, PAUSE: 706, FASTFORWARD: 708,
    RED: 601, GREEN: 602, YELLOW: 603, BLUE: 604,
    VOLUMEUP: 401, VOLUMEDOWN: 405, CHANNELUP: 403, CHANNELDOWN: 407,
};

const args = process.argv.slice(2);
let host = '127.0.0.1';
let port = Number(process.env.EMU_REMOTE_PORT || 19001);
let delay = 400;
const keys = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host') host = args[++i];
    else if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i] === '--delay') delay = Number(args[++i]);
    else keys.push(args[i].toUpperCase());
}
if (keys.length === 0) {
    console.error(`uso: remote.mjs [--delay ms] TECLA...\nteclas: ${Object.keys(KEYS).join(' ')}`);
    process.exit(1);
}

function sendKey(code) {
    return new Promise((resolve, reject) => {
        // No emulador 4.0 o serviço não responde ao "HELLO" do launcher; o código basta.
        const socket = net.connect(port, host, () => socket.end(String(code)));
        socket.setTimeout(3000, () => socket.destroy(new Error('timeout no controle remoto')));
        socket.on('close', () => resolve());
        socket.on('error', reject);
    });
}

for (const key of keys) {
    const code = KEYS[key] ?? (Number.isInteger(Number(key)) ? Number(key) : undefined);
    if (code === undefined) {
        console.error(`tecla desconhecida: ${key}`);
        process.exit(1);
    }
    await sendKey(code);
    console.log(`${key} (${code})`);
    await new Promise((r) => setTimeout(r, delay));
}
