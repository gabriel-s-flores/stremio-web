const fs = require('fs');
const path = require('path');
const less = require('less');

const root = path.resolve(__dirname, '../..');
const aliases = {
    install(instance, manager) {
        const resolver = new instance.FileManager();
        resolver.supports = (filename) => filename.startsWith('~');
        resolver.loadFile = (name) => {
            const filename = name.startsWith('~stremio/')
                ? path.join(root, 'src', name.slice(9))
                : name.startsWith('~stremio-router/')
                    ? path.join(root, 'src/router', name.slice(16))
                    : require.resolve(name.slice(1), { paths: [root] });
            return Promise.resolve({ filename, contents: fs.readFileSync(filename, 'utf8') });
        };
        manager.addFileManager(resolver);
    },
};

async function compile(file, webos, source) {
    const filename = path.join(root, 'src', file);
    const { css } = await less.render(source === undefined ? fs.readFileSync(filename, 'utf8') : source, {
        filename, plugins: [aliases], strictMath: true, ieCompat: false,
        modifyVars: { webos: String(webos) },
    });
    // Ignore comments/blank lines only; every emitted rule and declaration is retained.
    return css.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((line) => line.trim()).join('\n');
}

module.exports = { compile, root };
