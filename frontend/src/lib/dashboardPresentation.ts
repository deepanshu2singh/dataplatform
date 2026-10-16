import type { NumberOptions, PresentationOptions } from './dashboardTypes';
export const numeric = (value:unknown):value is number => typeof value==='number' && Number.isFinite(value);
export function cellText(value:unknown):string {
  if(value===null||value===undefined)return '—';
  if(typeof value==='object'){try{return JSON.stringify(value);}catch{return String(value);}}
  return String(value);
}
export function formatValue(value:unknown,options:NumberOptions={}):string {
  if(value===null||value===undefined || (typeof value==='number'&&!Number.isFinite(value)))return '—';
  const prefix=options.prefix??'',suffix=options.suffix??'';
  if(options.format==='text'||!numeric(value))return prefix+cellText(value)+suffix;
  const decimals=Math.min(6,Math.max(0,options.decimals??2));
  const percent=options.format==='percent';
  const n=percent&&options.percent_scale==='fraction'?value*100:value;
  const settings:Intl.NumberFormatOptions={minimumFractionDigits:decimals,maximumFractionDigits:decimals,notation:options.compact?'compact':'standard'};
  if(options.format==='currency' && options.currency){settings.style='currency';settings.currency=options.currency;}
  let formatted:string;
  try{formatted=new Intl.NumberFormat(undefined,settings).format(n);}catch{formatted=String(n);}
  return prefix+formatted+(percent&&!suffix?'%':suffix);
}
export function compareValues(a:unknown,b:unknown,direction:'asc'|'desc'='asc'):number {
  if(a===null||a===undefined)return b===null||b===undefined?0:1;
  if(b===null||b===undefined)return -1;
  const result=numeric(a)&&numeric(b)?a-b:cellText(a).localeCompare(cellText(b),undefined,{numeric:true});
  return direction==='desc'?-result:result;
}
export function orderedRows(data:Record<string,unknown>[],options:PresentationOptions) {
  const column=options.sort_by==='label'?options.x_column:options.sort_by==='value'?options.y_column:options.sort_column;
  if(!column)return [...data];
  return data.map((row,index)=>({row,index})).sort((a,b)=>compareValues(a.row[column],b.row[column],options.sort_direction)||a.index-b.index).map(item=>item.row);
}
export function seriesData(data:Record<string,unknown>[],x:string,y:string,series?:string|null) {
  if(!series)return {rows:data.map(row=>({__category:row[x]??'(empty)',__value:row[y]})),keys:[{key:'__value',name:y}]};
  const keys:{key:string;name:string}[]=[],seriesMap=new Map<string,string>(),rows=new Map<string,Record<string,unknown>>();
  for(const row of data){
    const value=row[series],identity=JSON.stringify([typeof value,value]);
    let key=seriesMap.get(identity);
    if(!key){key='__series'+keys.length;seriesMap.set(identity,key);keys.push({key,name:cellText(value)});}
    const category=JSON.stringify([typeof row[x],row[x]]);
    const target=rows.get(category)??{__category:row[x]??'(empty)'};target[key]=row[y];rows.set(category,target);
  }
  return {rows:[...rows.values()],keys};
}
