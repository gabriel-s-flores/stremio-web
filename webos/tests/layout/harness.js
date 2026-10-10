// Layout page (F2.3): one screen with fixed data per hash, in the same shell as the app (global
// styles, i18n, providers). See webpack.config.js. Hash: #<scene>[?key=value&...]
//   #calendar?first=3&days=31&today=12   #livetv   #stats   #scale   #gamepad

// Chromium 53 has no Intl.NumberFormat style 'unit' (Live TV's schedule formats its durations with
// it and throws there): a stand-in, only so the page can show that screen. A finding of F2.3.
try {
    new Intl.NumberFormat('en', { style: 'unit', unit: 'minute' });
} catch (error) {
    const NumberFormat = Intl.NumberFormat;
    Intl.NumberFormat = function (locales, options) {
        return options && options.style === 'unit' ? { format: (value) => `${value} min` } : new NumberFormat(locales, options);
    };
}

const React = require('react');
const ReactDOM = require('react-dom/client');
const { HashRouter } = require('react-router-dom');
const i18n = require('i18next');
const { initReactI18next } = require('react-i18next');
const stremioTranslations = require('stremio-translations');
// The same order as src/App/App.js: the modules of src/ import each other in a cycle.
require('stremio/core');
require('stremio-router');
require('stremio/services');
const CoreContext = require('stremio/core/CoreContext').default;
const { PlatformProvider, ToastProvider, TooltipProvider } = require('stremio/common');
const { default: Table } = require('stremio/routes/Calendar/Table');
const { default: LiveTvDetails } = require('stremio/routes/MetaDetails/LiveTvDetails');
const StatisticsMenu = require('stremio/routes/Player/StatisticsMenu');
const { default: Scale } = require('stremio/components/Scale');
const { default: GamepadModal } = require('stremio/App/GamepadModal');
const calendarStyles = require('stremio/routes/Calendar/Calendar.less');
const metaDetailsStyles = require('stremio/routes/MetaDetails/styles.less');
const fixtures = require('./fixtures');
require('stremio/App/styles.less');

i18n
    .use(initReactI18next)
    .init({
        resources: Object.fromEntries(Object.entries(stremioTranslations()).map(([key, value]) => [key, { translation: value }])),
        lng: 'en-US',
        fallbackLng: 'en-US',
        interpolation: { escapeValue: false },
    });

const [scene, query = ''] = window.location.hash.slice(1).replace(/^\//, '').split('?');
const params = Object.fromEntries(new URLSearchParams(query).entries());
const number = (name, fallback) => params[name] === undefined ? fallback : Number(params[name]);

// The core only has to take dispatches.
const core = { transport: { dispatch() {}, analytics() {} }, on() {}, off() {} };

const scenes = {
    calendar: () => {
        const { items, monthInfo, selected } = fixtures.calendar({ first: number('first', 3), days: number('days', 31), today: number('today', 12) });
        return (
            <div className={calendarStyles['calendar']} style={{ width: '100%', height: '100%' }}>
                <div className={calendarStyles['content']}>
                    <div className={calendarStyles['main']}>
                        <Table items={items} selected={selected} monthInfo={monthInfo} onChange={() => {}} />
                    </div>
                </div>
            </div>
        );
    },
    livetv: () => {
        const { meta, streams, addonName } = fixtures.liveTv();
        return (
            <LiveTvDetails
                className={metaDetailsStyles['metadetails-container']}
                contentRef={null}
                meta={meta}
                addonName={addonName}
                streams={streams}
                onToggleLibrary={() => {}}
            />
        );
    },
    stats: () => (
        <div style={{ width: 'fit-content', margin: '4rem', background: 'var(--modal-background-color)', borderRadius: 'var(--border-radius)' }}>
            <StatisticsMenu {...fixtures.statistics} />
        </div>
    ),
    scale: () => (
        <div style={{ width: '30rem', margin: '4rem', padding: '1rem', background: 'var(--modal-background-color)' }}>
            <Scale min={50} max={200} step={5} value={100} options={[50, 75, 100, 125, 150, 175, 200]} onChange={() => {}} />
        </div>
    ),
    gamepad: () => <GamepadModal onClose={() => {}} />,
};

// A scene that throws would leave a blank screen: show and record the error instead.
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        window.__layout.error = `${error && error.stack}\n${info && info.componentStack}`;
        console.error(window.__layout.error);
    }

    render() {
        return this.state.error ? <pre style={{ color: '#f66', padding: '1rem' }}>{window.__layout.error}</pre> : this.props.children;
    }
}

const Scene = scenes[scene] || (() => <div>unknown scene: {scene}</div>);

window.__layout = { scene, params };
ReactDOM.createRoot(document.getElementById('app')).render(
    <PlatformProvider>
        <CoreContext.Provider value={core}>
            <ToastProvider>
                <TooltipProvider>
                    <HashRouter>
                        <ErrorBoundary>
                            <Scene />
                        </ErrorBoundary>
                    </HashRouter>
                </TooltipProvider>
            </ToastProvider>
        </CoreContext.Provider>
    </PlatformProvider>
);
