// Some TV engines expose the method but throw when the API is unavailable.
const readGamepads = (host: Pick<Navigator, 'getGamepads'> = navigator): Gamepad[] => {
    try {
        if (typeof host.getGamepads !== 'function') return [];
        return Array.from(host.getGamepads() || []).filter((pad): pad is Gamepad => !!pad && pad.connected !== false);
    } catch {
        return [];
    }
};

export default readGamepads;
