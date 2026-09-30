import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CDP_HTTP = 'http://127.0.0.1:9998';
const DEFAULT_TIMEOUT_MS = 20000;
const EXPECTED_CONSOLE_PATTERNS = [
    /service worker.*secure origin/i,
    /securityerror.*service worker/i,
    /failed to register.*service worker/i,
    /sw registration failed.*secure origin/i,
    /window\.cast/i,
    /cast_sender/i,
    /cast.*unavailable/i,
];

let cdpMessageId = 0;

const fail = (message) => {
    throw new Error(`webOS UI verification failed: ${message}`);
};

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const parseInteger = (value, option) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) fail(`${option} must be a positive integer`);
    return parsed;
};

const parseArguments = () => {
    const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
    const result = {
        buildDirectory: path.resolve('build'),
        cdpHint: null,
        cdpHttp: process.env.CDP_HTTP || DEFAULT_CDP_HTTP,
        route: '#/intro',
        runs: 1,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        output: null,
        reload: true,
        player: false,
        strictPlayer: false,
        expectedPlayerImplementation: null,
        screenshots: null,
    };

    if (args[0] && !args[0].startsWith('--')) result.buildDirectory = path.resolve(args.shift());

    while (args.length > 0) {
        const option = args.shift();
        switch (option) {
            case '--cdp':
                result.cdpHint = args.shift();
                break;
            case '--cdp-http':
                result.cdpHttp = args.shift();
                break;
            case '--route':
                result.route = args.shift();
                break;
            case '--runs':
                result.runs = parseInteger(args.shift(), option);
                break;
            case '--timeout':
                result.timeoutMs = parseInteger(args.shift(), option);
                break;
            case '--output':
                result.output = path.resolve(args.shift());
                break;
            case '--no-reload':
                result.reload = false;
                break;
            case '--player':
                result.player = true;
                break;
            case '--strict-player':
                result.strictPlayer = true;
                break;
            case '--expected-player':
                result.expectedPlayerImplementation = args.shift();
                break;
            case '--screenshots':
                result.screenshots = path.resolve(args.shift());
                break;
            default:
                fail(`unknown option ${option}`);
        }
    }

    if (!result.cdpHint && process.env.CDP_TARGET) result.cdpHint = process.env.CDP_TARGET;
    if (!result.cdpHint) fail('missing CDP target; use --cdp or CDP_TARGET');
    if (typeof result.route !== 'string' || !result.route.startsWith('#/')) {
        fail('--route must start with #/');
    }

    return result;
};

const findBuildArtifacts = (buildDirectory) => {
    if (!fs.existsSync(buildDirectory) || !fs.statSync(buildDirectory).isDirectory()) {
        fail(`missing build directory ${buildDirectory}`);
    }

    const commitDirectories = fs.readdirSync(buildDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^[a-f0-9]{40}$/i.test(entry.name));
    if (commitDirectories.length !== 1) {
        fail(`expected one commit directory, found ${commitDirectories.length}`);
    }

    const commitHash = commitDirectories[0].name;
    const mainPath = path.join(buildDirectory, commitHash, 'scripts', 'main.js');
    const cssPath = path.join(buildDirectory, commitHash, 'styles', 'main.css');
    if (!fs.existsSync(mainPath)) fail(`missing ${path.relative(buildDirectory, mainPath)}`);
    if (!fs.existsSync(cssPath)) fail(`missing ${path.relative(buildDirectory, cssPath)}`);

    const main = fs.readFileSync(mainPath, 'utf8');
    if (!main.includes('__stremioWebosDebug') || !main.includes('i18n-resources-ready')) {
        fail('debug UI instrumentation is missing from main.js');
    }

    return {
        commitHash,
        mainBytes: fs.statSync(mainPath).size,
        cssBytes: fs.statSync(cssPath).size,
    };
};

const sanitizeMessage = (message) => String(message)
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/file:\/\/\S+/gi, '<file>')
    .slice(0, 500);

