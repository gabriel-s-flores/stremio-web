// Native engine identity and page scale; DPR is a separate diagnostic metric.
module.exports = function validateRuntime(version, metrics, identity, browserCommandLine) {
    const nativeWAM = version.product === '' && /\/usr\/bin\/WebAppMgr(?:\s|$)/.test(browserCommandLine || '');
    if ((!/\/68\./.test(version.product) && !nativeWAM) || !/^6\.8\./.test(version.jsVersion) || !/Chrome\/68\./.test(identity.ua)) {
        throw Error('Native Chromium 68 / V8 6.8 required');
    }
    // WAM appends this native suffix to app pages but omits it in Browser.getVersion.
    const nativeUA = nativeWAM ? identity.ua.replace(/ WebAppManager$/, '') : identity.ua;
    if (version.userAgent !== nativeUA) throw Error('User-Agent override detected');
    if (typeof browserCommandLine !== 'string' || !browserCommandLine.trim() || /--user-agent(?:=|\s)/i.test(browserCommandLine)) {
        throw Error('Native browser process command line without --user-agent is required');
    }
    const failures = [];
    if (identity.width !== 1920 || identity.height !== 1080 || identity.scale !== 1 || metrics.visualViewport.scale !== 1) {
        failures.push('Native 1920x1080 / page scale 1 required');
    }
    return {
        runtime: { product: version.product, revision: version.revision, jsVersion: version.jsVersion,
            browserUA: version.userAgent, ...identity, pageScale: metrics.visualViewport.scale,
            debugBuild: true, overridesIssued: [], launchArgumentsChecked: true },
        failures
    };
};
