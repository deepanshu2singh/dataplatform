import { memo, useState } from 'react';
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useTheme } from '../../contexts/theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { cellText, compareValues, formatValue, numeric, orderedRows, seriesData } from '../../lib/dashboardPresentation';
import type { ColumnOptions, PresentationOptions, WidgetDataResponse, WidgetType } from '../../lib/dashboardTypes';

const PALETTES = {
  light: {
    teal:['#176b65','#394f78','#a06015','#b44d41','#74529b','#527534'],
    ocean:['#245b91','#176b65','#6b529c','#a06015','#984653','#37696e'],
    warm:['#a06015','#b44d41','#74529b','#176b65','#394f78','#7a602f'],
    mono:['#164d48','#246d66','#347b86','#506b96','#6d668f','#785470'],
  },
  dark: {
    teal:['#8bcec4','#a6b8e7','#edbf70','#f09d8c','#c0a9e5','#b4ce8d'],
    ocean:['#8fc3ed','#8bcec4','#c0a9e5','#edbf70','#f0acbb','#a6d5d9'],
    warm:['#edbf70','#f09d8c','#c0a9e5','#8bcec4','#a6b8e7','#d8c395'],
    mono:['#8bcec4','#a6d5d9','#93b9d7','#a6b8e7','#bcb1d2','#d4b6c8'],
  },
};
function Empty({children}:{children:React.ReactNode}) {
  return <p className="dashboard-empty" role="status">{children}</p>;
}
export const WidgetRenderer = memo(function WidgetRenderer({response,config,widgetType}:{response:WidgetDataResponse;config?:PresentationOptions;widgetType?:WidgetType}) {
  const options:PresentationOptions={...response.visualization,...response.visualization.options,...config};
  const kind=widgetType==='chart'?options.chart_type??response.visualization.kind:widgetType??response.visualization.kind;
  if(kind==='table')return <DashboardTable key={JSON.stringify(options)} response={response} options={options}/>;
  if(kind==='metric'){
    const column=options.value_column;
    if(column&&!response.columns.includes(column))return <Empty>The selected metric field is missing from the query result. Choose a returned column.</Empty>;
    const value=column&&column in (response.data[0]??{})?response.data[0][column]:response.visualization.metric_value;
    return <div className="dashboard-metric dashboard-formatted-metric"><div><p className="dashboard-metric-label">{options.label||column||'Value'}</p><p className="dashboard-metric-value">{formatValue(value,options)}</p></div></div>;
  }
  return <DashboardChart response={response} options={{...options,chart_type:kind as PresentationOptions['chart_type']}}/>;
});

