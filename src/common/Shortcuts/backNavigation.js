const getOriginTarget = (origin) => {
    if (typeof origin === 'string' && origin.length > 0) {
        return origin;
    }

    if (origin && typeof origin.pathname === 'string') {
        return `${origin.pathname}${origin.search || ''}${origin.hash || ''}`;
    }

    return null;
};

const getBackNavigationAction = (location, historyState) => {
    const originTarget = getOriginTarget(location && location.state && location.state.from);
    if (originTarget !== null) {
        return { type: 'route-origin', target: originTarget };
    }

    const historyIndex = historyState && historyState.idx;
    if (Number.isInteger(historyIndex) && historyIndex > 0) {
        return { type: 'history' };
    }

    if (location && location.pathname === '/') {
        return { type: 'platform' };
    }

    return { type: 'none' };
};

module.exports = {
    getBackNavigationAction,
};