const sanitizeSourceUrl = (sourceUrl) => {
    if (!sourceUrl) return null;

    try {
        return new URL(sourceUrl).origin;
    } catch (_error) {
        return String(sourceUrl).slice(0, 500);
    }
};

const isExpectedConsoleMessage = (message) => EXPECTED_CONSOLE_PATTERNS.some((pattern) => pattern.test(message));

const isNetworkResource404 = (message) => /failed to load resource.*404/i.test(message);

const isExpectedExternalPlayerMessage = (entry) => {
    const sourceUrl = String(entry.sourceUrl || '');
    return /yt\.strem\.io/i.test(sourceUrl) && /queueMicrotask is not defined|Player Object/i.test(entry.message);
};

const isExpectedPlayerDependencyMessage = (message) => /net::ERR_CONNECTION_REFUSED|stack=TypeError: Failed to fetch,message=Failed to fetch/i.test(message);

const formatConsoleArgument = (argument) => {
    if (argument.value !== undefined) return argument.value;
    if (argument.preview && Array.isArray(argument.preview.properties)) {
        const properties = argument.preview.properties.map((property) => `${property.name}=${property.value}`).join(',');
        return `{${properties}}`;
    }
    return argument.description ?? argument.type;
};

class CdpConnection {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.pending = new Map();
        this.onEvent = () => {};
    }

    async open() {
        this.socket = await new Promise((resolve, reject) => {
            const socket = new WebSocket(this.url);
            socket.onopen = () => resolve(socket);
            socket.onerror = () => reject(new Error(`cannot connect to CDP ${this.url}`));
        });

        this.socket.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (_error) {
                return;
            }

            if (message.id && this.pending.has(message.id)) {
                const pending = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result);
                return;
            }

            if (message.method) this.onEvent(message);
        };
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++cdpMessageId;
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });

        if (result.exceptionDetails) {
            fail(result.exceptionDetails.text || 'Runtime.evaluate threw an exception');
        }

        return result.result && Object.prototype.hasOwnProperty.call(result.result, 'value')
            ? result.result.value
            : null;
    }

    close() {
        if (this.socket) this.socket.close();
    }
}

const listTargets = async (cdpHttp) => {
    const response = await fetch(`${cdpHttp}/json`);
    if (!response.ok) fail(`CDP /json returned HTTP ${response.status}`);
    return response.json();
};

const findTarget = async (cdpHttp, hint) => {
    const targets = await listTargets(cdpHttp);
    const target = targets.find((candidate) => (
        (candidate.id && candidate.id.includes(hint))
        || (candidate.url && candidate.url.includes(hint))
        || (candidate.title && candidate.title.includes(hint))
    ));

    if (!target || !target.webSocketDebuggerUrl) {
        fail(`CDP target not found: ${hint}`);
    }

    return target;
};

const getSnapshot = async (connection) => connection.evaluate(`(function () {
    if (!window.__stremioWebosDebug) return null;
    return window.__stremioWebosDebug.refresh();
})()`);

const getBootState = async (connection) => connection.evaluate(`(function () {
    var app = document.getElementById('app');
    var bodyText = document.body ? document.body.innerText : '';
    var path = location.hash.slice(1).split('?')[0] || '/';
    var introControls = !!document.querySelector('input[type="email"], input[type="password"]');
    var board = document.querySelector('[class*="board-container"]');
    var focusable = document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var rawTranslationKey = /(?:GUEST_LOGIN|LOGIN_LABEL|INVALID_EMAIL|UPDATER_TITLE|BUTTON_CLOSE)/.test(bodyText);

    return {
        path: path,
        appChildren: app ? app.childNodes.length : 0,
        hasIntroControls: introControls,
        hasBoard: !!board,
        focusableCount: focusable.length,
        hasRawTranslationKey: rawTranslationKey,
        queueMicrotaskAvailable: typeof window.queueMicrotask === 'function',
        objectFreezeAvailable: typeof Object.freeze === 'function',
    };
})()`);

