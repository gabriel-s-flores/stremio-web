// Cliente do "remocon" do webOS TV Emulator (TCP 19001).
// Protocolo extraido via javap do RCU do SDK (LG_webOS_TV_Emulator_win.jar,
// classes com.webossdk.remocon.*): para CADA tecla,
//   1. abre conexao TCP em <host>:19001
//   2. envia o codigo da tecla como string decimal ASCII (sem newline)
//   3. fecha a conexao
// (Long press: envia "<code>|long". O handshake HELLO/FINE de RemoconSocket
// nao e usado no caminho de envio de teclas.)
// Codigos (iguais nas skins RCU 2013/2018): BACK=509, HOME=502, EXIT=511,
//   UP=504, DOWN=508, LEFT=505, RIGHT=507, OK=506, RED=601..BLUE=604,
//   QMENU=703, STOP=704, PLAY=705, PAUSE=706, REWIND=707, FASTFIND=708, INFO=711
//
// Uso:
//   node rcu.mjs BACK            -> uma tecla
//   node rcu.mjs BACK BACK OK    -> sequencia (com pequeno intervalo)
//   node rcu.mjs 509             -> codigo numerico direto tambem funciona
//
// A porta 19001 do emulador ja e encaminhada pelo NAT do VirtualBox
// (127.0.0.1:19001). Use RCU_HOST/RCU_PORT para apontar para outra TV.

import net from 'node:net';

const HOST = process.env.RCU_HOST || '127.0.0.1';
const PORT = Number(process.env.RCU_PORT || 19001);

const KEYS = {
	BACK: 509, HOME: 502, EXIT: 511,
	UP: 504, DOWN: 508, LEFT: 505, RIGHT: 507, OK: 506,
	RED: 601, GREEN: 602, YELLOW: 603, BLUE: 604,
	QMENU: 703, STOP: 704, PLAY: 705, PAUSE: 706,
	REWIND: 707, FASTFIND: 708, INFO: 711, MENU: 102, POWER: 101,
};

function keyCode(token) {
	if (/^\d+$/.test(token)) return token;
	const code = KEYS[token.toUpperCase()];
	if (code === undefined) {
		throw new Error(`tecla desconhecida: ${token} (conhecidas: ${Object.keys(KEYS).join(', ')})`);
	}
	return String(code);
}

function sendOne(code) {
	return new Promise((resolve, reject) => {
		const sock = new net.Socket();
		const timer = setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 5000);
		sock.on('error', (e) => { clearTimeout(timer); reject(e); });
		sock.connect(PORT, HOST, () => {
			sock.write(code, () => {
				clearTimeout(timer);
				sock.end();
				resolve();
			});
		});
	});
}

async function sendKeys(codes) {
	for (const code of codes) {
		console.log(`>> ${code}`);
		await sendOne(code);
		await new Promise((r) => setTimeout(r, 350));
	}
}

const args = process.argv.slice(2);
if (args.length === 0) {
	console.log('uso: node rcu.mjs <TECLA|--lista> [TECLA...]   ex.: node rcu.mjs BACK');
	console.log('teclas:', Object.keys(KEYS).join(', '));
	process.exit(args[0] === '--lista' ? 0 : 1);
}

try {
	const codes = args.map(keyCode);
	await sendKeys([...codes]);
} catch (e) {
	console.error('ERRO:', e.message);
	process.exit(1);
}
