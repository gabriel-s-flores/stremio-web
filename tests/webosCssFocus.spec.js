const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compile, root } = require('./helpers/compileFocusLess');
const baseline = require('./webos/t25-desktop-css-baseline.json');

test.each(Object.keys(baseline.files))('desktop CSS is unchanged: %s', async (file) => {
    const css = await compile(file, false);
    expect(crypto.createHash('sha256').update(css).digest('hex')).toBe(baseline.files[file]);
});

test('TV mixin is build gated and does not change the shared border token', async () => {
    const source = "@import (reference) '~stremio/common/tv-focus.less'; .control { .tv-focus(); }";
    expect(await compile('App/styles.less', false, source)).toBe('');
    const tv = await compile('App/styles.less', true, source);
    expect(tv).toMatch(/\.control:focus\s*\{/);
    expect(tv).toContain('outline: 4px solid #fff;');
    expect(tv).toContain('outline-offset: -4px;');
    expect(tv).not.toMatch(/!important|transform|transition|scale|border:/);
    expect(await compile('App/styles.less', true)).toContain('--focus-outline-size: 2px;');
});

test('ActionsGroup emits independent focus selectors for the two builds', async () => {
    const file = 'components/ActionsGroup/ActionsGroup.less';
    expect(await compile(file, true)).not.toContain(':focus-visible');
    expect(await compile(file, true)).toMatch(/\.group-container \.icon-container:focus\s*\{\s*outline: 4px solid #fff;/);
    expect(await compile(file, false)).toContain(':focus-visible');
});

test.each(['Checkbox/Checkbox', 'RadioButton/RadioButton'])('%s delegates hidden input focus to its visible wrapper', async (name) => {
    const css = await compile(`components/${name}.less`, true);
    expect(css).toMatch(/:focus-within\s*\{\s*outline: 4px solid #fff;/);
    expect(css).not.toMatch(/input[^{}]*\{[^{}]*outline: 4px/);
});

test('radio focus does not inherit transition: all on TV', async () => {
    const css = await compile('components/RadioButton/RadioButton.less', true);
    expect(css).toMatch(/\.radio-button \.radio-container\s*\{\s*transition-property: background-color, border-color;/);
});

test('SearchBar and MetaItem delegate focus without changing border dimensions', async () => {
    const search = await compile('components/SearchBar/styles.less', true);
    expect(search).toMatch(/:focus-within\s*\{\s*border-color: transparent;\s*outline: 4px/);
    expect(search).toMatch(/\.search-input:focus\s*\{\s*outline: none;/);
    const poster = await compile('components/MetaItem/styles.less', true);
    expect(poster).toMatch(/\.meta-item-link:focus \.poster-container\s*\{\s*box-shadow: none;\s*outline: 4px/);
    expect(poster).toMatch(/\.menu-label-container:focus\s*\{\s*outline: 4px/);
});

test('all TV focus users are covered by the desktop baseline', () => {
    const users = fs.readdirSync(path.join(root, 'src'), { recursive: true })
        .filter((file) => file.endsWith('.less'))
        .map((file) => file.replaceAll('\\', '/'))
        .filter((file) => /~stremio\/common\/tv-focus.less|without animating the TV outline/.test(fs.readFileSync(path.join(root, 'src', file), 'utf8')));
    expect(users.sort()).toEqual(Object.keys(baseline.files).sort());
});
