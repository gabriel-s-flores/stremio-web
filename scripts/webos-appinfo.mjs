import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function lgVersion(version) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
    if (!match) throw new Error(`Invalid package semver: ${version}`);
    return match.slice(1, 4).join('.');
}
export function appInfo() {
    const info = JSON.parse(fs.readFileSync(path.join(root, 'webos/appinfo.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return { ...info, version: lgVersion(pkg.version) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    fs.writeFileSync(path.join(root, 'webos/appinfo.json'), `${JSON.stringify(appInfo(), null, 4)}\n`);
    console.log(`appinfo version synchronized: ${appInfo().version}`);
}
