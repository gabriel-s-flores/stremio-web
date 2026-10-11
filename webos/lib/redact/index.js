// Masks the certificate proxy token (F3.7b; README.md in this folder).
//
// The proxy URLs of the tlsproxy (F3.7) are http://127.0.0.1:<port>/proxy?t=<token>&url=… and
// …/status?t=<token>. The token only lets a process on the TV use the proxy, but it must not end up
// in a log, in the diagnostics report or on a screen. The upstream logs whatever the video pipeline
// reports: console.error('Player', error) prints the failed subtitle track, whose url is the proxy
// URL. This module finds the token in strings (also percent-encoded), in the strings of objects and
// errors, and masks it as `***`, leaving the rest of the text as it was.
//
// Two ways to find it: the shape of the proxy URL (any token, also the one of a previous service
// process that is gone) and the exact tokens the page and the worker registered (addSecret), which
// also catches a bare token. Pure JS in the ES2016 of the Chromium 53; nothing here runs at boot but
// the installation of the console filter, which only replaces a few functions.

const MASK = '***';
// The service token is 16 random bytes in hex. A shorter secret would mask ordinary words.
const MIN_SECRET_LENGTH = 8;
const MAX_SECRETS = 8;
const MAX_DEPTH = 5;
const MAX_NODES = 1000;

// "/proxy?t=<token>" and "/status?t=<token>", raw or percent-encoded as a whole (a proxy URL passed
// as a query value has %2Fproxy%3Ft%3D<token>%26url…). The token ends at the first character that is
// not part of a token, and "%" is not.
const PROXY_QUERY = /(\/(?:proxy|status)(?:\?|%3F)t(?:=|%3D))[\w-]+/gi;
// Any "t=<32 hex>" parameter, in case the order of the parameters ever changes.
const TOKEN_PARAM = /((?:[?&]|%3F|%26)t(?:=|%3D))[0-9a-f]{32}(?![0-9a-f])/gi;

const secrets = [];

// Registers a token the page or the worker received from the service. Older ones stay (a request
// of the previous service process can still be in flight), up to MAX_SECRETS.
const addSecret = (secret) => {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH || secrets.indexOf(secret) !== -1) return;
    secrets.push(secret);
    if (secrets.length > MAX_SECRETS) secrets.shift();
};

const clearSecrets = () => {
    secrets.length = 0;
};

const redactString = (text) => {
    if (typeof text !== 'string' || text.length < 3) return text;
    let result = text.replace(PROXY_QUERY, '$1' + MASK).replace(TOKEN_PARAM, '$1' + MASK);
    for (let i = 0; i < secrets.length; i++) {
        if (result.indexOf(secrets[i]) !== -1) result = result.split(secrets[i]).join(MASK);
    }
    return result;
};

const hasOwn = Object.prototype.hasOwnProperty;
const tagOf = (value) => Object.prototype.toString.call(value);

// A shallow copy of an object with the same prototype; a getter that throws is left out.
const shallowCopy = (object) => {
    const copy = Object.create(Object.getPrototypeOf(object));
    Object.keys(object).forEach((key) => {
        try {
            copy[key] = object[key];
        } catch (_error) {
            // left out
        }
    });
    return copy;
};

const redactError = (error, walk) => {
    const message = redactString(error.message);
    const stack = redactString(error.stack);
    const extra = Object.keys(error);
    let changed = message !== error.message || stack !== error.stack;
    const props = {};
    extra.forEach((key) => {
        let next;
        try {
            next = walk(error[key]);
            props[key] = next;
            if (next !== error[key]) changed = true;
        } catch (_error) {
            // a getter that throws: left out
        }
    });
    if (!changed) return error;
    const copy = new Error(message);
    copy.name = error.name;
    // The browser prints the stack of an error: it carries the message too.
    if (typeof stack === 'string') copy.stack = stack;
    Object.keys(props).forEach((key) => {
        copy[key] = props[key];
    });
    return copy;
};

