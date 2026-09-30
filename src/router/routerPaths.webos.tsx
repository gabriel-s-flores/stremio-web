import React from 'react';
import ExternalLinksDebugPage from 'stremio/webos/diagnostics/ExternalLinksDebugPage';
import baseRoutes from 'stremio-router-base-paths';
import DebugPage from 'stremio/webos/diagnostics/DebugPage';
import PlayerDebugPage from 'stremio/webos/diagnostics/PlayerDebugPage';
import CalendarDebugPage from 'stremio/webos/diagnostics/CalendarDebugPage';
import FocusDebugPage from 'stremio/webos/diagnostics/FocusDebugPage';
import FontsIconsDebugPage from 'stremio/webos/diagnostics/FontsIconsDebugPage';
import ClipboardDebugPage from 'stremio/webos/diagnostics/ClipboardDebugPage';

export default [
    {
        path: '/debug/clipboard',
        view: 1,
        element: <ClipboardDebugPage />,
    },
    {
        path: '/debug/external-links',
        view: 1,
        element: <ExternalLinksDebugPage />,
    },
    {
        path: '/debug/fonts-icons',
        view: 1,
        element: <FontsIconsDebugPage />,
    },
    {
        path: '/debug/focus',
        view: 1,
        element: <FocusDebugPage />,
    },
    {
        path: '/debug/player',
        view: 1,
        element: <PlayerDebugPage />,
    },
    {
        path: '/debug/calendar',
        view: 1,
        element: <CalendarDebugPage />,
    },
    {
        path: '/debug',
        view: 1,
        element: <DebugPage />,
    },
    ...baseRoutes,
];
