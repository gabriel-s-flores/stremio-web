interface WebOSAPI {
    service?: {
        request: (uri: string, options: {
            method: string;
            parameters: { id: string; params: { target: string } };
            onFailure: () => void;
        }) => unknown;
    };
    deviceInfo?: (callback: (info: unknown) => void) => void;
    platformBack?: () => void;
}

interface PalmSystemAPI {
    launchParams?: string;
    deviceInfo?: string;
    platformBack?: () => void;
}

interface Window {
    webOSDev?: { launchParams?: () => unknown };
    webOS?: WebOSAPI;
    PalmSystem?: PalmSystemAPI;
}
