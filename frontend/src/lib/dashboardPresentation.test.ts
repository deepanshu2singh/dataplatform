import { describe,expect,it } from 'vitest';
import { compareValues,formatValue,orderedRows,seriesData } from './dashboardPresentation';
describe('dashboard result presentation',()=>{
  it('preserves legacy percent/affix semantics and supports explicit fraction/currency/compact formats',()=>{
    expect(formatValue(25,{format:'percent',decimals:0})).toBe('25%');
    expect(formatValue(.25,{format:'percent',percent_scale:'fraction',decimals:1})).toBe('25.0%');
    expect(formatValue(12,{format:'currency',prefix:'£',decimals:2})).toBe('£12.00');
    expect(formatValue(1234.5,{format:'currency',currency:'GBP',decimals:2})).toMatch(/£1,234\.50/);
    expect(formatValue(12000,{compact:true,decimals:0})).toBe('12K');
    expect(formatValue('note',{format:'text',suffix:'!'})).toBe('note!');
    for(const missing of [null,undefined,NaN,Infinity])expect(formatValue(missing)).toBe('—');
  });
  it('sorts a copied bounded result stably, keeping nulls last in either direction',()=>{
    const rows=[{x:'B',y:2},{x:'A',y:null},{x:'C',y:1},{x:'D',y:2}],snapshot=structuredClone(rows);
    expect(orderedRows(rows,{sort_by:'value',y_column:'y',sort_direction:'desc'}).map(r=>r.x)).toEqual(['B','D','C','A']);
    expect(orderedRows(rows,{sort_by:'label',x_column:'x'}).map(r=>r.x)).toEqual(['A','B','C','D']);expect(rows).toEqual(snapshot);
    expect(compareValues(null,1,'desc')).toBe(1);
  });
  it('uses safe synthetic series keys and distinguishes numeric/string categories',()=>{
    const data=[{label:1,value:4,group:'__proto__'},{label:'1',value:5,group:'label'},{label:1,value:7,group:'label'}];
    const out=seriesData(data,'label','value','group');
    expect(out.keys).toEqual([{key:'__series0',name:'__proto__'},{key:'__series1',name:'label'}]);
    expect(out.rows).toEqual([{__category:1,__series0:4,__series1:7},{__category:'1',__series1:5}]);
    expect(Object.getPrototypeOf(out.rows[0])).toBe(Object.prototype);
  });
  it('retains repeated raw category rows when there is no series grouping',()=>{
    expect(seriesData([{x:'A',y:1},{x:'A',y:2}],'x','y').rows).toHaveLength(2);
  });
});