const runQueueMicrotaskProbe = async (connection) => connection.evaluate(`(async function () {
    if (typeof window.queueMicrotask !== 'function') {
        return { available: false, order: [] };
    }

    var order = [];
    await new Promise(function (resolve) {
        window.queueMicrotask(function () {
            order.push('microtask');
        });
        window.setTimeout(function () {
            order.push('timer');
            resolve();
        }, 0);
    });

    return {
        available: true,
        order: order,
        correctOrder: order.join(',') === 'microtask,timer',
    };
})()`);

const runDeepFreezeProbe = async (connection) => connection.evaluate(`(function () {
    var value = { nested: { value: 1 } };
    Object.freeze(value);
    return {
        objectFreezeAvailable: typeof Object.freeze === 'function',
        shallowFreezeLeavesNestedMutable: !Object.isFrozen(value.nested),
        playerDeepFreezeExercised: false,
    };
})()`);

const PLAYER_ACTIONS = [
    { name: 'buttons-menu', targetSelector: '[class*="control-bar-buttons-menu-container"]', screenshot: 'player-buttons-menu', required: true, strict: true },
    { name: 'speed', targetSelector: '[class*="speed-menu-container"]', screenshot: 'player-speed-menu', required: true, strict: true },
    { name: 'options', targetSelector: '[class*="options-menu-container"]', screenshot: 'player-options-menu', required: true, strict: true },
    { name: 'subtitles', targetSelector: '[class*="subtitles-menu-container"]', screenshot: 'player-subtitles-menu', strict: true },
    { name: 'audio', targetSelector: '[class*="audio-menu"]', screenshot: 'player-audio-menu', strict: true },
    { name: 'statistics', targetSelector: '[class*="statistics-menu-container"]', screenshot: 'player-statistics-menu', strict: true },
    { name: 'cast', targetSelector: '[class*="cast-devices-menu-container"]', screenshot: 'player-cast-menu', strict: true },
    { name: 'next-video', targetSelector: '[class*="next-video-popup-container"]', screenshot: 'player-next-video', click: false, strict: true },
    { name: 'videos', targetSelector: '[class*="side-drawer-layer"]', screenshot: 'player-side-drawer', required: false, strict: true },
    { name: 'side-drawer', targetSelector: '[class*="side-drawer-layer"]', screenshot: 'player-side-drawer-button', required: false, strict: true },
    { name: 'video-scale', targetSelector: '[class*="indicator-container"]', screenshot: 'player-video-scale' },
];

const PLAYER_LAYOUTS = [
    { name: 'control-bar-buttons', selector: '[class*="control-bar-buttons-container"]', mode: 'row' },
    { name: 'control-bar-overflow', selector: '[class*="control-bar-buttons-menu-container"].open', mode: 'row' },
    { name: 'speed-options', selector: '[class*="speed-menu-container"] [class*="options-container"]', mode: 'wrap' },
    { name: 'speed-top', selector: '[class*="speed-menu-container"] [class*="top-container"]', mode: 'column' },
    { name: 'audio-list', selector: '[class*="audio-menu"] [class*="list"]', mode: 'column' },
    { name: 'audio-info', selector: '[class*="audio-menu"] [class*="info"]', mode: 'column' },
    { name: 'statistics-container', selector: '[class*="statistics-menu-container"]', mode: 'column' },
    { name: 'statistics-detail', selector: '[class*="statistics-menu-container"] [class*="detail"]', mode: 'column' },
    { name: 'statistics-copy', selector: '[class*="statistics-menu-container"] [class*="copyable-value"]', mode: 'row' },
    { name: 'next-details', selector: '[class*="next-video-popup-container"] [class*="details-container"]', mode: 'column' },
    { name: 'next-buttons', selector: '[class*="next-video-popup-container"] [class*="buttons-container"]', mode: 'row' },
    { name: 'next-button', selector: '[class*="next-video-popup-container"] [class*="button-container"]', mode: 'row' },
];

