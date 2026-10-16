export type WidgetType = 'chart' | 'table' | 'markdown' | 'metric';
export type ChartType = 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'horizontal_bar' | 'stacked_bar' | 'stacked_area' | 'scatter' | 'combo';
export type MetricFormat = 'number' | 'currency' | 'percent' | 'text';
export interface NumberOptions {
  format?: MetricFormat | null; decimals?: number | null; currency?: string | null;
  percent_scale?: 'whole' | 'fraction'; compact?: boolean; prefix?: string | null; suffix?: string | null;
}
export interface ColumnOptions extends NumberOptions { width?: number; align?: 'auto' | 'left' | 'center' | 'right' }
export interface PresentationOptions extends NumberOptions {
  chart_type?: ChartType; x_column?: string | null; y_column?: string | null; y2_column?: string | null; series_column?: string | null;
  show_legend?: boolean | null; show_grid?: boolean; show_labels?: boolean; palette?: 'teal' | 'ocean' | 'warm' | 'mono';
  curve?: 'linear' | 'monotone' | 'step'; x_axis_title?: string | null; y_axis_title?: string | null;
  right_axis_title?: string | null; secondary_axis?: boolean; sort_by?: 'none' | 'label' | 'value'; sort_direction?: 'asc' | 'desc';
  value_column?: string | null; label?: string | null; columns?: string[] | null;
  column_options?: Record<string, ColumnOptions>; page_size?: number; density?: 'comfortable' | 'compact';
  show_row_numbers?: boolean; sort_column?: string | null;
}
export interface DashboardPosition { x:number; y:number; w:number; h:number }
export interface DashboardDataSource { dataset_id:number; notebook_id?:number|null; query:string; limit:number }
export interface DashboardWidget { id:string;type:WidgetType;title:string;config:Record<string,unknown>;position:DashboardPosition;source?:DashboardDataSource|null }
export interface DashboardLayout { version:1|2|3;locked?:boolean;widgets:DashboardWidget[] }
export interface WidgetVisualization extends PresentationOptions {
  kind:'table'|'metric'|ChartType; metric_value?:unknown; display_columns?:string[]|null; options?:PresentationOptions;
}
export interface WidgetDataResponse {
  dashboard_id:number|null;widget_id:string;widget_type:'chart'|'table'|'metric';dataset_id:number;dataset_name:string;
  columns:string[];data:Record<string,unknown>[];row_count:number;dtypes:Record<string,string>;truncated:boolean;
  limit:number;execution_ms:number;visualization:WidgetVisualization;
}
export const CHART_TYPES: {value:ChartType;label:string}[] = [
  {value:'bar',label:'Bar'},{value:'horizontal_bar',label:'Horizontal bar'},{value:'line',label:'Line'},
  {value:'area',label:'Area'},{value:'stacked_bar',label:'Stacked bar'},{value:'stacked_area',label:'Stacked area'},
  {value:'pie',label:'Pie'},{value:'donut',label:'Donut'},{value:'scatter',label:'Scatter'}, {value:'combo',label:'Combo (bar + line)'},
];
