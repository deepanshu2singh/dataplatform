export interface DashboardPosition { x: number; y: number; w: number; h: number }
export interface PositionedWidget { id: string; position: DashboardPosition }
export const COLUMNS = 12;
export const ROW_HEIGHT = 32;
export const GAP = 16;
export const MAX_ROWS = 1000;
export const MIN_WIDTH = 3;
export const MIN_HEIGHT = 5;
export const MAX_HEIGHT = 40;
export const MAX_WIDGETS = 40;

export function boundedPosition(p: DashboardPosition): DashboardPosition {
  const integer = (n: number, fallback: number) => Number.isFinite(n) ? Math.round(n) : fallback;
  const w = Math.min(COLUMNS, Math.max(MIN_WIDTH, integer(p.w, 6)));
  const h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, integer(p.h, 10)));
  return { x: Math.min(COLUMNS - w, Math.max(0, integer(p.x, 0))), y: Math.min(MAX_ROWS - h, Math.max(0, integer(p.y, 0))), w, h };
}
export function overlaps(a: DashboardPosition, b: DashboardPosition): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
// The changed item keeps the requested location. Other items move down, never overlap.
// If the finite canvas cannot hold the result, keep the previous complete layout.
export function placeWidget<T extends PositionedWidget>(widgets: T[], id: string, position: DashboardPosition): T[] {
  const target = widgets.find(w => w.id === id);
  if (!target) return widgets;
  const placed: T[] = [{ ...target, position: boundedPosition(position) }];
  for (const item of [...widgets].filter(w => w.id !== id).sort((a,b) => a.position.y-b.position.y || a.position.x-b.position.x)) {
    const p = { ...item.position };
    let collision = placed.find(w => overlaps(p,w.position));
    while (collision) {
      p.y = collision.position.y + collision.position.h;
      if (p.y + p.h > MAX_ROWS) return widgets;
      collision = placed.find(w => overlaps(p,w.position));
    }
    placed.push({ ...item, position: p });
  }
  const positions = new Map(placed.map(w => [w.id,w.position]));
  return widgets.map(w => ({ ...w,position:positions.get(w.id)! }));
}
export function tidyWidgets<T extends PositionedWidget>(widgets: T[]): T[] {
  const placed: T[] = [];
  for (const item of widgets) {
    const p = boundedPosition({ ...item.position, x: 0, y: 0 });
    let found = false;
    for (let y=0; y<=MAX_ROWS-p.h && !found; y++) {
      for (let x=0; x<=COLUMNS-p.w; x++) {
        p.x=x; p.y=y;
        if (!placed.some(w=>overlaps(p,w.position))) { found=true; break; }
      }
    }
    if (!found) return widgets;
    placed.push({ ...item,position:{...p} });
  }
  return placed;
}
// V1 was a one/two-column flow: x/y were ignored. Preserve that visual ordering.
// Conversion is a draft only; GET / viewer never writes to the database.
export function canvasWidgets<T extends PositionedWidget>(widgets: T[], version: 1 | 2 | 3): T[] {
  if (version >= 2) return widgets;
  return tidyWidgets(widgets.map(w=>({ ...w,position:{x:0,y:0,w:w.position.w>=900?12:6,h:Math.max(MIN_HEIGHT,Math.min(MAX_HEIGHT,Math.ceil((w.position.h+100+GAP)/(ROW_HEIGHT+GAP))))} })));
}
export function appendWidget<T extends PositionedWidget>(widgets: T[], widget: T): T[] {
  const bottom=widgets.reduce((n,w)=>Math.max(n,w.position.y+w.position.h),0);
  const next=[...widgets,{...widget,position:boundedPosition({...widget.position,y:bottom})}];
  const placed = placeWidget(next,widget.id,next[next.length-1].position);
  if (placed.some((a,i)=>placed.slice(i+1).some(b=>overlaps(a.position,b.position)))) return widgets;
  return placed;
}