const runPlayerAction = async (connection, action) => connection.evaluate(`(async function () {
    var actionName = ${JSON.stringify(action ? action.name : null)};
    var targetSelector = ${JSON.stringify(action ? action.targetSelector : null)};
    var shouldClick = ${action && action.click !== false ? 'true' : 'false'};
    var wait = function (durationMs) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, durationMs);
        });
    };
    var isVisible = function (element) {
        if (!element) return false;
        var rect = element.getBoundingClientRect();
        var style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0;
    };
    var findVisible = function (selector) {
        if (!selector) return null;
        var elements = document.querySelectorAll(selector);
        for (var index = 0; index < elements.length; index += 1) {
            if (isVisible(elements[index])) return elements[index];
        }
        return null;
    };
    var dispatchMouseEvent = function (element, type) {
        var event = document.createEvent('MouseEvents');
        event.initMouseEvent(type, true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
        element.dispatchEvent(event);
    };
    var inspectLayout = function (spec) {
        var element = findVisible(spec.selector);
        if (!element) {
            return { name: spec.name, selector: spec.selector, mode: spec.mode, present: false };
        }

        var children = Array.prototype.slice.call(element.children);
        var childStyles = children.map(function (child) {
            var style = window.getComputedStyle(child);
            return {
                marginTop: Number.parseFloat(style.marginTop || '0') || 0,
                marginRight: Number.parseFloat(style.marginRight || '0') || 0,
                marginBottom: Number.parseFloat(style.marginBottom || '0') || 0,
                marginLeft: Number.parseFloat(style.marginLeft || '0') || 0,
            };
        });
        var fallbackApplied = null;
        if (children.length > 1) {
            if (spec.mode === 'row') {
                fallbackApplied = childStyles.slice(1).some(function (style) { return style.marginLeft > 0; });
            } else if (spec.mode === 'column') {
                fallbackApplied = childStyles.slice(1).some(function (style) { return style.marginTop > 0; });
            } else {
                fallbackApplied = childStyles.some(function (style) {
                    return style.marginRight > 0 || style.marginBottom > 0;
                });
            }
        }

        var computedStyle = window.getComputedStyle(element);
        return {
            name: spec.name,
            selector: spec.selector,
            mode: spec.mode,
            present: true,
            display: computedStyle.display,
            flexDirection: computedStyle.flexDirection,
            gap: computedStyle.getPropertyValue('gap'),
            rowGap: computedStyle.getPropertyValue('row-gap'),
            columnGap: computedStyle.getPropertyValue('column-gap'),
            childCount: children.length,
            childStyles: childStyles,
            fallbackApplied: fallbackApplied,
        };
    };

    if (actionName !== null) {
        var button = document.querySelector('[data-webos-action="' + actionName + '"]');
        if (!button) {
            return {
                name: actionName,
                status: 'missing-button',
                targetSelector: targetSelector,
                targetVisible: false,
                layout: ${JSON.stringify(PLAYER_LAYOUTS)}.map(inspectLayout),
                player: window.__stremioWebosDebug ? window.__stremioWebosDebug.getSnapshot().player : null,
            };
        }

        var buttonStyle = window.getComputedStyle(button);
        var disabled = button.classList.contains('disabled') || button.getAttribute('aria-disabled') === 'true';
        var buttonVisible = isVisible(button);
        if (!disabled && shouldClick) {
            dispatchMouseEvent(button, 'mousedown');
            dispatchMouseEvent(button, 'mouseup');
            dispatchMouseEvent(button, 'click');
            await wait(450);
        }

        var target = findVisible(targetSelector);
        var status = disabled ? 'disabled' : target ? (shouldClick ? 'opened' : 'visible') : (shouldClick ? 'acted-no-target' : 'not-visible');
        return {
            name: actionName,
            status: status,
            buttonVisible: buttonVisible,
            buttonDisplay: buttonStyle.display,
            targetSelector: targetSelector,
            targetVisible: !!target,
            layout: ${JSON.stringify(PLAYER_LAYOUTS)}.map(inspectLayout),
            player: window.__stremioWebosDebug ? window.__stremioWebosDebug.getSnapshot().player : null,
        };
    }

    return {
        name: 'baseline',
        status: 'observed',
        layout: ${JSON.stringify(PLAYER_LAYOUTS)}.map(inspectLayout),
        player: window.__stremioWebosDebug ? window.__stremioWebosDebug.getSnapshot().player : null,
    };
})()`);

