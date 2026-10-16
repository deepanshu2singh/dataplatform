import { useState } from 'react';
import { act,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { api } from '../../lib/api';
import { WidgetPresentationEditor } from './WidgetPresentationEditor';
import type { DashboardWidget } from '../../lib/dashboardTypes';
const initial:DashboardWidget={id:'a',type:'chart',title:'Sales',position:{x:0,y:0,w:6,h:10},source:{dataset_id:1,query:'SELECT * FROM dataset',limit:100},config:{chart_type:'bar',x_column:'product',y_column:'revenue'}};
function Harness({type='chart',resultColumns=[]}:{type?:'chart'|'table'|'metric';resultColumns?:string[]}){
  const [widget,set]=useState({...initial,type,config:type==='chart'?initial.config:type==='metric'?{value_column:'revenue'}:{}});
  const currentResult=widget.source?.dataset_id===1&&widget.source.query===initial.source!.query?resultColumns:[];
  return <><button onClick={()=>set({...widget,source:{...widget.source!,dataset_id:2,query:'SELECT newColumn FROM dataset'}})}>Change source</button><button onClick={()=>set({...widget,source:{...widget.source!,query:'SELECT revenue AS newColumn FROM dataset'}})}>Change query</button><WidgetPresentationEditor widget={widget} onChange={config=>set({...widget,config})} resultColumns={currentResult}/><output aria-label="Current config">{JSON.stringify(widget.config)}</output></>;
}
const config=()=>JSON.parse(screen.getByLabelText('Current config').textContent!);
const select=(name:string)=>screen.getByRole('combobox',{name});
afterEach(()=>vi.restoreAllMocks());
describe('connected presentation controls',()=>{
  it('offers all ten real chart types and changes formatting without executing SQL',async()=>{
    const call=vi.spyOn(api,'post');const user=userEvent.setup();render(<Harness/>);
    expect(select('Chart type').children).toHaveLength(10);
    await user.selectOptions(select('Chart type'),'combo');
    expect(select('Second numeric column')).toBeInTheDocument();
    await user.selectOptions(select('Palette'),'warm');
    await user.selectOptions(select('Format'),'currency');
    await user.selectOptions(select('Currency'),'GBP');
    expect(config()).toMatchObject({chart_type:'combo',palette:'warm',format:'currency',currency:'GBP',series_column:null});expect(call).not.toHaveBeenCalled();
  });
  it('loads actual query columns into native dropdowns and preserves alias selections without extra SQL',async()=>{
    const call=vi.spyOn(api,'post').mockResolvedValue({data:{success:true,columns:['product','total_revenue']}});const user=userEvent.setup();render(<Harness/>);
    expect(select('Y / numeric column')).toBeDisabled();expect(config().y_column).toBe('revenue');
    await user.click(screen.getByRole('button',{name:'Load query fields'}));
    expect(await screen.findByText(/2 returned fields/)).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('/sql/query',{dataset_id:1,query:'SELECT * FROM dataset',limit:1},expect.objectContaining({signal:expect.any(AbortSignal)}));
    const y=select('Y / numeric column');expect(y.tagName).toBe('SELECT');expect(y).toHaveAttribute('aria-invalid','true');
    expect(within(y).getByRole('option',{name:'total_revenue'})).toBeInTheDocument();
    expect(within(y).getByRole('option',{name:/revenue — not returned/})).toBeDisabled();expect(config().y_column).toBe('revenue');
    await user.selectOptions(y,'total_revenue');expect(config().y_column).toBe('total_revenue');expect(y).not.toHaveAttribute('aria-invalid');expect(call).toHaveBeenCalledTimes(1);
    expect(document.querySelector('datalist')).toBeNull();expect(y).not.toHaveAttribute('list');
  });
  it('uses existing preview fields immediately without loading or rewriting saved choices',()=>{
    const call=vi.spyOn(api,'post');render(<Harness resultColumns={['product','revenue']}/>);
    expect(select('X / category column')).toBeEnabled();expect(select('Y / numeric column')).toHaveValue('revenue');
    expect(config()).toEqual(initial.config);expect(call).not.toHaveBeenCalled();
  });
  it('aborts discovery and never exposes late fields from a previous dataset',async()=>{
    let resolve!:(value:unknown)=>void;let signal:AbortSignal|undefined;
    vi.spyOn(api,'post').mockImplementationOnce((_url,_data,options)=>{signal=options?.signal as AbortSignal;return new Promise(r=>{resolve=r;}) as never;}).mockResolvedValueOnce({data:{success:true,columns:['newColumn']}});
    const user=userEvent.setup();render(<Harness/>);await user.click(screen.getByRole('button',{name:'Load query fields'}));await user.click(screen.getByRole('button',{name:'Change source'}));
    expect(signal?.aborted).toBe(true);await act(async()=>resolve({data:{success:true,columns:['oldColumn']}}));expect(screen.queryByRole('option',{name:'oldColumn'})).toBeNull();expect(select('Y / numeric column')).toBeDisabled();
    await user.click(screen.getByRole('button',{name:'Load query fields'}));await waitFor(()=>expect(within(select('Y / numeric column')).getByRole('option',{name:'newColumn'})).toBeInTheDocument());
  });
  it('invalidates choices after SQL changes and discovers new aliases while retaining the saved field',async()=>{
    vi.spyOn(api,'post').mockResolvedValue({data:{success:true,columns:['newColumn']}});const user=userEvent.setup();render(<Harness resultColumns={['product','revenue']}/>);
    await user.click(screen.getByRole('button',{name:'Change query'}));expect(select('Y / numeric column')).toBeDisabled();expect(config().y_column).toBe('revenue');
    await user.click(screen.getByRole('button',{name:'Load query fields'}));await screen.findByText(/1 returned fields/);
    expect(select('Y / numeric column')).toHaveAttribute('aria-invalid','true');expect(within(select('Y / numeric column')).queryByRole('option',{name:'product'})).toBeNull();
    await user.selectOptions(select('Y / numeric column'),'newColumn');expect(config().y_column).toBe('newColumn');
  });
  it('shows SQL discovery errors and preserves existing valid options on retry failure',async()=>{
    vi.spyOn(api,'post').mockResolvedValueOnce({data:{success:false,error:'Unknown column in SQL'}}).mockRejectedValueOnce({response:{status:500,data:{}}});const user=userEvent.setup();render(<Harness resultColumns={['product','revenue']}/>);
    await user.click(screen.getByRole('button',{name:'Load query fields'}));expect(await screen.findByRole('alert')).toHaveTextContent('Unknown column in SQL');expect(select('Y / numeric column')).toHaveValue('revenue');
    await user.click(screen.getByRole('button',{name:'Load query fields'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Could not load query fields.'));expect(select('Y / numeric column')).toBeEnabled();expect(config()).toEqual(initial.config);
  });
  it('connects optional series and combo fields with a clear None option',async()=>{
    const call=vi.spyOn(api,'post');const user=userEvent.setup();render(<Harness resultColumns={['product','revenue','region','orders']}/>);
    await user.selectOptions(select('Series column (optional)'),'region');expect(config().series_column).toBe('region');
    await user.selectOptions(select('Series column (optional)'),'');expect(config().series_column).toBeNull();
    await user.selectOptions(select('Chart type'),'combo');await user.selectOptions(select('Second numeric column'),'orders');expect(config().y2_column).toBe('orders');
    await user.selectOptions(select('Chart type'),'stacked_bar');const series=select('Series column (required)');expect(within(series).queryByRole('option',{name:'None'})).toBeNull();await user.selectOptions(series,'region');expect(config().series_column).toBe('region');expect(call).not.toHaveBeenCalled();
  });
  it('connects metric value and table sort fields to the actual returned aliases',async()=>{
    const user=userEvent.setup();const {unmount}=render(<Harness type="metric" resultColumns={['revenue','total_revenue']}/>);
    await user.selectOptions(select('Value column'),'total_revenue');expect(config().value_column).toBe('total_revenue');unmount();
    render(<Harness type="table" resultColumns={['product','revenue']}/>);await user.selectOptions(select('Default sort column (optional)'),'revenue');expect(config().sort_column).toBe('revenue');await user.selectOptions(select('Default sort column (optional)'),'');expect(config().sort_column).toBeNull();
    await user.click(screen.getByRole('checkbox',{name:'product'}));expect(config().columns).toEqual(['revenue']);
  });
  it('persists per-column table width and formatting from loaded fields',async()=>{
    vi.spyOn(api,'post').mockResolvedValue({data:{success:true,columns:['product','revenue']}});const user=userEvent.setup();render(<Harness type="table"/>);
    await user.click(screen.getByRole('button',{name:'Load query fields'}));await screen.findByText(/2 returned fields/);
    await user.selectOptions(select('Configure column'),'revenue');
    const width=screen.getByRole('spinbutton',{name:'Column width (px)'});await user.clear(width);await user.type(width,'180');
    await user.selectOptions(select('Format'),'currency');await user.selectOptions(select('Currency'),'GBP');
    expect(config().column_options.revenue).toMatchObject({width:180,format:'currency',currency:'GBP'});
  });
});
