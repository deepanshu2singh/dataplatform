import { fireEvent,render,screen } from '@testing-library/react';
import { useState } from 'react';
import { describe,expect,it,vi } from 'vitest';
import { DashboardCanvas } from './DashboardCanvas';
const initial=[{id:'a',title:'Revenue',position:{x:0,y:0,w:6,h:8}},{id:'b',title:'Orders',position:{x:6,y:0,w:6,h:8}}];
function Harness({locked=false}:{locked?:boolean}) {
  const [widgets,set]=useState(initial);
  return <DashboardCanvas widgets={widgets} locked={locked} onChange={set} renderWidget={w=><div>{w.title}</div>}/>;
}
describe('dashboard canvas accessibility',()=>{
  it('moves/resizes with arrow keys, resolves collisions and exposes new placement',()=>{
    render(<Harness/>);
    fireEvent.keyDown(screen.getByRole('button',{name:'Move Revenue'}),{key:'ArrowDown'});
    expect(screen.getByRole('region',{name:'Revenue widget'})).toHaveAttribute('data-position','0,1,6,8');
    fireEvent.keyDown(screen.getByRole('button',{name:'Resize Revenue'}),{key:'ArrowRight'});
    expect(screen.getByRole('region',{name:'Revenue widget'})).toHaveAttribute('data-position','0,1,7,8');
    expect(screen.getByRole('region',{name:'Orders widget'})).toHaveAttribute('data-position','6,9,6,8');
  });
  it('blocks placement when locked and renders viewer without editing handles',()=>{
    const {unmount}=render(<Harness locked/>);
    expect(screen.getByRole('button',{name:'Move Revenue'})).toBeDisabled();
    unmount();render(<DashboardCanvas widgets={initial} renderWidget={w=><div>{w.title}</div>}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('stacks small screens without rewriting saved desktop positions',()=>{
    vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
    const change=vi.fn();render(<DashboardCanvas widgets={initial} locked={false} onChange={change} renderWidget={w=><div>{w.title}</div>}/>);
    expect(screen.getByRole('button',{name:'Move Revenue'})).toBeDisabled();
    expect(screen.getByRole('region',{name:'Orders widget'})).toHaveAttribute('data-position','6,0,6,8');expect(change).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
});
