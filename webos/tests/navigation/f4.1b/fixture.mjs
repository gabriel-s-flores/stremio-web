// Test fixture of the F4.1b emulator script (run.mjs): Library and Calendar only show their content
// to a logged-in profile, and the project has no Stremio account (P3). The fixture writes a fake
// profile (auth key "f41b-fixture", never valid) and a library of Cinemeta titles into the core's
// localStorage, and keeps the fake key away from the Stremio API: the actions that send it
// (PullUserFromAPI, whose "session expired" answer would log the profile out, PullAddonsFromAPI and
// SyncLibraryWithAPI) are swapped for PullNotifications on their way to the core worker. Nothing of
// this ships: it lives in the test and is injected over CDP before the app loads.

export const USER_ID = 'f41bfixture';

// Runs in the page before the app (Page.addScriptToEvaluateOnLoad): the worker filter. ES5.
export const WORKER_FILTER = `
(function () {
    var API_ACTIONS = ['PullUserFromAPI', 'PullAddonsFromAPI', 'SyncLibraryWithAPI'];
    var post = Worker.prototype.postMessage;
    window.__f41bFixture = { swapped: [] };
    Worker.prototype.postMessage = function (message) {
        var request = message && message.request;
        var action = request && request.path && request.path[0] === 'dispatch' && request.args && request.args[0];
        if (action && action.action === 'Ctx' && action.args && API_ACTIONS.indexOf(action.args.action) !== -1) {
            window.__f41bFixture.swapped.push(action.args.action);
            request.args[0] = { action: 'Ctx', args: { action: 'PullNotifications' } };
        }
        return post.apply(this, arguments);
    };
})();
`;

// Runs in the page (Runtime.evaluate): fetches Cinemeta's top movies and series and writes the
// profile (the guest one of the running core, plus the fake auth) and the library. The Chromium 53
// inspector cannot await a promise: the result (number of items, or the error) goes to
// window.__f41bFixtureResult. ES2015 for Chromium 53.
export const WRITE_FIXTURE = `
(function () {
    var USER_ID = '${USER_ID}';
    var catalog = function (type, skip) {
        var url = 'https://v3-cinemeta.strem.io/catalog/' + type + '/top' + (skip ? '/skip=' + skip : '') + '.json';
        return fetch(url).then(function (response) { return response.json(); }).then(function (body) { return body.metas || []; });
    };
    window.__f41bFixtureResult = null;
    return Promise.all([catalog('movie', 0), catalog('movie', 50), catalog('series', 0), catalog('series', 50), window.core.getState('ctx')]).then(function (lists) {
        var ctx = lists.pop();
        var metas = [].concat.apply([], lists);
        var now = Date.now();
        var items = {};
        metas.forEach(function (meta, index) {
            if (items[meta.id]) return;
            var time = new Date(now - index * 3600 * 1000).toISOString();
            items[meta.id] = {
                _id: meta.id,
                name: meta.name,
                type: meta.type,
                poster: meta.poster || null,
                posterShape: 'poster',
                removed: false,
                temp: false,
                _ctime: time,
                _mtime: time,
                state: {
                    lastWatched: time,
                    timeWatched: 0,
                    timeOffset: 0,
                    overallTimeWatched: 0,
                    timesWatched: 0,
                    flaggedWatched: 0,
                    duration: 0,
                    video_id: null,
                    watched: null,
                    noNotif: false
                },
                behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: meta.type === 'series' }
            };
        });
        var profile = ctx.profile;
        profile.auth = {
            key: 'f41b-fixture',
            user: {
                _id: USER_ID,
                email: 'fixture@f41b.invalid',
                fbId: null,
                avatar: null,
                lastModified: new Date(now).toISOString(),
                dateRegistered: new Date(now).toISOString(),
                trakt: null,
                premium_expire: null,
                gdpr_consent: { tos: true, privacy: true, marketing: false, from: 'web' }
            }
        };
        localStorage.setItem('profile', JSON.stringify(profile));
        localStorage.setItem('library', JSON.stringify({ uid: USER_ID, items: items }));
        localStorage.setItem('library_recent', JSON.stringify({ uid: USER_ID, items: {} }));
        window.__f41bFixtureResult = { items: Object.keys(items).length };
    }).catch(function (error) {
        window.__f41bFixtureResult = { error: String(error && error.message || error) };
    });
})()
`;
