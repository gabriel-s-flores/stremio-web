// src/core/createTransport.webos.js puts the localStorage mirror (F3.5) around the core init. It relies
// on how upstream creates and starts the transport and on how "Clear data" wipes the storage; if
// upstream changes any of that, the override must follow.
const fs = require('fs');
const path = require('path');

const CORE = path.resolve(__dirname, '..', '..', '..', 'src', 'core');
const read = (file) => fs.readFileSync(path.join(CORE, file), 'utf8');

describe('createTransport.webos', () => {
    test('wraps the upstream transport and waits for the mirror before init', () => {
        const source = read('createTransport.webos.js');
        expect(source).toContain("require('./createTransport.ts').default");
        expect(source).toMatch(/const boot = mirror\.start\(\);/);
        expect(source).toMatch(/boot\s*\.then\([\s\S]*transport\.init\(args\)/);
        expect(source).toMatch(/mirror\.initSucceeded\(\)/);
        expect(source).toMatch(/mirror\.initFailed\(\)/);
        expect(source).toContain('return { ...transport, init };');
    });

    test('upstream: the transport is created at import time and init runs once, after the first render', () => {
        expect(read('createTransport.ts')).toMatch(/export default createTransport;/);
        expect(read('createTransport.ts')).toMatch(/const init = \(args: object\): Promise<void> => \{\s*return bridge\.call\(\['init'\], \[args\]\);/);
        const provider = read('CoreProvider.tsx');
        expect(provider).toContain("import createTransport from './createTransport';");
        expect(provider).toMatch(/^const transport = createTransport\(\);$/m);
        expect(provider).toMatch(/transport\s*\.init\(props\.appInfo\)/);
    });

    test('upstream: "Clear data" is localStorage.clear() then reload(), which the mirror intercepts', () => {
        const source = read(path.join('Error', 'Error.tsx'));
        expect(source).toMatch(/window\.localStorage\.clear\(\);\s*window\.location\.reload\(\);/);
    });
});
