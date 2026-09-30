import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appInfo, root } from './webos-appinfo.mjs';

try {
    const [action, ...raw] = process.argv.slice(2);
    const args = raw.filter(arg => arg !== '--');
    const hosted = args.includes('--hosted');
    const devices = args.filter(arg => arg !== '--hosted');
    if (devices.length !== 1 || !devices[0] || devices[0].startsWith('-') || !['deploy', 'launch', 'inspect', 'close'].includes(action)) throw new Error('Usage: <deploy:tv|launch:tv|inspect:tv|close:tv> <device> [--hosted]');
    const info = appInfo();
    const id = info.id + (hosted ? '.hosted' : '');
    const mode = hosted ? 'hosted' : 'packaged';
    const ipk = path.join(root, 'dist-webos/packages', mode, `${id}_${info.version}_all.ipk`);
    if (action === 'deploy' && !fs.existsSync(ipk)) throw new Error(`Missing ${ipk}; run package:webos first`);
    const command = { deploy: 'ares-install', launch: 'ares-launch', close: 'ares-launch', inspect: 'ares-inspect' }[action];
    const cliArgs = ['--device', devices[0], ...(action === 'inspect' ? ['--app', id, '--open'] : action === 'close' ? ['--close', id] : [action === 'deploy' ? ipk : id])];
    const result = spawnSync(command, cliArgs, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
