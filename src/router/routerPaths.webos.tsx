import React from 'react';
import baseRoutes from 'stremio-router-base-paths';
import DebugPage from 'stremio/webos/diagnostics/DebugPage';
import PlayerDebugPage from 'stremio/webos/diagnostics/PlayerDebugPage';
import CalendarDebugPage from 'stremio/webos/diagnostics/CalendarDebugPage';

export default [
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
