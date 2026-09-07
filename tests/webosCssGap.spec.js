const fs = require('fs');
const path = require('path');
const less = require('less');

jest.mock('thread-loader', () => ({ ...jest.requireActual('thread-loader'), warmup: jest.fn() }));

const createConfig = require('../webpack.config');

const screenSizesPath = path.resolve(__dirname, '..', 'src', 'common', 'screen-sizes.less');
const screenSizes = fs.readFileSync(screenSizesPath, 'utf8');

const render = (body, webos) => less.render(`${screenSizes}
.fixture {
    ${body}
}`, {
    modifyVars: { webos: webos ? 'true' : 'false' },
});

const getLessOptions = (env) => {
    const config = createConfig(env, { mode: 'production' });
    const lessRule = config.module.rules.find((rule) => rule.test.test('fixture.less'));
    return lessRule.use.find((item) => item.loader === 'less-loader').options.lessOptions;
};

test.each([
    ['desktop', {}, 'false'],
    ['webOS', { WEBOS: '1' }, 'true'],
])('%s injects the expected LESS build flag', (_name, env, expected) => {
    expect(getLessOptions(env).modifyVars).toEqual({ webos: expected });
});

test('desktop keeps native flex gap without fallback margins', async () => {
    const result = await render('.tv-flex-gap(1rem, 1rem, column);', false);

    expect(result.css).toContain('gap: 1rem 1rem;');
    expect(result.css).not.toContain('margin-top: 1rem;');
});

test('webOS adds a column fallback while retaining the native declaration', async () => {
    const result = await render('.tv-flex-gap(1rem, 1rem, column);', true);

    expect(result.css).toContain('gap: 1rem 1rem;');
    expect(result.css).toContain('margin-top: 1rem;');
    expect(result.css).toContain('margin-left: 0;');
});

test('webOS preserves a horizontal-only shorthand fallback', async () => {
    const result = await render('.tv-flex-gap(0, 0.5rem, row);', true);

    expect(result.css).toContain('gap: 0 0.5rem;');
    expect(result.css).toContain('margin-left: 0.5rem;');
    expect(result.css).toContain('margin-top: 0;');
});

test('webOS expands wrapped flex lines by the horizontal gap', async () => {
    const result = await render('.tv-flex-gap-wrap(1rem, 0.5rem);', true);

    expect(result.css).toContain('gap: 1rem 0.5rem;');
    expect(result.css).toContain('margin-right: -0.5rem;');
    expect(result.css).toContain('margin-bottom: -1rem;');
    expect(result.css).toContain('margin-right: 0.5rem;');
    expect(result.css).toContain('margin-bottom: 1rem;');
});
