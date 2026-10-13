import { useEffect,useState } from 'react';
/** Keep intermediate strings (empty, decimal point) out of the valid document until committed. */
export function StudioNumberControl({label,value,min,max,step,onCommit}:{label:string;value:number;min:number;max:number;step:number;onCommit:(n:number)=>void}) {
  const [text,setText]=useState(String(value));
  useEffect(()=>setText(String(value)),[value]);
  function commit(){const number=Number(text);if(text.trim()&&Number.isFinite(number)&&number>=min&&number<=max)onCommit(number);else setText(String(value));}
  return <label>{label}<input type="number" value={text} min={min} max={max} step={step} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){commit();e.currentTarget.blur();}if(e.key==='Escape')setText(String(value));}}/></label>;
}
