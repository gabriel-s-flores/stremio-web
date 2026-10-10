// The webOS overrides of upstream files that cannot be wrapped (F6.1, plan D4). Each one is the
// upstream file with the exact edits below: this module generates the files
// (`node webos/tests/no-server/overrides.js --write`) and no-server.test.js compares them, so it
// fails when upstream changes under an override (re-run --write and review the diff).
// `edits` are [from, to] pairs applied to the upstream source; `from` must match exactly once.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const OVERRIDES = [
    {
        upstream: 'src/components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.js',
        override: 'src/components/NavBar/HorizontalNavBar/NavMenu/NavMenuContent.webos.js',
        banner: [
            '// webOS TV 4.x build only (resolved instead of NavMenuContent.js by webos/webpack/app.js, F6.1).',
            '// Same as NavMenuContent.js without the streaming server warning offset and the "Play URL / magnet',
            '// link" entry (magnets need the streaming server; the TV has no clipboard to read a URL from).',
            '// webos/tests/no-server/no-server.test.js fails when the two drift apart.',
            '',
        ].join('\n'),
        edits: [
            [
                "const { default: usePlayUrl } = require('stremio/common/usePlayUrl');\nconst useToast = require('stremio/common/Toast/useToast');\n",
                '',
            ],
            ["const useStreamingServer = require('stremio/common/useStreamingServer');\n", ''],
            ['    const streamingServer = useStreamingServer();\n    const { handlePlayUrl } = usePlayUrl();\n    const toast = useToast();\n', ''],
            [
                `    const streamingServerWarningDismissed = React.useMemo(() => {
        return streamingServer.settings !== null && streamingServer.settings.type === 'Ready' || (
            !isNaN(profile.settings.streamingServerWarningDismissed.getTime()) &&
            profile.settings.streamingServerWarningDismissed.getTime() > Date.now()
        );
    }, [profile.settings, streamingServer.settings]);
`,
                '',
            ],
            [
                `    const onPlayMagnetLinkClick = React.useCallback(async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            const handled = await handlePlayUrl(clipboardText);
            if (!handled) {
                toast.show({
                    type: 'error',
                    title: 'Clipboard does not contain a valid URL or magnet link.',
                    timeout: 5000
                });
            }
        } catch(e) {
            console.error(e);
        }
    }, [handlePlayUrl]);
`,
                '',
            ],
            [
                "className={classnames(styles['nav-menu-container'], 'animation-fade-in', { [styles['with-warning']]: !streamingServerWarningDismissed } )}",
                "className={classnames(styles['nav-menu-container'], 'animation-fade-in')}",
            ],
            [
                `                <Button className={styles['nav-menu-option-container']} title={ t('PLAY_URL_MAGNET_LINK') } onClick={onPlayMagnetLinkClick}>
                    <Icon className={styles['icon']} name={'magnet-link'} />
                    <div className={styles['nav-menu-option-label']}>{ t('PLAY_URL_MAGNET_LINK') }</div>
                </Button>
`,
                '',
            ],
        ],
    },
    {
        upstream: 'src/routes/Settings/Menu/Menu.tsx',
        override: 'src/routes/Settings/Menu/Menu.webos.tsx',
        banner: [
            '// webOS TV 4.x build only (resolved instead of Menu.tsx by webos/webpack/app.js, F6.1).',
            '// Same as Menu.tsx without the "Streaming" entry (the section is not rendered on webOS) and the',
            '// streaming server version. webos/tests/no-server/no-server.test.js fails when the two drift apart.',
            '',
        ].join('\n'),
        edits: [
            [
                `            <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.STREAMING })} title={t('SETTINGS_NAV_STREAMING')} data-section={SECTIONS.STREAMING} onClick={onSelect}>
                { t('SETTINGS_NAV_STREAMING') }
            </Button>
`,
                '',
            ],
            [
                `            {
                settings?.serverVersion &&
                    <div className={styles['version-info-label']} title={settings.serverVersion}>
                        {t('SETTINGS_SERVER_VERSION')}: {settings.serverVersion}
                    </div>
            }
`,
                '',
            ],
            [
                `    const settings = useMemo(() => (
        streamingServer?.settings?.type === 'Ready' ?
            streamingServer.settings.content as StreamingServerSettings : null
    ), [streamingServer?.settings]);

`,
                '',
            ],
            ["import React, { useMemo } from 'react';", "import React from 'react';"],
            ['    streamingServer: StreamingServer,\n', ''],
            ['({ selected, streamingServer, onSelect }: Props)', '({ selected, onSelect }: Props)'],
        ],
    },
];

const apply = ({ upstream, banner, edits }) => {
    let source = fs.readFileSync(path.join(ROOT, upstream), 'utf8');
    edits.forEach(([from, to]) => {
        const count = source.split(from).length - 1;
        if (count !== 1) {
            throw new Error(`${upstream}: expected exactly one match of ${JSON.stringify(from.slice(0, 60))}, found ${count}`);
        }
        source = source.replace(from, () => to);
    });
    // The banner goes after the copyright line when the file starts with one.
    const [first, ...rest] = source.split('\n');
    return first.startsWith('//') ? `${first}\n\n${banner}${rest.join('\n').replace(/^\n/, '\n')}` : `${banner}\n${source}`;
};

module.exports = { ROOT, OVERRIDES, apply };

if (require.main === module && process.argv.includes('--write')) {
    OVERRIDES.forEach((entry) => {
        fs.writeFileSync(path.join(ROOT, entry.override), apply(entry));
        console.log(`wrote ${entry.override}`);
    });
}
