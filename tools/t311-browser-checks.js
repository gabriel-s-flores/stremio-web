// Runs inside the isolated fixture only. All values are synthetic and never
// returned. Evidence contains boolean checks, counts and allowlisted payloads.
async function t311BrowserChecks() {
    const api = window.__t311, checks = {}, snapshots = {};
    api.checks = checks;
    const pause = () => new Promise(resolve => setTimeout(resolve, 50));
    const check = (name, value) => { checks[name] = value === true; };
    const query = selector => document.querySelector(selector);
    const change = async (selector, value) => {
        const input = query(selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    };
    const enter = async selector => {
        query(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause();
    };
    const click = async selector => { query(selector).click(); await pause(); };
    const mount = async (mode, form) => { api.mount(mode, form); await pause(); };
    const input = name => 'input[placeholder="' + name + '"]';
    const fill = async () => { await change(input('EMAIL'), 'fixture@example.invalid'); await change(input('PASSWORD'), 'synthetic'); };
    const keyboard = () => [...document.querySelectorAll('input[type=email],input[type=password]')].every(el =>
        ['autocapitalize', 'autocorrect', 'autocomplete'].every(attr => el.getAttribute(attr) === 'off') && el.spellcheck === false && !el.hasAttribute('inputmode'));
    const error = key => !!query('.error-message') && query('.error-message').textContent === key;
    await pause();
    snapshots.tvMount = api.snapshot();
    check('tvOAuthAbsent', snapshots.tvMount.oauthControls === 0);
    check('tvMountInert', api.externalCalls === 0 && api.fetchCalls === 0 && api.oauthTimers === 0 && api.dispatchCount === 0);
    check('nativeInputContract', snapshots.tvMount.emailInputs === 1 && snapshots.tvMount.passwordInputs === 1 && keyboard());
    check('nativePasswordMask', getComputedStyle(query(input('PASSWORD'))).webkitTextSecurity === 'disc');
    check('initialEmailFocus', document.activeElement === query(input('EMAIL')));
    check('formPresent', !!query('.form-container'));
    check('optionsPresent', !!query('.options-container'));
    const form = query('.form-container').getBoundingClientRect(), options = query('.options-container').getBoundingClientRect();
    check('tvStackedCentered', Math.abs(form.left - options.left) < 1 && options.top >= form.bottom && Math.abs(form.left + form.width / 2 - innerWidth / 2) < 2);
    await click('.submit-button'); check('invalidEmail', error('INVALID_EMAIL') && api.dispatchCount === 0);
    await change(input('EMAIL'), 'invalid'); await click('.submit-button'); check('browserEmailValidity', error('INVALID_EMAIL') && !query(input('EMAIL')).validity.valid);
    await change(input('EMAIL'), 'fixture@example.invalid'); await click('.submit-button'); check('invalidPassword', error('INVALID_PASSWORD') && api.dispatchCount === 0);
    await fill(); await enter(input('EMAIL')); check('enterEmailFocusesPassword', document.activeElement === query(input('PASSWORD')));
    await enter(input('PASSWORD'));
    snapshots.login = api.snapshot();
    check('enterPasswordDispatchesLogin', api.dispatchCount === 1 && api.payloads[0].args.args.type === 'Login' && api.payloads[0].args.args.fieldCount === 3 && api.payloads[0].args.args.emailPresent && api.payloads[0].args.args.passwordPresent && snapshots.login.loader);
    api.emit('error', { event: 'UserAuthenticated' }); await pause();
    check('authErrorClosesLoader', !api.snapshot().loader && !api.snapshot().authenticated);
    await click('.submit-button'); api.emit('event', 'UserAuthenticated'); await pause();
    check('authSuccessNavigates', api.snapshot().authenticated && !api.snapshot().loader);

    await mount('tv', 'signup');
    check('signupNativeConfirmation', api.snapshot().passwordInputs === 2 && keyboard());
    check('legalLinksPreserved', !!query('a[href="https://www.stremio.com/tos"]') && !!query('a[href="https://www.stremio.com/privacy"]'));
    await click('.guest-login-button'); check('guestRequiresTerms', error('MUST_ACCEPT_TERMS') && !api.snapshot().authenticated);
    await fill(); await enter(input('PASSWORD')); check('signupEnterFocusesConfirmation', document.activeElement === query(input('PASSWORD_CONFIRM')));
    await change(input('PASSWORD_CONFIRM'), 'different'); await click('.submit-button'); check('confirmationRequired', error('PASSWORDS_NOMATCH'));
    await change(input('PASSWORD_CONFIRM'), 'synthetic'); await click('.submit-button'); check('termsRequired', error('MUST_ACCEPT_TERMS'));
    await enter('.checkbox:nth-of-type(1) [role=checkbox]');
    // Find by document order since the checkboxes share labels/classes.
    if (!document.querySelectorAll('[role=checkbox]')[0].getAttribute('aria-checked').includes('true')) check('termsEnterToggles', false);
    else check('termsEnterToggles', true);
    await click('.submit-button'); check('privacyRequired', error('MUST_ACCEPT_PRIVACY_POLICY') && api.dispatchCount === 0);
    const toggleAt = async index => { document.querySelectorAll('[role=checkbox]')[index].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(); };
    await toggleAt(1); await click('.submit-button'); snapshots.register = api.snapshot();
    check('registerConsentContract', api.dispatchCount === 1 && api.payloads[0].args.args.type === 'Register' && api.payloads[0].args.args.gdpr_consent.tos && api.payloads[0].args.args.gdpr_consent.privacy && !api.payloads[0].args.args.gdpr_consent.marketing);
    api.emit('error', { event: 'UserAuthenticated' }); await pause(); await toggleAt(2); await click('.submit-button');
    check('marketingOptIn', api.payloads[1].args.args.gdpr_consent.marketing);
    api.emit('error', { event: 'UserAuthenticated' }); await pause(); await click('.guest-login-button'); check('guestNavigates', api.snapshot().authenticated);

    await mount('tv', 'login'); await click('.forgot-password-link');
    check('resetModal', !!query('[role=dialog]') && document.activeElement === query('[role=dialog] input'));
    await change('[role=dialog] input', 'invalid'); await enter('[role=dialog] input'); check('resetInvalid', error('INVALID_EMAIL') && api.externalCalls === 0);
    await change('[role=dialog] input', 'fixture@example.invalid'); await enter('[role=dialog] input');
    check('resetDelegates', api.externalCalls === 1 && api.resetExternal && api.fetchCalls === 0);
    await click('[role=dialog] button'); check('resetCancel', !query('[role=dialog]'));
    await click('.signup-form-button'); check('switchToSignup', !!query(input('PASSWORD_CONFIRM')));
    await click('.login-form-button'); check('switchToLogin', !query(input('PASSWORD_CONFIRM')) && !!query('.forgot-password-link'));
    snapshots.tvAfterActions = api.snapshot();
    for (const mode of ['desktop', 'mobile']) {
        await mount(mode, 'login');
        check(mode + 'OAuthPresent', api.snapshot().oauthControls === 2 && api.externalCalls === 0 && api.fetchCalls === 0 && api.oauthTimers === 0);
        await click('.facebook-button'); check(mode + 'FacebookStart', api.externalCalls === 1 && api.oauthTimers === 1);
        await mount(mode, 'login'); await click('.apple-button'); check(mode + 'AppleStart', api.externalCalls === 1 && api.oauthTimers === 1);
    }
    await mount('tv', 'login'); api.unmount(); await pause(); snapshots.cleanup = api.snapshot();
    check('cleanup', snapshots.cleanup.eventListeners === 0 && snapshots.cleanup.errorListeners === 0);
    check('tvRemountInert', api.fetchCalls === 0 && api.oauthTimers === 0 && api.externalCalls === 0);
    check('zeroErrors', api.errors === 0 && api.rejections === 0 && api.consoleErrors === 0);
    return { checks, snapshots, passed: Object.values(checks).every(Boolean) };
}