function DashboardTable({response,options}:{response:WidgetDataResponse;options:PresentationOptions}) {
  const columns=options.columns?.length?options.columns:response.visualization.display_columns?.length&&!('columns' in options)?response.visualization.display_columns:response.columns;
  const [sort,setSort]=useState<{column:string|null;direction:'asc'|'desc'}>({column:options.sort_column??null,direction:options.sort_direction??'asc'});
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState([10,25,50,100].includes(options.page_size??25)?options.page_size??25:25);
  const sorted=sort.column?response.data.map((row,index)=>({row,index})).sort((a,b)=>compareValues(a.row[sort.column!],b.row[sort.column!],sort.direction)||a.index-b.index).map(item=>item.row):response.data;
  const pageCount=Math.max(1,Math.ceil(sorted.length/pageSize)),currentPage=Math.min(page,pageCount-1),start=currentPage*pageSize;
  const displayed=sorted.slice(start,start+pageSize);
  if(!columns.length||!response.data.length)return <Empty>Query returned no rows.</Empty>;
  const columnStyle=(column:string)=>{
    const settings=options.column_options?.[column]??{};
    return {width:settings.width,minWidth:settings.width??90,maxWidth:settings.width,textAlign:settings.align==='auto'?undefined:settings.align};
  };
  const sortColumn=(column:string)=>{setSort({column,direction:sort.column===column&&sort.direction==='asc'?'desc':'asc'});setPage(0);};
  return <div className={`dashboard-table-view ${options.density==='compact'?'is-compact':''}`}>
    <div className="dashboard-table-scroll"><table aria-label="Widget result data" style={{tableLayout:Object.values(options.column_options??{}).some(o=>o.width)?'fixed':'auto'}}>
      <thead><tr>{options.show_row_numbers&&<th scope="col" style={{width:52}}>#</th>}{columns.map(column=><th key={column} scope="col" style={columnStyle(column)} aria-sort={sort.column===column?(sort.direction==='asc'?'ascending':'descending'):'none'}><button type="button" onClick={()=>sortColumn(column)} aria-label={`Sort by ${column}`}>{column}<span aria-hidden="true">{sort.column===column?(sort.direction==='asc'?' ↑':' ↓'):' ↕'}</span></button></th>)}</tr></thead>
      <tbody>{displayed.map((row,index)=><tr key={start+index}>{options.show_row_numbers&&<td>{start+index+1}</td>}{columns.map(column=>{
        const settings:ColumnOptions=options.column_options?.[column]??{format:'text'};
        return <td key={column} style={columnStyle(column)} title={cellText(row[column])}>{formatValue(row[column],settings)}</td>;
      })}</tr>)}</tbody>
    </table></div>
    <div className="dashboard-table-pagination">
      <span>{start+1}–{Math.min(start+pageSize,sorted.length)} of {sorted.length} returned rows</span>
      <label>Rows <select aria-label="Rows per page" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}}>{[10,25,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <button type="button" aria-label="Previous table page" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Previous</button>
      <span>Page {currentPage+1}/{pageCount}</span>
      <button type="button" aria-label="Next table page" disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}>Next</button>
      <button type="button" onClick={()=>{setSort({column:options.sort_column??null,direction:options.sort_direction??'asc'});setPage(0);setPageSize(options.page_size??25);}}>Reset view</button>
    </div>
    <p className="dashboard-result-note">Sorting and pages apply to these returned rows.{response.truncated?` Result limited to ${response.limit}; use SQL ORDER BY for full-result ordering.`:''}</p>
  </div>;
}

function chartProblem(response:WidgetDataResponse,o:PresentationOptions):string {
  const kind=o.chart_type,x=o.x_column,y=o.y_column;
  if(!x||!y)return 'Choose a category/X column and a numeric Y column.';
  const required=[x,y,...(kind==='combo'?[o.y2_column??'']:[]),...(o.series_column&&kind!=='pie'&&kind!=='donut'?[o.series_column]:[])];
  if(required.some(c=>!response.columns.includes(c)))return 'A selected chart field is missing from the query result. Load fields and choose a returned column.';
  if(response.data.some(row=>[x,...(o.series_column?[o.series_column]:[])].some(c=>row[c]!==null&&typeof row[c]==='object')))return 'Category and series fields must contain scalar values.';
  if((kind==='stacked_bar'||kind==='stacked_area')&&!o.series_column)return 'Choose a series column for a stacked chart.';
  if(kind==='combo'&&(o.series_column||o.y2_column===y))return 'Combo uses two different numeric columns and no series field.';
  for(const col of [y,...(kind==='scatter'?[x]:[]),...(kind==='combo'?[o.y2_column!]:[])]){
    if(response.data.some(row=>row[col]!=null&&!numeric(row[col])))return `Column ${col} must contain finite numbers or nulls.`;
  }
  if((kind==='pie'||kind==='donut')&&response.data.some(row=>numeric(row[y])&&row[y]<0))return 'Pie and donut charts cannot display negative values.';
  if(o.series_column&&kind!=='pie'&&kind!=='donut'){
    const series=new Set<string>(),pairs=new Set<string>();
    for(const row of response.data){
      const s=JSON.stringify([typeof row[o.series_column],row[o.series_column]]);series.add(s);
      const pair=JSON.stringify([typeof row[x],row[x],s]);
      if(kind!=='scatter'&&pairs.has(pair))return 'Multiple rows share a category and series. Aggregate the query with GROUP BY first.';
      pairs.add(pair);
    }
    if(series.size>12)return 'Use at most 12 series; limit or aggregate them in SQL.';
  }
  return '';
}

