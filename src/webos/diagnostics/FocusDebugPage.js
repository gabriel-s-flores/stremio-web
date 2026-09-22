// Real controls for the T2.5 focus probe; included only by WEBOS_DEBUG routes.
const React = require('react');
const { default: Button } = require('stremio/components/Button');
const { default: ActionsGroup } = require('stremio/components/ActionsGroup');
const { default: ActionMenu } = require('stremio/components/ActionMenu');
const { default: TextInput } = require('stremio/components/TextInput');
const { default: NumberInput } = require('stremio/components/NumberInput');
const { default: Checkbox } = require('stremio/components/Checkbox');
const { default: RadioButton } = require('stremio/components/RadioButton');
const SearchBar = require('stremio/components/SearchBar');
const MetaItem = require('stremio/components/MetaItem');
const ModalDialog = require('stremio/components/ModalDialog');
const styles = require('./FocusDebugPage.less');

const LABELS = {
    'title': 'T2.5 - Real React controls / 1920 x 1080',
    'button': 'Button',
    'programmatic': 'Programmatic focus (-1)',
    'selected': 'Selected + active',
    'menu': 'Open action menu',
    'modal': 'Open modal'
};
const OPTIONS = [{ label: 'First action', value: 'first' }, { label: 'Second action', value: 'second' }];
const noop = () => undefined;

const FocusDebugPage = () => {
    const [modal, setModal] = React.useState(false);
    const counters = React.useRef({});
    const count = (name) => { counters.current[name] = (counters.current[name] || 0) + 1; };
    React.useEffect(() => {
        window.__t41Fixture = counters.current;
        return () => { delete window.__t41Fixture; };
    }, []);
    return (
        <div className={styles.fixture} data-webos-focus-fixture={'true'}>
            <h1>{LABELS.title}</h1>
            <div className={styles.controls}>
                <section data-focus-case={'buttons'}>
                    <Button className={styles.button} onClick={() => count('button')}>{LABELS.button}</Button>
                    <Button className={styles.button} tabIndex={-1}>{LABELS.programmatic}</Button>
                    <Button className={`${styles.button} selected active`}>{LABELS.selected}</Button>
                </section>
                <section data-focus-case={'actions'}>
                    <ActionsGroup items={[{ icon: 'play', label: 'Play', onClick: () => count('action-play') }, { icon: 'add', label: 'Add', onClick: () => count('action-add') }]} />
                </section>
                <section data-focus-case={'text'}>
                    <TextInput className={styles.text} defaultValue={'Standalone input'} onSubmit={() => count('submit')} />
                </section>
                <section data-focus-case={'search'}>
                    <SearchBar title={'Search'} value={'Search input'} onChange={noop} />
                </section>
                <section data-focus-case={'number'}>
                    <NumberInput defaultValue={42} showButtons={true} label={'Number'} />
                </section>
                <section data-focus-case={'checkbox'}>
                    <Checkbox name={'focus-check'} label={'Checked checkbox'} checked={true} onChange={noop} />
                </section>
                <section data-focus-case={'radio'}>
                    <RadioButton selected={true} onChange={noop} />
                </section>
                <section data-focus-case={'menu'}>
                    <ActionMenu className={styles.button} options={OPTIONS} onSelect={() => count('menu')}>{LABELS.menu}</ActionMenu>
                </section>
                <section data-focus-case={'modal'}>
                    <Button className={styles.button} onClick={() => setModal(true)}>{LABELS.modal}</Button>
                </section>
            </div>
            <div className={styles.poster} data-focus-case={'poster'}>
                <MetaItem type={'movie'} name={'Poster and secondary action'} posterShape={'poster'}
                    href={'#/debug/focus'} options={OPTIONS} actionMenu={true} onDismissClick={() => count('dismiss')} onPlayClick={() => count('play')} optionOnSelect={() => count('poster-menu')} />
            </div>
            {modal ? <ModalDialog title={'T2.5 focus modal'} onCloseRequest={() => setModal(false)}
                buttons={[{ label: 'Close', props: { onClick: () => setModal(false) } }]}>
                <TextInput className={styles.text} defaultValue={'Modal input'} />
            </ModalDialog> : null}
        </div>
    );
};

module.exports = FocusDebugPage;
