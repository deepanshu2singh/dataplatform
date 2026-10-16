import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
// Keep a number draft while typing; enforce bounds when the field is left.
export function PresentationNumberInput({value,min,max,onCommit,allowEmpty=false,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'|'min'|'max'|'onBlur'> & {value:number|null|undefined;min:number;max:number;allowEmpty?:boolean;onCommit:(value:number|null)=>void}) {
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState('');
  return <input {...props} type="number" min={min} max={max} value={editing?draft:value??''} onFocus={()=>{setDraft(String(value??''));setEditing(true);}} onChange={e=>{setDraft(e.target.value);setEditing(true);}} onBlur={()=>{
    setEditing(false);
    if(!draft.trim()){if(allowEmpty)onCommit(null);return;}
    const n=Number(draft);if(Number.isFinite(n))onCommit(Math.max(min,Math.min(max,Math.round(n))));
  }} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/>;
}
