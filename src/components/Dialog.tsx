import './dialog.css';
import { useId, useRef, type ReactNode } from 'react';
import { useEditorDialog } from '../editor/dialogs';
import { CloseButton } from './IconButton';
interface Props { title: string; subtitle?: string; size?: 'sm'|'md'|'lg'|'xl'; closeLabel?: string; onClose: () => void; onDismiss?: () => void; children: ReactNode; footer?: ReactNode; className?: string; initialFocus?: string; focusAfterClose?:()=>HTMLElement|SVGElement|null }
/** All user-facing modal shells share this primitive and the editor's one event boundary. */
export function Dialog({title,subtitle,size='md',closeLabel=`Закрыть: ${title}`,onClose,onDismiss=onClose,children,footer,className='',initialFocus,focusAfterClose}:Props) {
  const id=useId(),ref=useRef<HTMLElement>(null);
  useEditorDialog(ref,onDismiss,initialFocus,focusAfterClose);
  return <div className="dialog-backdrop" role="presentation" data-dialog-backdrop><section id={`${id}-dialog`} ref={ref} className={`editor-dialog dialog-${size} ${className}`} role="dialog" aria-modal="true" aria-label={title} aria-labelledby={`${id}-title`} aria-describedby={subtitle?`${id}-description`:undefined} data-shortcut-suppressed tabIndex={-1}>
    <DialogHeader><div><h2 id={`${id}-title`}>{title}</h2>{subtitle&&<p id={`${id}-description`}>{subtitle}</p>}</div><CloseButton label={closeLabel} onClick={onClose}/></DialogHeader>
    <DialogBody>{children}</DialogBody><DialogFooter>{footer??<button onClick={onClose}>Закрыть</button>}</DialogFooter>
  </section></div>;
}
export function DialogHeader({children}:{children:ReactNode}) {return <header className="dialog-header">{children}</header>;}
export function DialogBody({children}:{children:ReactNode}) {return <div className="dialog-body">{children}</div>;}
export function DialogFooter({children}:{children:ReactNode}) {return <footer className="dialog-footer">{children}</footer>;}
