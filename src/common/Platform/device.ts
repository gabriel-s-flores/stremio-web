import Bowser from 'bowser';

const APPLE_MOBILE_DEVICES = [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod',
];

const safeNavigator = typeof navigator === 'undefined' ? {} : navigator || {};
const { userAgent = '', platform = '', maxTouchPoints = 0 } = safeNavigator;

const WEBOS_USER_AGENT = /Web0S|WebOS|WebAppManager|SmartTV/i;

// Vision Pro uniquely supports the WebXR Device API (navigator.xr),
// while iPads and iPhones do not — this is the most reliable discriminator.
// Both Vision Pro and iPads (iPadOS 13+) report 'Macintosh' in the UA
// and have maxTouchPoints > 1, so we cannot rely on those alone.
const isMacLikeWithTouch = userAgent.includes('Macintosh') && maxTouchPoints > 1;
const isVisionOS = isMacLikeWithTouch && 'xr' in safeNavigator;

// Detect iOS/iPadOS devices:
// - Older iPads expose 'iPad' in navigator.platform
// - iPadOS 13+ exposes 'MacIntel' but has touch support ('ontouchend' in document)
// - Exclude Vision OS devices which also pass the touch check
const isIOS = !isVisionOS && (
    APPLE_MOBILE_DEVICES.includes(platform) ||
    (userAgent.includes('Mac') && typeof document !== 'undefined' && document !== null && 'ontouchend' in document)
);

const os = userAgent ? Bowser.getParser(userAgent).getOSName().toLowerCase() : '';
const isWebOS = WEBOS_USER_AGENT.test(userAgent);

const name = isVisionOS ? 'visionos' : isIOS ? 'ios' : isWebOS ? 'webos' : os || 'unknown';
const isMobile = ['ios', 'android'].includes(name);
const isTV = name === 'webos';

export {
    name,
    isMobile,
    isTV,
};
