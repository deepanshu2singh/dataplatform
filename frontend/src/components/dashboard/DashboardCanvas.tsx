import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Grip, MoveDiagonal2 } from 'lucide-react';
import { COLUMNS, GAP, ROW_HEIGHT, MAX_ROWS, boundedPosition, placeWidget } from '../../lib/dashboardLayout';
import type { DashboardPosition, PositionedWidget } from '../../lib/dashboardLayout';

interface Gesture<T> { id:string; mode:'move'|'resize'; pointerId:number; startX:number;startY:number; width:number;initial:T[]; preview:T[] }
export function DashboardCanvas<T extends PositionedWidget & {title:string}>({widgets,locked=true,onChange,renderWidget}: {
  widgets:T[];locked?:boolean;onChange?:(widgets:T[])=>void;renderWidget:(widget:T)=>ReactNode;
}) {
  const canvas=useRef<HTMLDivElement>(null);
  const gesture=useRef<Gesture<T>|null>(null);
  const [draftState,setDraft]=useState<{base:T[];widgets:T[]}|null>(null);
  const draft = !locked && draftState?.base === widgets ? draftState.widgets : null;
  const [announcement,setAnnouncement]=useState('');
  const [mobile,setMobile]=useState(()=>typeof matchMedia==='function' && matchMedia('(max-width: 767px)').matches);
  const cancel=()=>{gesture.current=null;setDraft(null);};
  useEffect(()=>{
    if (typeof window.matchMedia !== 'function') return;
    const media=window.matchMedia('(max-width: 767px)');
    const update=()=>{setMobile(media.matches);gesture.current=null;setDraft(null);};
    media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[]);
  useEffect(()=>{
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape' && gesture.current){gesture.current=null;setDraft(null);setAnnouncement('Layout change cancelled.');}};
    window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);
  },[]);
  // A new document or a lock cancels an in-progress gesture instead of committing stale data.
  useEffect(()=>{gesture.current=null;},[widgets,locked]);
  const start=(event:PointerEvent<HTMLButtonElement>,widget:T,mode:'move'|'resize')=>{
    if(locked || mobile || !onChange || event.button!==0 || !canvas.current)return;
    event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current={id:widget.id,mode,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,width:canvas.current.getBoundingClientRect().width,initial:widgets,preview:widgets};
  };
  const move=(event:PointerEvent<HTMLButtonElement>)=>{
    const g=gesture.current;if(!g || event.pointerId!==g.pointerId)return;
    const item=g.initial.find(w=>w.id===g.id)!;
    const dx=Math.round((event.clientX-g.startX)/((g.width+GAP)/COLUMNS));
    const dy=Math.round((event.clientY-g.startY)/(ROW_HEIGHT+GAP));
    const p=g.mode==='move'?{...item.position,x:item.position.x+dx,y:item.position.y+dy}:{...item.position,w:item.position.w+dx,h:item.position.h+dy};
    g.preview=placeWidget(g.initial,g.id,p);setDraft({base:g.initial,widgets:g.preview});
  };
  const finish=(event:PointerEvent<HTMLButtonElement>)=>{
    const g=gesture.current;if(!g || event.pointerId!==g.pointerId)return;
    gesture.current=null;setDraft(null);
    if(JSON.stringify(g.initial)!==JSON.stringify(g.preview))onChange?.(g.preview);
    const p=g.preview.find(w=>w.id===g.id)!.position;
    setAnnouncement(`Position column ${p.x+1}, row ${p.y+1}. Size ${p.w} columns by ${p.h} rows. Save to keep this layout.`);
  };
  const key=(event:KeyboardEvent<HTMLButtonElement>,widget:T,mode:'move'|'resize')=>{
    if(locked||mobile||!onChange||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const step=event.shiftKey?2:1;
    const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0;
    const dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
    const p:DashboardPosition=mode==='move'?{...widget.position,x:widget.position.x+dx,y:widget.position.y+dy}:{...widget.position,w:widget.position.w+dx,h:widget.position.h+dy};
    const next=placeWidget(widgets,widget.id,p);onChange(next);
    const pos=next.find(w=>w.id===widget.id)!.position;
    setAnnouncement(`Column ${pos.x+1}, row ${pos.y+1}, width ${pos.w}, height ${pos.h}.`);
  };
  const displayed=draft??widgets;
  return <>
    <p id="dashboard-canvas-help" className="sr-only">Use arrow keys on a move or resize handle. Shift moves two steps. Escape cancels a drag. Overlapping cards move down. Save keeps the layout. On small screens, use Placement controls in Edit widget.</p>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    <div ref={canvas} className={`dashboard-canvas ${!locked?'is-editable':''} ${draft?'is-dragging':''}`} data-testid="dashboard-canvas" style={{'--canvas-rows':Math.min(MAX_ROWS,Math.max(8,...displayed.map(w=>w.position.y+w.position.h)))} as React.CSSProperties}>
      {displayed.map(widget=>{
        const p=boundedPosition(widget.position);
        return <section key={widget.id} className="dashboard-canvas-item" data-widget-id={widget.id} data-position={`${p.x},${p.y},${p.w},${p.h}`} style={{gridColumn:`${p.x+1} / span ${p.w}`,gridRow:`${p.y+1} / span ${p.h}`,'--mobile-height':`${Math.min(640,p.h*(ROW_HEIGHT+GAP)-GAP)}px`} as React.CSSProperties} aria-label={`${widget.title} widget`}>
          {onChange && <div className="dashboard-move-strip"><button type="button" className="dashboard-move-handle" disabled={locked||mobile} aria-label={`Move ${widget.title}`} aria-describedby="dashboard-canvas-help" onPointerDown={e=>start(e,widget,'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={e=>key(e,widget,'move')}><Grip size={14}/><span>{locked?'Layout locked':mobile?'Stacked view':'Drag to move'}</span></button><span className="dashboard-size-label">{p.w} × {p.h}</span></div>}
          {renderWidget(widget)}
          {onChange && <button type="button" className="dashboard-resize-handle" disabled={locked||mobile} aria-label={`Resize ${widget.title}`} aria-describedby="dashboard-canvas-help" onPointerDown={e=>start(e,widget,'resize')} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={e=>key(e,widget,'resize')}><MoveDiagonal2 size={17}/></button>}
        </section>;
      })}
    </div>
  </>;
}