// The same value with the token masked. Strings, errors, arrays and objects (own enumerable
// properties, to MAX_DEPTH levels and MAX_NODES values) are looked into; what holds no token comes
// back as the very same reference, so a log keeps its live objects (and the DevTools their
// inspection); only the branch that held a token is copied. DOM nodes, events, maps, buffers and
// functions are left alone: they do not carry the URL as an own enumerable string.
const redactValue = (value, limits) => {
    const maxDepth = (limits && limits.maxDepth) || MAX_DEPTH;
    let budget = (limits && limits.maxNodes) || MAX_NODES;
    const walk = (current, depth) => {
        if (typeof current === 'string') return redactString(current);
        if (current === null || typeof current !== 'object') return current;
        const tag = tagOf(current);
        if (tag === '[object Error]') return depth >= maxDepth ? current : redactError(current, (child) => walk(child, depth + 1));
        const isArray = tag === '[object Array]';
        if (!isArray && tag !== '[object Object]') return current;
        if (depth >= maxDepth || budget <= 0) return current;
        let copy = null;
        const visit = (key) => {
            budget -= 1;
            let before;
            let after;
            try {
                before = current[key];
                after = walk(before, depth + 1);
            } catch (_error) {
                return;
            }
            if (after !== before) {
                if (copy === null) copy = isArray ? current.slice() : shallowCopy(current);
                copy[key] = after;
            }
        };
        if (isArray) {
            for (let i = 0; i < current.length && budget > 0; i++) visit(i);
        } else {
            // for-in stops at the budget without listing the keys of a huge object first.
            for (const key in current) {
                if (budget <= 0) break;
                if (hasOwn.call(current, key)) visit(key);
            }
        }
        return copy === null ? current : copy;
    };
    return walk(value, 0);
};

// The console arguments, masked: the same array when none holds a token.
const redactArgs = (args) => {
    let result = null;
    for (let i = 0; i < args.length; i++) {
        let next = args[i];
        try {
            next = redactValue(args[i]);
        } catch (_error) {
            // a getter that throws: logging must not fail because of it
        }
        if (next !== args[i]) {
            if (result === null) result = Array.prototype.slice.call(args);
            result[i] = next;
        }
    }
    return result === null ? args : result;
};

// The same emitter, except that the listeners of 'error' get the error payload masked. The Player
// logs it (console.error), shows its message in a toast and in the Error layer; a failed add-on
// subtitle carries its track, whose url is the proxy URL. The listeners are wrapped one to one, so
// off() takes the right one out.
const withRedactedErrors = (emitter) => {
    const wrappers = new WeakMap();
    const wrapperOf = (listener) => {
        if (typeof listener !== 'function') return listener;
        if (!wrappers.has(listener)) wrappers.set(listener, function(payload) {
            return listener.apply(this, [redactValue(payload)].concat(Array.prototype.slice.call(arguments, 1)));
        });
        return wrappers.get(listener);
    };
    const wrapped = Object.create(emitter);
    ['on', 'addListener', 'once', 'off', 'removeListener'].forEach((method) => {
        wrapped[method] = function(event, listener) {
            const rest = Array.prototype.slice.call(arguments, 2);
            emitter[method].apply(emitter, [event, event === 'error' ? wrapperOf(listener) : listener].concat(rest));
            return wrapped;
        };
    });
    return wrapped;
};

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'assert', 'dir', 'table', 'group', 'groupCollapsed'];

// Wraps the console methods of `target` (window.console, or self.console in the worker) so that
// their arguments go through redactArgs. Once per console. The wrapper is the only frame between
// the caller and the browser, which now shows this file as the source of a log line.
const installConsoleFilter = (target) => {
    if (!target || target.__webosRedactInstalled) return false;
    try {
        Object.defineProperty(target, '__webosRedactInstalled', { value: true });
    } catch (_error) {
        return false;
    }
    CONSOLE_METHODS.forEach((method) => {
        const original = target[method];
        if (typeof original !== 'function') return;
        target[method] = function() {
            return original.apply(target, redactArgs(arguments));
        };
    });
    return true;
};

module.exports = {
    MASK,
    addSecret,
    clearSecrets,
    redactString,
    redactValue,
    redactArgs,
    installConsoleFilter,
    withRedactedErrors,
};
