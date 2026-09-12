import React from 'react';
export { default as Button } from '../src/components/Button';
export { default as TextInput } from '../src/components/TextInput';
export { default as Checkbox } from '../src/components/Checkbox';
export { default as useBinaryState } from '../src/common/useBinaryState';
export const usePlatform = () => window.__t311.platform;
export const useCore = () => window.__t311.core;
export const useTranslation = () => ({ t: key => key });
export default function useRouteFocused() { return true; }
export const Image = props => <img {...props} />;
export function ModalDialog({ children, buttons }) {
    return <div role="dialog" className="fixture-modal">{children}{buttons.map((button, i) =>
        <button key={i} {...button.props}>{button.label}</button>)}</div>;
}
