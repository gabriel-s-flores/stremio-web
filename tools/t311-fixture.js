import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Intro from '../src/routes/Intro/Intro';

const state = window.__t311;
const listeners = { event: new Set(), error: new Set() };
let root;
state.platform = { isTV: true, isMobile: false, openExternal: url => {
    state.externalCalls++;
    state.resetExternal = /^https:\/\/www\.strem\.io\/reset-password\//.test(url);
} };
state.core = {
    on: (type, fn) => listeners[type].add(fn), off: (type, fn) => listeners[type].delete(fn),
    transport: { dispatch: payload => {
        state.dispatchCount++;
        const args = payload?.args?.args || {};
        // Allowlist only structural facts, never retain the original payload.
        state.payloads.push({ action: payload.action === 'Ctx' ? 'Ctx' : 'unexpected', args: {
            action: payload.args?.action === 'Authenticate' ? 'Authenticate' : 'unexpected', args: {
                type: ['Login', 'Register', 'Apple'].includes(args.type) ? args.type : 'unexpected',
                emailPresent: typeof args.email === 'string' && args.email.length > 0,
                passwordPresent: typeof args.password === 'string' && args.password.length > 0,
                fieldCount: Object.keys(args).length,
                ...(args.gdpr_consent ? { gdpr_consent: { tos: args.gdpr_consent.tos === true,
                    privacy: args.gdpr_consent.privacy === true, marketing: args.gdpr_consent.marketing === true,
                    from: args.gdpr_consent.from === 'web' ? 'web' : 'unexpected' } } : {})
            }
        } });
    } }
};
window.fetch = () => { state.fetchCalls++; return Promise.resolve({ json: () => Promise.resolve({ user: {} }) }); };
const nativeTimeout = window.setTimeout;
window.setTimeout = (fn, delay, ...args) => {
    if (delay === 1000 || delay === 2000) state.oauthTimers++;
    return nativeTimeout(fn, delay, ...args);
};
// Spatial navigation itself and virtual keyboard scrolling are tested in T4.9.
window.navigate = () => { state.spatialCalls++; };
state.mount = (mode = 'tv', form = 'login') => {
    if (root) flushSync(() => root.unmount());
    state.platform.isTV = mode === 'tv'; state.platform.isMobile = mode === 'mobile';
    Object.assign(state, { externalCalls: 0, fetchCalls: 0, oauthTimers: 0, dispatchCount: 0, spatialCalls: 0, payloads: [], resetExternal: false });
    root = createRoot(document.getElementById('app'));
    flushSync(() => root.render(<MemoryRouter initialEntries={['/intro?form=' + form]}>
        <Routes><Route path="/intro" element={<Intro />} /><Route path="/" element={<div data-authenticated="true" />} /></Routes>
    </MemoryRouter>));
};
state.emit = (type, event) => flushSync(() => listeners[type].forEach(fn => fn(event)));
state.unmount = () => { flushSync(() => root.unmount()); root = null; };
state.snapshot = () => ({
    oauthControls: document.querySelectorAll('.facebook-button,.apple-button').length,
    emailInputs: document.querySelectorAll('input[type=email]').length,
    passwordInputs: document.querySelectorAll('input[type=password]').length,
    loader: !!document.querySelector('.loader-container'), authenticated: !!document.querySelector('[data-authenticated]'),
    externalCalls: state.externalCalls, fetchCalls: state.fetchCalls, oauthTimers: state.oauthTimers,
    dispatchCount: state.dispatchCount, payloads: JSON.parse(JSON.stringify(state.payloads)), resetExternal: state.resetExternal,
    errors: state.errors, rejections: state.rejections, consoleErrors: state.consoleErrors,
    eventListeners: listeners.event.size, errorListeners: listeners.error.size
});
state.mount(); state.ready = true;
