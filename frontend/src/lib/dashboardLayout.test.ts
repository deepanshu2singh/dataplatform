import { describe,expect,it } from 'vitest';
import { appendWidget,boundedPosition,canvasWidgets,overlaps,placeWidget,tidyWidgets } from './dashboardLayout';
const card=(id:string,x=0,y=0,w=6,h=8)=>({id,position:{x,y,w,h},config:{query:'keep me'}});
function assertSafe(cards:ReturnType<typeof card>[]) {
  for(let i=0;i<cards.length;i++) {
    const p=cards[i].position;
    expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x+p.w).toBeLessThanOrEqual(12);
    expect(p.y+p.h).toBeLessThanOrEqual(1000);
    for(const other of cards.slice(i+1))expect(overlaps(p,other.position)).toBe(false);
  }
}
describe('persisted dashboard canvas',()=>{
  it('opens legacy flow in its original order without mutating stored positions',()=>{
    const old=[card('a',0,0,600,360),card('b',0,380,600,260),card('c',0,760,1200,520)];
    const snapshot=structuredClone(old);const converted=canvasWidgets(old,1);
    expect(old).toEqual(snapshot);expect(converted.map(w=>w.id)).toEqual(['a','b','c']);
    expect(converted[0].position).toEqual({x:0,y:0,w:6,h:10});
    expect(converted[1].position.x).toBe(6);expect(converted[2].position.w).toBe(12);assertSafe(converted);
  });
  it('retains exact saved version 2 coordinates, dimensions, IDs and config',()=>{
    const saved=[card('a',3,12,9,16),card('b',0,0,4,8)];
    expect(canvasWidgets(JSON.parse(JSON.stringify(saved)),2)).toEqual(saved);
  });
  it('moves and resizes without overlap, preserving unrelated content and requested position',()=>{
    let cards=[card('a'),card('b',6),card('c',0,8,12,10)];
    cards=placeWidget(cards,'b',{x:0,y:0,w:12,h:15});
    expect(cards[1].position).toEqual({x:0,y:0,w:12,h:15});
    expect(cards.every(w=>w.config.query==='keep me')).toBe(true);assertSafe(cards);
  });
  it('bounds invalid input and rejects moves that would spill beyond finite canvas',()=>{
    expect(boundedPosition({x:99,y:9999,w:44,h:999})).toEqual({x:0,y:960,w:12,h:40});
    const full=[card('a',0,960,12,40),card('b',0,920,12,40)];
    expect(placeWidget(full,'b',{x:0,y:960,w:12,h:40})).toEqual(full);
  });
  it('duplicates at a free position and tidies 40 varied cards deterministically',()=>{
    const cards=tidyWidgets(Array.from({length:40},(_,i)=>card(String(i),0,0,3+i%10,8+i%20)));
    expect(new Set(cards.map(w=>w.id)).size).toBe(40);assertSafe(cards);
    expect(tidyWidgets(cards)).toEqual(cards);
    const duplicate={...structuredClone(cards[0]),id:'copy'};
    const next=appendWidget(cards,duplicate);expect(next).toHaveLength(41);assertSafe(next);
  });
  it('refuses an addition to a full finite canvas without returning an overlapping draft',()=>{
    const full=Array.from({length:25},(_,i)=>card(String(i),0,i*40,12,40));
    expect(appendWidget(full,card('extra'))).toBe(full);
  });

});