const captureScreenshot = async (connection, filePath) => {
    const result = await connection.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    if (!result || !result.data) fail('CDP screenshot returned no data');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
};

const waitForPlayerImplementation = async (connection, timeoutMs, allowFixture) => {
    const startedAt = Date.now();
    let lastPlayer = null;

    while (Date.now() - startedAt < timeoutMs) {
        lastPlayer = await connection.evaluate(`(function () {
            return window.__stremioWebosDebug ? window.__stremioWebosDebug.getSnapshot().player : null;
        })()`);
        if (lastPlayer && lastPlayer.implementation) return lastPlayer;
        if (allowFixture) {
            const fixtureVisible = await connection.evaluate(`(function () {
                return !!document.querySelector('[data-webos-player-fixture="true"]');
            })()`);
            if (fixtureVisible) {
                return {
                    implementation: 'PlayerDebugFixture',
                    history: ['PlayerDebugFixture'],
                };
            }
        }
        await sleep(250);
    }

    fail(`player implementation was not recorded: ${JSON.stringify(lastPlayer)}`);
};

const runPlayerProbe = async (connection, options) => {
    const initialPlayer = await waitForPlayerImplementation(connection, options.timeoutMs, options.strictPlayer);
    const scenarios = [{ name: 'baseline' }, ...PLAYER_ACTIONS];
    const states = [];

    for (const scenario of scenarios) {
        const action = scenario.name === 'baseline' ? null : scenario;
        const state = await runPlayerAction(connection, action);
        if (options.screenshots && (scenario.name === 'baseline' || state.status === 'opened' || state.status === 'visible')) {
            const filePath = path.join(options.screenshots, `${scenario.name}.png`);
            await captureScreenshot(connection, filePath);
            state.screenshot = path.relative(process.cwd(), filePath);
        }
        states.push(state);
    }

    const requiredActions = PLAYER_ACTIONS.filter((action) => options.strictPlayer ? action.strict : action.required);
    const requiredFailures = requiredActions
        .map((action) => ({ action, state: states.find((state) => state.name === action.name) }))
        .filter(({ action, state }) => !state || state.status !== (action.click === false ? 'visible' : 'opened'));
    if (requiredFailures.length > 0) {
        fail(`required player controls did not open: ${JSON.stringify(requiredFailures)}`);
    }

    const layoutFailures = states.flatMap((state) => state.layout || [])
        .filter((layout) => layout.present && layout.childCount > 1 && layout.fallbackApplied === false);
    if (layoutFailures.length > 0) {
        fail(`player Flexbox fallback margins are missing: ${JSON.stringify(layoutFailures)}`);
    }

    const finalPlayer = states.slice().reverse()
        .map((state) => state.player)
        .find((player) => player && player.implementation)
        || initialPlayer;
    if (options.expectedPlayerImplementation && finalPlayer.implementation !== options.expectedPlayerImplementation) {
        fail(`expected player implementation ${options.expectedPlayerImplementation}, got ${JSON.stringify(finalPlayer)}`);
    }

    return {
        implementation: finalPlayer.implementation,
        history: finalPlayer.history,
        fixture: initialPlayer.implementation === 'PlayerDebugFixture',
        states,
        screenshots: options.screenshots ? path.relative(process.cwd(), options.screenshots) : null,
    };
};

