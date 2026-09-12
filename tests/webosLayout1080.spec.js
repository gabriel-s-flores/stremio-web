const fs = require('fs');
const { compile } = require('./helpers/compileFocusLess');

test('TV viewport stays fixed even in browsers with dynamic viewport support', async () => {
    const css = await compile('App/styles.less', true);
    expect(css).toContain('--small-viewport-width: 1920px');
    expect(css).toContain('--small-viewport-height: 1080px');
    expect(css).toMatch(/html\s*\{[^}]*width: 1920px;[^}]*height: 1080px;/);
    expect(css).not.toMatch(/\b(?:env|min|max|clamp)\s*\(|\d(?:d|s|l)v[wh]/);
    expect(css).toMatch(/html\s*\{\s*font-size: 15px;/);
});

test.each([0, 10, 48, 96])('overscan %ipx is calculated by LESS, including both clamps', async (inset) => {
    const override = `\n@webos-overscan-horizontal: ${inset}px;\n@webos-overscan-vertical: 36px;`;
    for (const [file, declaration] of [
        ['App/styles.less', `--safe-area-inset-left: ${inset}px;`],
        ['components/NavBar/HorizontalNavBar/styles.less', `margin-left: ${Math.max(0, 15 - inset)}px;`],
        ['routes/MetaDetails/styles.less', `padding-left: ${Math.max(15, 60 - inset)}px;`],
    ]) {
        const css = await compile(file, true, fs.readFileSync(`src/${file}`, 'utf8') + override);
        expect(css).toContain(declaration);
        expect(css).not.toMatch(/\b(?:env|min|max|clamp)\s*\(/);
        if (file === 'App/styles.less') expect(css.match(/--safe-area-inset-bottom: 36px;/g)).toHaveLength(2);
    }
});

test.each(['components/SearchBar/styles.less', 'routes/Settings/Menu/Menu.less', 'routes/Intro/styles.less'])
('primary typography is build gated: %s', async (file) => {
    expect(await compile(file, true)).toContain('font-size: 22px;');
    expect(await compile(file, false)).not.toContain('font-size: 22px;');
});

test.each(['routes/Search/styles.less', 'routes/Settings/Settings.less'])
('route width accounts for the existing shell margins: %s', async (file) => {
    expect(await compile(file, true)).toContain('width: calc(100% - var(--safe-area-inset-left) - var(--safe-area-inset-right));');
    expect(await compile(file, false)).not.toContain('width: calc(100% - var(--safe-area-inset-left) - var(--safe-area-inset-right));');
});
