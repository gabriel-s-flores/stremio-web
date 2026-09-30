const fs = require('fs');
const path = require('path');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        return walk(file);
    }
    return /\.[jt]sx?$/.test(file) ? [file.replace(/\\/g, '/')] : [];
});

// Approved helpers: the single Clipboard seam owns navigator.clipboard and
// document.execCommand. The legacy entry point only re-exports the seam.
const APPROVED_CLIPBOARD_ACCESS = new Set([
    'src/common/clipboard.js',
]);

// Native paste only: guarded clipboardData access without any modal.
const APPROVED_PASTE_ACCESS = new Set([
    'src/components/NavBar/HorizontalNavBar/SearchBar/SearchBar.js',
]);

test('direct Clipboard access stays inside the approved seam', () => {
    const violations = [];
    for (const file of walk('src')) {
        const source = fs.readFileSync(file, 'utf8');
        if (/navigator\s*\.\s*clipboard/.test(source) && !APPROVED_CLIPBOARD_ACCESS.has(file)) {
            violations.push(`${file}: navigator.clipboard`);
        }
        if (/document\s*\.\s*execCommand\s*\(/.test(source) && !APPROVED_CLIPBOARD_ACCESS.has(file)) {
            violations.push(`${file}: document.execCommand`);
        }
        if (/clipboardData/.test(source) && !APPROVED_PASTE_ACCESS.has(file)) {
            violations.push(`${file}: clipboardData`);
        }
    }
    expect(violations).toEqual([]);
});

test('approved seam exposes the single write/read/selection contract', () => {
    const seam = fs.readFileSync('src/common/clipboard.js', 'utf8');
    expect(seam).toMatch(/writeTextToClipboard/);
    expect(seam).toMatch(/readTextFromClipboard/);
    expect(seam).toMatch(/copyTextBySelection/);
    expect(seam).not.toMatch(/console\.(log|error|warn|info)/);
    expect(seam).not.toMatch(/Sentry|captureException|analytics|transport\./);

    const legacy = fs.readFileSync('src/common/writeTextToClipboard.js', 'utf8');
    expect(legacy).toMatch(/require\(['"]\.\/clipboard['"]\)/);
    expect(legacy).not.toMatch(/navigator\s*\.\s*clipboard/);
});

test('copy fallbacks never interpolate values into logs or telemetry', () => {
    const suspects = [
        'src/routes/MetaDetails/StreamsList/Stream/Stream.js',
        'src/routes/Player/OptionsMenu/OptionsMenu.js',
        'src/routes/Player/StatisticsMenu/StatisticsMenu.js',
        'src/routes/Player/SubtitlesMenu/SubtitleVariant/SubtitleVariant.tsx',
        'src/components/SharePrompt/SharePrompt.js',
        'src/components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.js',
        'src/components/NavBar/HorizontalNavBar/SearchBar/SearchBar.js',
        'src/routes/Settings/Streaming/Streaming.tsx',
        'src/components/ClipboardFallbackModal/ClipboardFallbackModal.js',
        'src/components/PlayUrlModal/PlayUrlModal.js',
    ];
    const violations = [];
    for (const file of suspects) {
        const source = fs.readFileSync(file, 'utf8');
        if (/console\.(log|error|warn|info)\([^)]*(url|value|clipboard|magnet|token)/i.test(source)) {
            violations.push(`${file}: value in console`);
        }
        if (/Sentry|captureException/.test(source)) {
            violations.push(`${file}: sentry`);
        }
        // Error toasts/messages must not interpolate runtime values (T3.9).
        if (/\$\{(streamingUrl|downloadUrl|magnetUrl|remoteUrl|clipboardText|value|url)\}/.test(source)) {
            // Allowlist: share/analytics and href construction, not error messages.
            const lines = source.split('\n');
            lines.forEach((line, index) => {
                if (/\$\{(streamingUrl|downloadUrl|magnetUrl|remoteUrl|clipboardText|value)\}/.test(line)
                    && /PLAYER_COPY|ERR_|ERROR|toast\.show/i.test(line + lines.slice(index, index + 3).join('\n'))) {
                    violations.push(`${file}:${index + 1}: value in error message`);
                }
            });
        }
    }
    expect(violations).toEqual([]);
});