const waitForBoot = async (connection, route, timeoutMs) => {
    const startedAt = Date.now();
    let lastSnapshot = null;
    let lastState = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            lastSnapshot = await getSnapshot(connection);
            lastState = await getBootState(connection);
            const marks = lastSnapshot && lastSnapshot.marks ? lastSnapshot.marks : {};
            const ready = lastState && lastSnapshot &&
                marks['app-render'] !== undefined &&
                marks['core-ready'] !== undefined &&
                marks['i18n-ready'] !== undefined;

            if (ready) return { snapshot: lastSnapshot, state: lastState };
        } catch (_error) {
            // The execution context can disappear while Page.reload is replacing it.
        }

        await sleep(250);
    }

    fail(`boot did not reach app-render/core-ready/i18n-ready for ${route}; last state: ${JSON.stringify({ lastSnapshot, lastState })}`);
};

const waitForRoute = async (connection, route, timeoutMs) => {
    const expectedPath = expectedPathForRoute(route);
    const startedAt = Date.now();
    let currentPath = null;

    while (Date.now() - startedAt < timeoutMs) {
        currentPath = await connection.evaluate(`(function () {
            return location.hash.slice(1).split('?')[0] || '/';
        })()`);
        if (currentPath === expectedPath) return;
        await sleep(100);
    }

    fail(`route did not settle on ${expectedPath}; got ${currentPath}`);
};

const expectedPathForRoute = (route) => route.slice(1).split('?')[0] || '/';

const validateRoute = (route, state) => {
    const expectedPath = expectedPathForRoute(route);
    if (state.path !== expectedPath) {
        fail(`route redirected from ${expectedPath} to ${state.path}`);
    }

    if (expectedPath === '/intro' && (!state.hasIntroControls || state.hasRawTranslationKey)) {
        fail(`intro UI is incomplete or untranslated: ${JSON.stringify(state)}`);
    }

    if (expectedPath === '/' && !state.hasBoard) {
        fail(`board UI is not visible: ${JSON.stringify(state)}`);
    }
};

const toPublicSnapshot = (snapshot) => {
    if (!snapshot) return null;

    return {
        environment: {
            userAgent: snapshot.environment.userAgent,
            protocol: snapshot.environment.protocol,
            viewport: snapshot.environment.viewport,
            version: snapshot.environment.version,
            commit: snapshot.environment.commit,
            performanceMemoryAvailable: snapshot.environment.performanceMemoryAvailable,
        },
        marks: snapshot.marks,
        paints: snapshot.paints,
        navigation: snapshot.navigation,
        memory: snapshot.memory,
        fps: snapshot.fps,
        player: snapshot.player,
    };
};

