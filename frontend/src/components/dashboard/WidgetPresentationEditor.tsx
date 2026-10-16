import { PresentationNumberInput } from './PresentationNumberInput';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { isCanceledRequest, useLatestRequest } from '../../hooks/useLatestRequest';
import { CHART_TYPES } from '../../lib/dashboardTypes';
import type { ColumnOptions, DashboardWidget, NumberOptions, PresentationOptions } from '../../lib/dashboardTypes';
const inputClass='presentation-input';
function Field({label,children}:{label:string;children:ReactNode}) {return <label className="presentation-field"><span>{label}</span>{children}</label>;}
function Check({label,checked,onChange}:{label:string;checked:boolean;onChange:(value:boolean)=>void}) {return <label className="presentation-check"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/>{label}</label>;}
function NumericEditor({options,onChange,allowText=false}:{options:NumberOptions;onChange:(key:string,value:unknown)=>void;allowText?:boolean}) {
  return <>
    <Field label="Format"><select className={inputClass} value={options.format??'number'} onChange={e=>onChange('format',e.target.value)}><option value="number">Number</option><option value="currency">Currency</option><option value="percent">Percent</option>{allowText&&<option value="text">Text / original value</option>}</select></Field>
    <Field label="Decimals"><input className={inputClass} type="number" min={0} max={6} value={options.decimals??2} onChange={e=>onChange('decimals',Math.max(0,Math.min(6,Math.round(Number(e.target.value)))))}/></Field>
    {options.format==='currency'&&<Field label="Currency"><select className={inputClass} value={options.currency??''} onChange={e=>onChange('currency',e.target.value||null)}><option value="">Custom prefix / suffix</option>{['GBP','USD','EUR','INR','CAD','AUD','JPY'].map(c=><option key={c} value={c}>{c}</option>)}</select></Field>}
    {options.format==='percent'&&<Field label="Percent values"><select className={inputClass} value={options.percent_scale??'whole'} onChange={e=>onChange('percent_scale',e.target.value)}><option value="whole">25 means 25%</option><option value="fraction">0.25 means 25%</option></select></Field>}
    <Field label="Prefix (optional)"><input className={inputClass} value={options.prefix??''} maxLength={32} onChange={e=>onChange('prefix',e.target.value||null)} placeholder="£"/></Field>
    <Field label="Suffix (optional)"><input className={inputClass} value={options.suffix??''} maxLength={32} onChange={e=>onChange('suffix',e.target.value||null)} placeholder="units"/></Field>
    <Check label="Compact numbers" checked={options.compact??false} onChange={value=>onChange('compact',value)}/>
  </>;
}
export function WidgetPresentationEditor({widget,onChange,resultColumns=[]}:{widget:DashboardWidget;onChange:(config:Record<string,unknown>)=>void;resultColumns?:string[]}) {
  const o=widget.config as PresentationOptions;
  const key=JSON.stringify([widget.source?.dataset_id,widget.source?.query]);
  const latest=useRef(key);
  const [discovery,setDiscovery]=useState<{key:string;columns:string[];error:string;loading:boolean}|null>(null);
  const request=useLatestRequest();
  useLayoutEffect(()=>{latest.current=key;request.cancel();},[key,request]);
  const id=useId();
  const columns=[...new Set(discovery?.key===key?discovery.columns:resultColumns)];
  const current=discovery?.key===key?discovery:null;
  const set=(name:string,value:unknown)=>onChange({...widget.config,[name]:value});
  const discover=async()=>{
    if(!widget.source?.dataset_id||!widget.source.query.trim())return;
    const token=request.begin();setDiscovery({key,columns,error:'',loading:true});
    try {
      const response=await api.post<{success:boolean;columns:string[];error?:string|null}>('/sql/query',{dataset_id:widget.source.dataset_id,query:widget.source.query,limit:1},{signal:token.signal});
      if(!token.isCurrent()||latest.current!==key)return;
      if(!response.data.success){
        setDiscovery({key,columns,error:response.data.error||'Query could not load fields.',loading:false});
        return;
      }
      setDiscovery({key,columns:response.data.columns,error:'',loading:false});
    }catch(error){
      if(token.isCurrent()&&latest.current===key&&!isCanceledRequest(error))setDiscovery({key,columns,error:getApiErrorMessage(error,'Could not load query fields.'),loading:false});
    }finally{token.finish();}
  };
  const column=(name:string,label:string,optional=false)=>{
    const value=String(widget.config[name]??'');
    const missing=Boolean(value&&columns.length&&!columns.includes(value));
    return <Field label={label}>
      <select className={inputClass} aria-label={label} aria-describedby={`${id}-fields-help${missing?' '+id+'-'+name+'-missing':''}`} aria-invalid={missing||undefined} value={value} disabled={!columns.length||current?.loading} onChange={e=>set(name,e.target.value||(optional?null:''))}>
        <option value="" disabled={!optional}>{optional?'None':columns.length?'Select a returned column':'Load query fields first'}</option>
        {value&&!columns.includes(value)&&<option value={value} disabled>{value}{columns.length?' — not returned by this query':' — load fields to verify'}</option>}
        {columns.map(name=><option key={name} value={name}>{name}</option>)}
      </select>
      {missing&&<span id={`${id}-${name}-missing`} className="dashboard-result-note" role="status">This saved column is not returned by the query. Choose a returned column.</span>}
    </Field>;
  };
  const type=o.chart_type??'bar',pie=type==='pie'||type==='donut',combo=type==='combo';
  const visible=o.columns?.length?o.columns:columns;
  const [selectedColumn,setSelectedColumn]=useState('');
  const tableColumn=columns.includes(selectedColumn)?selectedColumn:columns[0]??'';
  const columnOptions=o.column_options??{};
  const selectedSettings:ColumnOptions=columnOptions[tableColumn]??{format:'text'};
  const setColumn=(name:string,value:unknown)=>set('column_options',{...columnOptions,[tableColumn]:{...selectedSettings,[name]:value}});
  return <div className="presentation-editor">
    <div className="presentation-field-loader"><div><strong>Query fields</strong><p>Load the columns returned by this SQL query, including any aliases. One result row is requested.</p></div><button type="button" onClick={()=>void discover()} disabled={current?.loading||!widget.source?.dataset_id||!widget.source.query.trim()}>{current?.loading?'Loading fields…':'Load query fields'}</button></div>
    {current?.error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{current.error}</p>}
    <p id={`${id}-fields-help`} className="dashboard-result-note">{columns.length?`${columns.length} returned fields available. Select columns from the dropdowns. Reload fields after changing the dataset or SQL.`:'Load query fields to enable the column dropdowns. Existing choices are kept until you select a replacement.'}</p>
    <div className="presentation-grid">
      {widget.type==='chart'&&<>
        <Field label="Chart type"><select className={inputClass} value={type} onChange={e=>{
          const next=e.target.value;onChange({...widget.config,chart_type:next,...(next==='combo'||next==='pie'||next==='donut'?{series_column:null}:{}),...(next!=='combo'?{y2_column:null}:{})});
        }}>{CHART_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
        {column('x_column',type==='scatter'?'X / numeric column':'X / category column')}
        {column('y_column','Y / numeric column')}
        {combo?column('y2_column','Second numeric column'):!pie&&column('series_column',type.startsWith('stacked')?'Series column (required)':'Series column (optional)',!type.startsWith('stacked'))}
        {type.startsWith('stacked')&&<p className="dashboard-result-note">Return one row per category and series. Use GROUP BY in SQL; stacked charts do not aggregate truncated results.</p>}
        <Field label="Palette"><select className={inputClass} value={o.palette??'teal'} onChange={e=>set('palette',e.target.value)}><option value="teal">Teal / navy</option><option value="ocean">Ocean</option><option value="warm">Warm</option><option value="mono">Muted tonal</option></select></Field>
        {!pie&&<>
          <Field label="X axis title"><input className={inputClass} value={o.x_axis_title??''} maxLength={100} onChange={e=>set('x_axis_title',e.target.value||null)}/></Field>
          <Field label="Y axis title"><input className={inputClass} value={o.y_axis_title??''} maxLength={100} onChange={e=>set('y_axis_title',e.target.value||null)}/></Field>
          {combo&&<><Check label="Separate right axis" checked={o.secondary_axis!==false} onChange={v=>set('secondary_axis',v)}/><Field label="Right axis title"><input className={inputClass} value={o.right_axis_title??''} maxLength={100} onChange={e=>set('right_axis_title',e.target.value||null)}/></Field></>}
          {['line','area','stacked_area','combo'].includes(type)&&<Field label="Line shape"><select className={inputClass} value={o.curve??'monotone'} onChange={e=>set('curve',e.target.value)}><option value="monotone">Smooth</option><option value="linear">Straight</option><option value="step">Step</option></select></Field>}
          <Check label="Show grid" checked={o.show_grid!==false} onChange={v=>set('show_grid',v)}/>
        </>}
        <Check label="Show legend" checked={o.show_legend!==false} onChange={v=>set('show_legend',v)}/>
        <Check label="Show data labels" checked={o.show_labels??false} onChange={v=>set('show_labels',v)}/>
        <Field label="Order returned points"><select className={inputClass} value={o.sort_by??'none'} onChange={e=>set('sort_by',e.target.value)}><option value="none">Query order</option><option value="label">Category / X value</option><option value="value">Primary Y value</option></select></Field>
        <Field label="Order direction"><select className={inputClass} value={o.sort_direction??'asc'} onChange={e=>set('sort_direction',e.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></Field>
        <NumericEditor options={o} onChange={set}/>
      </>}
      {widget.type==='metric'&&<>
        {column('value_column','Value column')}
        <Field label="Label (optional)"><input className={inputClass} value={o.label??''} maxLength={255} onChange={e=>set('label',e.target.value||null)} placeholder="Total revenue"/></Field>
        <NumericEditor options={o} onChange={set} allowText/>
      </>}
      {widget.type==='table'&&<>
        <Field label="Default rows per page"><select className={inputClass} value={o.page_size??25} onChange={e=>set('page_size',Number(e.target.value))}>{[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="Row spacing"><select className={inputClass} value={o.density??'comfortable'} onChange={e=>set('density',e.target.value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field>
        {column('sort_column','Default sort column (optional)',true)}
        <Field label="Default sort direction"><select className={inputClass} value={o.sort_direction??'asc'} onChange={e=>set('sort_direction',e.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></Field>
        <Check label="Show row numbers" checked={o.show_row_numbers??false} onChange={v=>set('show_row_numbers',v)}/>
        {columns.length?<fieldset className="presentation-column-list"><legend>Visible columns</legend><button type="button" className="presentation-text-button" onClick={()=>set('columns',null)}>Show all columns</button>{o.columns?.some(name=>!columns.includes(name))&&<p className="dashboard-result-note" role="status">Some saved visible columns are missing from this query. Choose Show all columns to reset the selection.</p>}{columns.map(name=><Check key={name} label={name} checked={visible.includes(name)} onChange={checked=>{
          const next=checked?columns.filter(c=>c===name||visible.includes(c)):visible.filter(c=>c!==name);if(next.length)set('columns',next);
        }}/>)}</fieldset>:<p className="dashboard-result-note">Load query fields to choose visible columns and per-column formatting.</p>}
        {!!columns.length&&<fieldset className="presentation-column-settings"><legend>Column formatting</legend><button type="button" className="presentation-text-button" onClick={()=>set('column_options',{})}>Clear column formatting</button><div className="presentation-grid">
          <Field label="Configure column"><select className={inputClass} value={tableColumn} onChange={e=>setSelectedColumn(e.target.value)}>{columns.map(name=><option key={name} value={name}>{name}</option>)}</select></Field>
          <Field label="Column width (px)"><PresentationNumberInput className={inputClass} min={80} max={600} value={selectedSettings.width} placeholder="Auto" allowEmpty onCommit={value=>setColumn('width',value)}/></Field>
          <Field label="Alignment"><select className={inputClass} value={selectedSettings.align??'auto'} onChange={e=>setColumn('align',e.target.value)}>{['auto','left','center','right'].map(v=><option key={v} value={v}>{v}</option>)}</select></Field>
          <NumericEditor options={selectedSettings} onChange={setColumn} allowText/>
        </div></fieldset>}
        <p className="dashboard-result-note">Sorting and pagination work on returned rows. Use SQL ORDER BY to order before the result limit. Viewer interactions do not overwrite saved defaults.</p>
      </>}
    </div>
  </div>;
}
