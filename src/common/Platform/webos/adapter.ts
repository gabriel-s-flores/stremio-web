export type WebOSLaunchEvent = {
    type: 'launch' | 'relaunch';
    params: Record<string, unknown>;
};

export type WebOSPlatform = {
    hidden: boolean;
    subscribeLifecycle: (listener: (event: WebOSLaunchEvent) => void) => () => void;
    active: boolean;
    deviceInfo: {
        modelName: string | null;
        sdkVersion: string | null;
    } | null;
    platformBack: () => boolean;
};

type Host = Pick<Window, 'webOS' | 'PalmSystem' | 'webOSDev'>;
const getWindow = (): Host | null => typeof window === 'undefined' ? null : window;
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

const normalize = (value: unknown): WebOSPlatform['deviceInfo'] => {
    if (!value || typeof value !== 'object') return null;
    const info = value as Record<string, unknown>;
    if (info.returnValue === false) return null;
    const modelName = text(info.modelName);
    // version/platformVersion describe firmware, not the SDK.
    const sdkVersion = text(info.sdkVersion);
    return modelName || sdkVersion ? { modelName, sdkVersion } : null;
};

// Resolve globals per operation; disabled builds never even read the host.
const normalizeParams = (value: unknown): Record<string, unknown> | null => {
    try {
        const params = typeof value === 'string' ? JSON.parse(value) : value;
        return params && typeof params === 'object' && !Array.isArray(params) ? params : null;
    } catch { return null; }
};

export const createWebOSAdapter = (
    enabled: boolean,
    resolveHost: () => Host | null = getWindow,
    target: Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'> | null =
        typeof document === 'undefined' ? null : document
) => {
    const host = () => {
        try { return enabled ? resolveHost() : null; } catch { return null; }
    };
    const lifecycle = new Set<(event: WebOSLaunchEvent) => void>();
    const visibility = new Set<() => void>();
    let pending: WebOSLaunchEvent | null = null;
    let launched = false;
    let hidden = enabled && target?.hidden === true;
    const fallback = () => {
        try {
            const current = host();
            const params = normalizeParams(current?.webOSDev?.launchParams?.());
            if (params) return params;
        } catch { /* Try PalmSystem if the development API fails. */ }
        try { return normalizeParams(host()?.PalmSystem?.launchParams); } catch { return null; }
    };
    const emit = (event: WebOSLaunchEvent) => {
        if (!lifecycle.size) pending = event;
        else lifecycle.forEach((listener) => listener(event));
    };
    const onLaunch = (event: Event) => {
        if (launched) return;
        launched = true;
        emit({ type: 'launch', params: normalizeParams((event as CustomEvent).detail) ?? fallback() ?? {} });
    };
    const onRelaunch = (event: Event) => {
        launched = true;
        // An explicit empty detail belongs to this relaunch; never replay stale fallback params.
        emit({ type: 'relaunch', params: normalizeParams((event as CustomEvent).detail) ?? fallback() ?? {} });
    };
    const onVisibility = () => {
        const next = target?.hidden === true;
        if (next === hidden) return;
        hidden = next;
        visibility.forEach((listener) => listener());
    };
    if (enabled && target) {
        target.addEventListener('webOSLaunch', onLaunch, true);
        target.addEventListener('webOSRelaunch', onRelaunch, true);
        target.addEventListener('visibilitychange', onVisibility, true);
    }
    return {
        openBrowser: (url: string, onFailure: () => void) => {
            let failed = false;
            const fail = () => {
                if (failed) return;
                failed = true;
                onFailure();
            };
            try {
                const service = host()?.webOS?.service;
                if (typeof service?.request !== 'function') { fail(); return; }
                service.request('luna://com.webos.applicationManager', {
                    method: 'launch',
                    parameters: { id: 'com.webos.app.browser', params: { target: url } },
                    onFailure: fail
                });
            } catch { fail(); }
        },
        getHidden: () => hidden,
        subscribeVisibility: (listener: () => void) => {
            visibility.add(listener);
            return () => { visibility.delete(listener); };
        },
        subscribeLifecycle: (listener: (event: WebOSLaunchEvent) => void) => {
            if (!enabled) return () => { /* Disabled build has no subscription. */ };
            lifecycle.add(listener);
            if (!launched) {
                const params = fallback();
                if (params) { launched = true; pending = { type: 'launch', params }; }
            }
            const event = pending;
            pending = null;
            if (event) listener(event);
            return () => { lifecycle.delete(listener); };
        },
        dispose: () => {
            if (enabled && target) {
                target.removeEventListener('webOSLaunch', onLaunch, true);
                target.removeEventListener('webOSRelaunch', onRelaunch, true);
                target.removeEventListener('visibilitychange', onVisibility, true);
            }
            lifecycle.clear();
            visibility.clear();
            pending = null;
        },
        isActive: () => {
            try { const current = host(); return !!(current?.webOS || current?.PalmSystem); } catch { return false; }
        },
        readDeviceInfo: (callback: (info: WebOSPlatform['deviceInfo']) => void) => {
            try {
                const current = host();
                if (typeof current?.webOS?.deviceInfo === 'function') {
                    current.webOS.deviceInfo((info) => {
                        let result: WebOSPlatform['deviceInfo'] = null;
                        try { result = normalize(info); } catch { /* Malformed native response. */ }
                        callback(result);
                    });
                } else {
                    callback(normalize(JSON.parse(current?.PalmSystem?.deviceInfo || 'null')));
                }
            } catch { callback(null); }
        },
        backAvailable: () => {
            try {
                const current = host();
                return typeof current?.webOS?.platformBack === 'function' || typeof current?.PalmSystem?.platformBack === 'function';
            } catch { return false; }
        },
        platformBack: () => {
            const current = host();
            try {
                if (typeof current?.webOS?.platformBack === 'function') {
                    current.webOS.platformBack();
                    return true;
                }
            } catch { /* Try the native fallback. */ }
            try {
                if (typeof current?.PalmSystem?.platformBack === 'function') {
                    current.PalmSystem.platformBack();
                    return true;
                }
            } catch { /* Native Back is unavailable. */ }
            return false;
        }
    };
};

export const webOSAdapter = createWebOSAdapter(!!process.env.WEBOS);
