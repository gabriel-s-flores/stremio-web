import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WHITELISTED_HOSTS } from 'stremio/common/CONSTANTS';
import safeOpenExternal from './safeOpenExternal';
import resolveExternalUrl from './resolveExternalUrl';
import { webOSAdapter } from './webos/adapter';
import { installTVWheelScrolling } from './webos/pointer';
import { name, isMobile, isTV } from './device';
import useShell from './shell/useShell';
import { useWebOS, WebOSPlatform } from './webos';

interface PlatformContext {
    name: string;
    isMobile: boolean;
    isTV: boolean;
    shell: Shell;
    webos: WebOSPlatform;
    openExternal: (url: string) => void;
    externalLinkFailure: string | null;
    dismissExternalLinkFailure: () => void;
}

const PlatformContext = createContext<PlatformContext>({} as PlatformContext);

type Props = {
    children: JSX.Element;
};

const PlatformProvider = ({ children }: Props) => {
    const shell = useShell();
    const webos = useWebOS();
    const cursorVisible = useSyncExternalStore(webOSAdapter.subscribeCursorVisibility, webOSAdapter.getCursorVisible, () => null);
    const [externalLinkFailure, setExternalLinkFailure] = useState<string | null>(null);
    const requestId = useRef(0);
    const dismissExternalLinkFailure = useCallback(() => {
        requestId.current++;
        setExternalLinkFailure(null);
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        if (!process.env.WEBOS || !webos.active || cursorVisible === null) {
            root.removeAttribute('data-webos-cursor-visible');
            return undefined;
        }

        root.setAttribute('data-webos-cursor-visible', String(cursorVisible));
        return () => root.removeAttribute('data-webos-cursor-visible');
    }, [webos.active, cursorVisible]);

    useEffect(() => {
        if (!process.env.WEBOS) return undefined;
        return installTVWheelScrolling(document);
    }, []);

    const openExternal = useCallback((url: string) => {
        if (name === 'webos') {
            const safeUrl = resolveExternalUrl(url, WHITELISTED_HOSTS);
            if (safeUrl === null) return;
            const id = ++requestId.current;
            setExternalLinkFailure(null);
            webOSAdapter.openBrowser(safeUrl, () => {
                if (id === requestId.current) setExternalLinkFailure(safeUrl);
            });
            return;
        }
        const opened = safeOpenExternal(
            url,
            WHITELISTED_HOSTS,
            typeof window === 'undefined' ? null : window
        );

        if (!opened) {
            console.warn('External URL could not be opened');
        }
    }, []);

    return (
        <PlatformContext.Provider value={{ openExternal, externalLinkFailure, dismissExternalLinkFailure, shell, webos, name, isMobile, isTV }}>
            {children}
        </PlatformContext.Provider>
    );
};

const usePlatform = () => {
    return useContext(PlatformContext);
};

export {
    PlatformProvider,
    usePlatform
};
