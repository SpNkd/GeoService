import type { ButtonHTMLAttributes, ComponentProps } from 'react';
import { Icon } from './Icon';
type Props=Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'> & {label:string;icon:ComponentProps<typeof Icon>['name']};
export function IconButton({label,icon,className='',...props}:Props){return <button type="button" {...props} className={`editor-icon-button ${className}`} aria-label={label} title={props.title??label}><Icon name={icon} size={18}/></button>;}
export function CloseButton(props:Omit<Props,'icon'>){return <IconButton {...props} icon="close"/>;}