function DashboardChart({response,options:o}:{response:WidgetDataResponse;options:PresentationOptions}) {
  const reducedMotion=useReducedMotion(),{resolvedTheme}=useTheme();
  const [showData,setShowData]=useState(false);
  const kind=o.chart_type??'bar',x=o.x_column??'',y=o.y_column??'';
  const problem=chartProblem(response,{...o,chart_type:kind});
  if(problem)return <Empty>{problem}</Empty>;
  const data=orderedRows(response.data,o).filter(row=>kind==='scatter'?numeric(row[x])&&numeric(row[y]):kind==='combo'?numeric(row[y])||numeric(row[o.y2_column!]):numeric(row[y]));
  if(!data.length)return <Empty>Query returned no numeric chart points.</Empty>;
  if((kind==='pie'||kind==='donut')&&data.every(row=>row[y]===0))return <Empty>Pie and donut charts need a positive total.</Empty>;
  const palette=PALETTES[resolvedTheme][o.palette??'teal']??PALETTES[resolvedTheme].teal;
  const color=(index:number)=>palette[index%palette.length];
  const fmt=(value:unknown)=>formatValue(value,o);
  const animation={isAnimationActive:!reducedMotion,animationDuration:220};
  const label=(key:string)=>o.show_labels?<LabelList dataKey={key} position="top" formatter={fmt} fill="var(--foreground)" fontSize={11}/>:null;
  const horizontal=kind==='horizontal_bar';
  const series=seriesData(data,x,y,o.series_column);
  const comboRows=kind==='combo'?data.map(row=>({__category:row[x]??'(empty)',__value:row[y],__second:row[o.y2_column!]})):series.rows;
  let plot:React.ReactElement;
  if(kind==='pie'||kind==='donut'){
    const pieRows=data.map(row=>({__category:row[x]??'(empty)',__value:row[y]}));
    plot=<PieChart><Tooltip formatter={fmt}/>{o.show_legend!==false&&<Legend/>}<Pie {...animation} data={pieRows} dataKey="__value" nameKey="__category" cx="50%" cy="50%" outerRadius={o.show_labels?'65%':'78%'} innerRadius={kind==='donut'?'43%':0} label={o.show_labels?entry=>fmt(entry.value):false}>{pieRows.map((_,i)=><Cell key={i} fill={color(i)}/>)}</Pie></PieChart>;
  }else if(kind==='scatter'){
    const groups=new Map<string,{name:string;points:Record<string,unknown>[]} >();
    for(const row of data){const identity=o.series_column?JSON.stringify([typeof row[o.series_column],row[o.series_column]]):'all';const group=groups.get(identity)??{name:o.series_column?cellText(row[o.series_column]):y,points:[]};group.points.push({__x:row[x],__y:row[y]});groups.set(identity,group);}
    plot=<ScatterChart margin={{top:24,right:20,bottom:24,left:14}}>{o.show_grid!==false&&<CartesianGrid strokeDasharray="3 3"/>}<XAxis type="number" dataKey="__x" name={x} label={{value:o.x_axis_title??x,position:'insideBottom',offset:-12}}/><YAxis type="number" dataKey="__y" name={y} tickFormatter={fmt} width={84} label={o.y_axis_title?{value:o.y_axis_title,angle:-90,position:'insideLeft'}:undefined}/><Tooltip formatter={fmt} cursor={{strokeDasharray:'3 3'}}/>{o.show_legend!==false&&<Legend/>}{[...groups.values()].map((group,i)=><Scatter key={i} {...animation} name={group.name} data={group.points} fill={color(i)}>{o.show_labels&&<LabelList dataKey="__y" position="top" formatter={fmt} fill="var(--foreground)" fontSize={11}/>}</Scatter>)}</ScatterChart>;
  }else{
    plot=<ComposedChart data={comboRows} layout={horizontal?'vertical':'horizontal'} margin={{top:24,right:kind==='combo'&&o.secondary_axis!==false?36:12,left:8,bottom:o.x_axis_title?32:12}} stackOffset="sign">
      {o.show_grid!==false&&<CartesianGrid strokeDasharray="3 3"/>}
      <XAxis type={horizontal?'number':'category'} dataKey={horizontal?undefined:'__category'} tickFormatter={horizontal?fmt:undefined} label={o.x_axis_title?{value:o.x_axis_title,position:'insideBottom',offset:-14}:undefined}/>
      <YAxis yAxisId="main" type={horizontal?'category':'number'} dataKey={horizontal?'__category':undefined} width={horizontal?100:84} tickFormatter={horizontal?undefined:fmt} label={o.y_axis_title?{value:o.y_axis_title,angle:-90,position:'insideLeft'}:undefined}/>
      {kind==='combo'&&o.secondary_axis!==false&&<YAxis yAxisId="second" orientation="right" width={84} tickFormatter={fmt} label={o.right_axis_title?{value:o.right_axis_title,angle:90,position:'insideRight'}:undefined}/>}
      <Tooltip formatter={fmt}/>{o.show_legend!==false&&<Legend/>}
      {(kind==='combo'?[{key:'__value',name:y}]:series.keys).map((entry,i)=>{
        const common={...animation,yAxisId:'main',dataKey:entry.key,name:entry.name};
        if(kind==='line')return <Line key={entry.key} {...common} type={o.curve??'monotone'} stroke={color(i)} strokeWidth={2.5} dot={data.length<40} connectNulls={false} strokeDasharray={i>=6?'6 3':undefined}>{label(entry.key)}</Line>;
        if(kind==='area'||kind==='stacked_area')return <Area key={entry.key} {...common} type={o.curve??'monotone'} stroke={color(i)} fill={color(i)} fillOpacity={kind==='stacked_area' ? .65 : .18} stackId={kind==='stacked_area'?'stack':undefined} connectNulls={false}>{label(entry.key)}</Area>;
        return <Bar key={entry.key} {...common} fill={color(i)} radius={kind==='stacked_bar'?0:3} maxBarSize={64} stackId={kind==='stacked_bar'?'stack':undefined}>{label(entry.key)}</Bar>;
      })}
      {kind==='combo'&&<Line {...animation} yAxisId={o.secondary_axis!==false?'second':'main'} dataKey="__second" name={o.y2_column??'Second value'} type={o.curve??'monotone'} stroke={color(1)} strokeWidth={3} dot={data.length<40} connectNulls={false}>{label('__second')}</Line>}
    </ComposedChart>;
  }
  return <div className="dashboard-chart-view" data-chart-kind={kind}>
      <div className="dashboard-chart-plot" role={showData?undefined:'img'} aria-label={showData?undefined:`${kind.replaceAll('_',' ')} chart: ${x} and ${y}`}>
      {showData?<DashboardTable response={response} options={{page_size:25}}/>:<ResponsiveContainer width="100%" height="100%">{plot}</ResponsiveContainer>}
    </div>
    <div className="dashboard-chart-controls"><span>{data.length} plotted rows{data.length<response.data.length?`; ${response.data.length-data.length} null rows omitted`:''}</span><button type="button" aria-pressed={showData} onClick={()=>setShowData(!showData)}>{showData?'Show chart':'View chart data'}</button></div>
    {response.truncated&&<p className="dashboard-result-note">Result limited to {response.limit} rows. Ordering applies to this result; use SQL ORDER BY for full-result ordering.</p>}
    {o.series_column&&(kind==='pie'||kind==='donut')&&<p className="dashboard-result-note">Each label/value row is a slice. The legacy series field is unused for this chart.</p>}
  </div>;
}
