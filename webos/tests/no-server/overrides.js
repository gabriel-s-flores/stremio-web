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
            '// streaming server version, plus the "Diagnostics" entry (F3.6) that opens #/webos-diagnostics.',
            '// webos/tests/no-server/no-server.test.js fails when the two drift apart.',
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
            ["import { useTranslation } from 'react-i18next';\n", "import { useTranslation } from 'react-i18next';\nimport { useNavigate } from 'react-router';\n"],
            // English only, like the screen it opens (a developer tool); a constant keeps it out of the i18n scan.
            ["import styles from './Menu.less';\n", "import styles from './Menu.less';\n\nconst DIAGNOSTICS_LABEL = 'Diagnostics';\n"],
            [
                '    const platform = usePlatform();\n',
                `    const platform = usePlatform();
    const navigate = useNavigate();
    const onDiagnosticsClick = React.useCallback(() => navigate('/webos-diagnostics'), [navigate]);
`,
            ],
            [
                `            <div className={styles['spacing']} />`,
                `            <Button className={styles['button']} title={DIAGNOSTICS_LABEL} onClick={onDiagnosticsClick}>
                {DIAGNOSTICS_LABEL}
            </Button>

            <div className={styles['spacing']} />`,
            ],
        ],
    },
    {
        upstream: 'src/core/createTransport.ts',
        override: 'src/core/createTransport.webos.ts',
        banner: [
            '// webOS TV 4.x build only (resolved instead of createTransport.ts by webos/webpack/app.js, F3.6).',
            '// Same as createTransport.ts plus two boot marks for the diagnostics screen (core init start and',
            '// core ready, just timestamps) and getCoreLoaderStatus: the status of the core loader that runs in',
            '// the worker (webos/core/loader.js), read on demand. webos/tests/no-server/no-server.test.js',
            '// fails when the two drift apart.',
            '',
        ].join('\n'),
        edits: [
            [
                "import Bridge from '@stremio/stremio-core-web/bridge';\n",
                "import Bridge from '@stremio/stremio-core-web/bridge';\nimport { mark } from '../../webos/lib/diagnostics/registry';\n",
            ],
            [
                'const createTransport = (): CoreTransport => {',
                'const createTransport = (): CoreTransport & { getCoreLoaderStatus: () => Promise<object> } => {',
            ],
            [
                "        return bridge.call(['init'], [args]);\n",
                `        mark('coreInitStart');
        return bridge.call(['init'], [args]).then(() => {
            mark('coreReady');
        });
`,
            ],
            [
                "    return {\n        init,",
                `    const getCoreLoaderStatus = (): Promise<object> => {
        return bridge.call(['getCoreLoaderStatus'], []);
    };

    return {
        getCoreLoaderStatus,
        init,`,
            ],
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
