import WebUpdateScreen from './WebUpdateScreen';
import DisabledWebUpdateScreen from './disabled';

// webOS exposes navigator.serviceWorker even on unsupported origins.
export default window.isSecureContext && /^https?:$/.test(window.location.protocol)
    ? WebUpdateScreen
    : DisabledWebUpdateScreen;
