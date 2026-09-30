// Isolated WEBOS_DEBUG fixture using the actual Platform, links and global modal.
// No core is started, so packaged file:// WASM restrictions do not mask this seam.
require('spatial-navigation-polyfill');
require('../src/App/styles.less');
const React = require('react');
const { createRoot } = require('react-dom/client');
const i18next = require('i18next');
const { initReactI18next } = require('react-i18next');
const { PlatformProvider } = require('../src/common/Platform');
const { default: ExternalLinksDebugPage } = require('../src/webos/diagnostics/ExternalLinksDebugPage');
const ExternalLinkFailureModal = require('../src/App/ExternalLinkFailureModal');
if (!process.env.WEBOS_DEBUG) throw Error('WEBOS_DEBUG required');
i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: { BUTTON_CLOSE: 'Close' } } }, initImmediate: false });
location.hash = '#/debug/external-links';
createRoot(document.getElementById('app')).render(
    <PlatformProvider>
        <React.Fragment>
            <ExternalLinksDebugPage />
            <ExternalLinkFailureModal />
        </React.Fragment>
    </PlatformProvider>
);
