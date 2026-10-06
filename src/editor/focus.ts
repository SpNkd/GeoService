import { useEffect, type RefObject } from 'react';
const popupSelector = 'details[data-popup],details.toolbar-overflow,details.toolbar-menu,details.layer-menu,details.dxf-views,details.view-orientation,details.current-style';
const overlays = new Map<HTMLElement, () => void>();
export function isTextEntry(target: EventTarget | null) {
    return target instanceof Element && !!target.closest('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="file"]),[contenteditable]:not([contenteditable="false"])');
}
export function shortcutSuppressed(target: EventTarget | null, key?: string) {
    return isTextEntry(target) || target instanceof Element && !!target.closest(key === 'Escape' ? 'select,[data-shortcut-suppressed]' : 'select,button,summary,input[type="checkbox"],input[type="radio"],[data-shortcut-suppressed]');
}
export function focusEditor() {
    const target = document.querySelector<SVGElement>('.active-viewport-editor .drawing-canvas') ?? document.querySelector<SVGElement>('[data-testid="layout-canvas"]') ?? document.querySelector<SVGElement>('[data-testid="drawing-canvas"]');
    target?.focus({ preventScroll: true });
}
function openPopups(): HTMLElement[] {
    return [...[...document.querySelectorAll<HTMLDetailsElement>(popupSelector)].filter(e => e.open), ...overlays.keys()];
}
function belongs(popup: HTMLElement, target: Element) {
    return popup.contains(target) || !!(popup.id && target.closest(`[data-popup-owner="${CSS.escape(popup.id)}"]`));
}
function close(popup: HTMLElement) {
    if (popup instanceof HTMLDetailsElement)
        popup.open = false;
    else
        overlays.get(popup)?.();
}
function closePeers(popup: HTMLElement) {
    for (const peer of openPopups())
        if (peer !== popup && !belongs(peer, popup) && !belongs(popup, peer))
            close(peer);
}
/** Registers a controlled floating panel with the same dismissal boundary as details menus. */
export function useEditorPopover(ref: RefObject<HTMLElement | null>, onClose: () => void) {
    useEffect(() => { const popup = ref.current; if (popup)
        overlays.set(popup, onClose); }, [ref, onClose]);
    useEffect(() => { const popup = ref.current; if (!popup)
        return; closePeers(popup); return () => { overlays.delete(popup); }; }, [ref]);
}
/** One event boundary for overlays. Collapsible document/search/diagnostic sections are excluded. */
export function useEditorFocus() {
    useEffect(() => {
        let pointer = false;
        const down = (event: PointerEvent) => {
            pointer = true;
            if (!(event.target instanceof Element))
                return;
            const target = event.target;
            for (const popup of openPopups())
                if (!belongs(popup, target))
                    close(popup);
            if (!isTextEntry(target)&&target.closest('.drawing-canvas,[data-testid="layout-canvas"]'))
                focusEditor();
        };
        const key = (event: KeyboardEvent) => {
            pointer = false;
            if (event.key !== 'Escape')
                return;
            const popups = openPopups();
            if (!popups.length)
                return;
            const target = event.target;
            const focused = target instanceof Element ? popups.filter(p => belongs(p, target)).at(-1) : undefined;
            const popup = focused ?? popups.at(-1)!;
            close(popup);
            event.preventDefault();
            event.stopImmediatePropagation();
            if (popup instanceof HTMLDetailsElement)
                popup.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
            else
                focusEditor();
        };
        const actionCompletions = new WeakMap<MouseEvent, () => void>();
        const click = (event: MouseEvent) => {
            if (!(event.target instanceof Element))
                return;
            const target = event.target, popup = openPopups().filter(p => belongs(p, target)).at(-1), summary = target.closest('summary');
            // Capture the popup before React may unmount it; dismiss only after its action.
            // A closed details opens during the default click action.
            const details = target.closest<HTMLDetailsElement>(popupSelector);
            if (summary && details && summary.parentElement === details) {
                setTimeout(() => { if (details.open)
                    closePeers(details); });
                return;
            }
            if (popup && target.closest('button,[role="button"],[data-popup-action]') && !target.closest('[data-popup-keep-open]')) {
                const fromPointer = pointer;
                let completed = false;
                const complete = () => { if (completed) return; completed = true; close(popup); if (fromPointer && !isTextEntry(document.activeElement)) focusEditor(); };
                actionCompletions.set(event, complete);
                setTimeout(complete);
            }
            else if (pointer && target.closest('button,input[type="checkbox"],input[type="radio"]') && !target.closest('[role="dialog"]')) {
                actionCompletions.set(event, () => { if (!isTextEntry(document.activeElement)) focusEditor(); });
            }
        };
        // React item handlers run at the root before this document bubble boundary.
        // Complete pointer actions before the next key; the task fallback covers stopped bubbling.
        const completeClick = (event: MouseEvent) => actionCompletions.get(event)?.();
        const change = (event: Event) => {
            if (pointer && event.target instanceof HTMLSelectElement && !event.target.closest('[role="dialog"],[data-popup-keep-open]')) {
                const target = event.target;
                queueMicrotask(() => { const popup = target.closest<HTMLDetailsElement>(popupSelector); if (popup)
                    close(popup); focusEditor(); });
            }
        };
        const wheel=(event:WheelEvent)=>{if(event.target instanceof Element&&event.target.closest('.drawing-canvas,[data-testid="layout-canvas"]'))for(const popup of openPopups())if(!belongs(popup,event.target))close(popup);};
        document.addEventListener('pointerdown', down, true);
        document.addEventListener('keydown', key, true);
        document.addEventListener('click', click,true);
        document.addEventListener('click', completeClick);
        document.addEventListener('change', change);document.addEventListener('wheel',wheel,{capture:true,passive:true});
        return () => {
            document.removeEventListener('pointerdown', down, true);
            document.removeEventListener('keydown', key, true);
            document.removeEventListener('click', click,true);
            document.removeEventListener('click', completeClick);
            document.removeEventListener('change', change);document.removeEventListener('wheel',wheel,true);
        };
    }, []);
}
