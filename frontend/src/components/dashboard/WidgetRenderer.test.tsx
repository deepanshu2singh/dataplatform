import { render,screen,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it } from 'vitest';
import { WidgetRenderer } from './WidgetRenderer';
import type { WidgetDataResponse } from '../../lib/dashboardTypes';
const response:WidgetDataResponse={dashboard_id:2,widget_id:'table',widget_type:'table',dataset_id:1,dataset_name:'Sales',columns:['product','value'],data:Array.from({length:32},(_,i)=>({product:'P'+(31-i),value:31-i})),row_count:32,dtypes:{},truncated:true,limit:32,execution_ms:1,visualization:{kind:'table',display_columns:['product','value'],options:{page_size:10}}};
describe('shared dashboard renderer',()=>{
  it('sorts/pages only returned rows and resets viewer interactions without changing the response',async()=>{
    const original=structuredClone(response),user=userEvent.setup();render(<WidgetRenderer response={response}/>);
    expect(screen.getByText('1–10 of 32 returned rows')).toBeInTheDocument();
    expect(within(screen.getAllByRole('row')[1]).getByText('P31')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Sort by value'}));
    expect(within(screen.getAllByRole('row')[1]).getByText('P0')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Next table page'}));expect(screen.getByText('11–20 of 32 returned rows')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox',{name:'Rows per page'}),'50');expect(screen.getByText('1–32 of 32 returned rows')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Reset view'}));expect(within(screen.getAllByRole('row')[1]).getByText('P31')).toBeInTheDocument();
    expect(screen.getByText(/Result limited to 32/)).toBeInTheDocument();expect(response).toEqual(original);
  });
  it('applies persisted visibility, widths, numeric formatting and row numbers',()=>{
    render(<WidgetRenderer response={response} config={{columns:['value'],show_row_numbers:true,column_options:{value:{format:'currency',currency:'GBP',decimals:1,width:180,align:'right'}}}}/>);
    expect(screen.queryByRole('button',{name:'Sort by product'})).toBeNull();expect(screen.getByText('£31.0')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Sort by value'}).closest('th')).toHaveStyle({width:'180px',textAlign:'right'});
    expect(screen.getByRole('columnheader',{name:'#'})).toBeInTheDocument();
  });
  it('renders metric labels, explicit percentage scale and missing values honestly',()=>{
    const metric={...response,columns:['margin'],widget_type:'metric' as const,data:[{margin:.25}],visualization:{kind:'metric' as const,value_column:'margin',metric_value:.25}};
    const {rerender}=render(<WidgetRenderer response={metric} config={{value_column:'margin',label:'Gross margin',format:'percent',percent_scale:'fraction',decimals:1}}/>);
    expect(screen.getByText('Gross margin')).toBeInTheDocument();expect(screen.getByText('25.0%')).toBeInTheDocument();
    rerender(<WidgetRenderer response={{...metric,data:[{margin:null}],visualization:{...metric.visualization,metric_value:null}}}/>);expect(screen.getByText('—')).toBeInTheDocument();
    rerender(<WidgetRenderer response={metric} config={{value_column:'missing'}}/>);expect(screen.getByRole('status')).toHaveTextContent('missing from the query result');
  });
  it.each(['scatter','combo','stacked_bar'] as const)('shows a useful error for incomplete %s draft fields',kind=>{
    render(<WidgetRenderer response={response} widgetType="chart" config={{chart_type:kind,x_column:'product',y_column:'value'}}/>);
    expect(screen.getByRole('status')).toHaveTextContent(kind==='scatter'?'must contain finite numbers':kind==='combo'?'missing from the query result':'Choose a series');
  });
  it('renders empty and all-zero pie results without inventing values',()=>{
    const chart={...response,visualization:{kind:'pie' as const,x_column:'product',y_column:'value'},data:[]};
    const {rerender}=render(<WidgetRenderer response={chart}/>);expect(screen.getByRole('status')).toHaveTextContent('no numeric chart points');
    rerender(<WidgetRenderer response={{...chart,data:[{product:'A',value:0}]}}/>);expect(screen.getByRole('status')).toHaveTextContent('positive total');
  });
});
