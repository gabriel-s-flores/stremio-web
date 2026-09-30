import { useEffect, useState, useSyncExternalStore } from 'react';
import { webOSAdapter, WebOSPlatform } from './adapter';

const useWebOS = (): WebOSPlatform => {
    const [deviceInfo, setDeviceInfo] = useState<WebOSPlatform['deviceInfo']>(null);
    const active = webOSAdapter.isActive();
    const hidden = useSyncExternalStore(webOSAdapter.subscribeVisibility, webOSAdapter.getHidden, () => false);

    useEffect(() => {
        let mounted = true;
        if (active) webOSAdapter.readDeviceInfo((info) => { if (mounted) setDeviceInfo(info); });
        return () => { mounted = false; };
    }, [active]);

    return { active, hidden, subscribeLifecycle: webOSAdapter.subscribeLifecycle,
        deviceInfo: active ? deviceInfo : null, platformBack: webOSAdapter.platformBack };
};

export default useWebOS;