const run = async (options, artifacts, runNumber) => {
    const target = await findTarget(options.cdpHttp, options.cdpHint);
    const connection = new CdpConnection(target.webSocketDebuggerUrl);
    const consoleMessages = [];
    const networkResponses = [];
    const pageOrigin = target.url ? new URL(target.url).origin : null;

    await connection.open();
    connection.onEvent = (event) => {
        if (event.method === 'Runtime.consoleAPICalled') {
            const args = (event.params.args || []).map(formatConsoleArgument).join(' ');
            const message = sanitizeMessage(args);
            const sourceUrl = event.params.stackTrace && event.params.stackTrace.callFrames && event.params.stackTrace.callFrames[0]?.url;
            consoleMessages.push({ type: event.params.type, message, sourceUrl: sanitizeSourceUrl(sourceUrl) });
        }

        if (event.method === 'Runtime.exceptionThrown') {
            const details = event.params.exceptionDetails || {};
            const exception = details.exception || {};
            const sourceUrl = details.url || exception.url || details.stackTrace?.callFrames?.[0]?.url;
            consoleMessages.push({
                type: 'exception',
                message: sanitizeMessage(exception.description || details.text || 'Unknown exception'),
                sourceUrl: sanitizeSourceUrl(sourceUrl),
            });
        }

        if (event.method === 'Log.entryAdded') {
            const entry = event.params.entry || {};
            consoleMessages.push({
                type: entry.level || 'log',
                message: sanitizeMessage(entry.text || ''),
                sourceUrl: sanitizeSourceUrl(entry.url),
            });
        }

        if (event.method === 'Network.responseReceived') {
            const response = event.params.response || {};
            if (response.status >= 400) {
                const url = String(response.url || '');
                networkResponses.push({
                    url: sanitizeMessage(url),
                    status: response.status,
                    local: pageOrigin !== null && (() => {
                        try {
                            return new URL(url).origin === pageOrigin;
                        } catch (_error) {
                            return false;
                        }
                    })(),
                });
            }
        }
    };

    try {
        await connection.send('Runtime.enable');
        await connection.send('Log.enable').catch(() => {});
        await connection.send('Network.enable').catch(() => {});
        await connection.send('Page.enable').catch(() => {});
        if (options.reload) {
            await connection.send('Page.reload', { ignoreCache: true });
            await sleep(500);
        }
        // Set the route after reload so async work from the previous Player
        // cannot win the hash race and redirect the requested scenario.
        consoleMessages.length = 0;
        networkResponses.length = 0;
        await connection.evaluate(`location.hash = ${JSON.stringify(options.route)}; true`);
        await waitForRoute(connection, options.route, options.timeoutMs);

        const boot = await waitForBoot(connection, options.route, options.timeoutMs);
        const queueMicrotask = await runQueueMicrotaskProbe(connection);
        const deepFreeze = await runDeepFreezeProbe(connection);
        validateRoute(options.route, boot.state);
        const player = options.player ? await runPlayerProbe(connection, options) : null;

        const localNetworkErrors = networkResponses.filter((entry) => entry.local);
        const unexpectedErrors = consoleMessages.filter((entry) => {
            if (entry.type !== 'error' && entry.type !== 'exception') return false;
            if (isExpectedConsoleMessage(entry.message)) return false;
            if (isExpectedExternalPlayerMessage(entry)) return false;
            if (options.player && isExpectedPlayerDependencyMessage(entry.message)) return false;
            if (isNetworkResource404(entry.message)) return false;
            return true;
        });
        const externalPlayerErrors = consoleMessages.filter(isExpectedExternalPlayerMessage);
        if (localNetworkErrors.length > 0) {
            fail(`local resources failed: ${JSON.stringify(localNetworkErrors)}`);
        }
        if (unexpectedErrors.length > 0) {
            fail(`unexpected console errors: ${JSON.stringify(unexpectedErrors)}`);
        }
        if (!queueMicrotask.available || !queueMicrotask.correctOrder) {
            fail(`queueMicrotask probe failed: ${JSON.stringify(queueMicrotask)}`);
        }

        return {
            run: runNumber,
            route: options.route,
            artifacts,
            ui: boot.state,
            queueMicrotask,
            deepFreeze,
            player,
            snapshot: toPublicSnapshot(boot.snapshot),
            console: consoleMessages,
            externalPlayerErrors,
            networkErrors: networkResponses,
            unexpectedErrors,
        };
    } finally {
        connection.close();
    }
};

const main = async () => {
    const options = parseArguments();
    const artifacts = findBuildArtifacts(options.buildDirectory);
    const results = [];

    for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
        results.push(await run(options, artifacts, runNumber));
    }

    const report = {
        date: new Date().toISOString(),
        target: {
            cdp: options.cdpHttp,
            route: options.route,
            runs: options.runs,
            reload: options.reload,
            player: options.player,
            strictPlayer: options.strictPlayer,
            expectedPlayerImplementation: options.expectedPlayerImplementation,
            screenshots: options.screenshots,
        },
        results,
    };
    const output = `${JSON.stringify(report, null, 2)}\n`;

    if (options.output) {
        fs.writeFileSync(options.output, output);
    }

    process.stdout.write(output);
};

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
