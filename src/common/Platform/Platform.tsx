import React, { createContext, useContext } from 'react';
import { WHITELISTED_HOSTS } from 'stremio/common/CONSTANTS';
import safeOpenExternal from './safeOpenExternal';
import { name, isMobile, isTV } from './device';
import useShell from './shell/useShell';

interface PlatformContext {
    name: string;
    isMobile: boolean;
    isTV: boolean;
    shell: Shell;
    openExternal: (url: string) => void;
}

const PlatformContext = createContext<PlatformContext>({} as PlatformContext);

type Props = {
    children: JSX.Element;
};

const PlatformProvider = ({ children }: Props) => {
    const shell = useShell();

    const openExternal = (url: string) => {
        const opened = safeOpenExternal(
            url,
            WHITELISTED_HOSTS,
            typeof window === 'undefined' ? null : window
        );

        if (!opened) {
            console.warn('External URL could not be opened');
        }
    };

    return (
        <PlatformContext.Provider value={{ openExternal, shell, name, isMobile, isTV }}>
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
