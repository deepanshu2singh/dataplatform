from __future__ import annotations
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.dashboard import DashboardLayout, DashboardUpdate, DashboardWidget
from app.api.routes.dashboards import build_widget_visualization, update_dashboard
from tests.test_dashboard_canvas import setup_route

TYPES=['bar','line','pie','donut','area','horizontal_bar','stacked_bar','stacked_area','scatter','combo']

def widget(kind='bar', **options):
    config={'chart_type':kind,'x_column':'x','y_column':'y',**options}
    if kind.startswith('stacked'): config.setdefault('series_column','group')
    if kind=='combo':config.setdefault('y2_column','second')
    return DashboardWidget.model_validate({'id':'chart','type':'chart','config':config,'position':{'x':0,'y':0,'w':6,'h':10}})

def result(rows=None,columns=None):
    return {'columns':columns or ['x','y','group','second'], 'data':rows if rows is not None else [{'x':1,'y':25.0,'group':'A','second':4.0},{'x':2,'y':10.0,'group':'B','second':2.0}],'truncated':False}

@pytest.mark.parametrize('kind',TYPES)
def test_every_chart_contract_roundtrips_format_settings_and_empty_result(kind):
    w=widget(kind,palette='ocean',format='currency',currency='GBP',decimals=1,show_labels=True,x_axis_title='Month',y_axis_title='Revenue',sort_by='value',sort_direction='desc')
    layout=DashboardLayout.model_validate({'version':3,'widgets':[w.model_dump(mode='json')]})
    out=build_widget_visualization(layout.widgets[0],result())
    assert out.kind==kind and out.options['currency']=='GBP' and out.options['palette']=='ocean'
    assert out.options['show_labels'] and out.options['sort_direction']=='desc'
    assert build_widget_visualization(w,result([])).kind==kind

@pytest.mark.parametrize('value',[True,'25',float('inf'),float('-inf'),float('nan')])
def test_y_rejects_nonnumeric_and_nonfinite_data(value):
    with pytest.raises(HTTPException) as error:
        build_widget_visualization(widget(),result([{'x':'A','y':value}]))
    assert error.value.status_code==400

@pytest.mark.parametrize('kind,column',[('scatter','x'),('combo','second')])
def test_new_numeric_axes_are_checked(kind,column):
    rows=[{'x':1,'y':2,'second':3}];rows[0][column]='bad'
    with pytest.raises(HTTPException) as error:build_widget_visualization(widget(kind),result(rows))
    assert error.value.status_code==400

@pytest.mark.parametrize('kind',['pie','donut'])
def test_pie_negative_rejected_but_zero_and_null_defined(kind):
    with pytest.raises(HTTPException):build_widget_visualization(widget(kind),result([{'x':'A','y':-1}]))
    assert build_widget_visualization(widget(kind),result([{'x':'A','y':0},{'x':'B','y':None}])).kind==kind

@pytest.mark.parametrize('kind',['bar','line','area','horizontal_bar','stacked_bar','stacked_area'])
def test_series_requires_one_row_per_typed_category_pair(kind):
    rows=[{'x':'A','y':3,'group':'north'},{'x':'A','y':4,'group':'north'}]
    with pytest.raises(HTTPException) as error:build_widget_visualization(widget(kind,series_column='group'),result(rows))
    assert 'GROUP BY' in error.value.detail
    rows[1]['group']='south'
    assert build_widget_visualization(widget(kind,series_column='group'),result(rows)).kind==kind

def test_series_limit_and_scalar_values_are_checked():
    with pytest.raises(HTTPException):build_widget_visualization(widget(series_column='group'),result([{'x':i,'y':1,'group':str(i)} for i in range(13)]))
    with pytest.raises(HTTPException):build_widget_visualization(widget(),result([{'x':{'nested':1},'y':1}]))
    assert build_widget_visualization(widget('scatter',series_column='group'),result([{'x':1,'y':3,'group':'a'},{'x':1,'y':4,'group':'a'}])).kind=='scatter'

@pytest.mark.parametrize('config',[
    {'chart_type':'stacked_area','series_column':None},
    {'chart_type':'combo','y2_column':None},
    {'chart_type':'combo','y2_column':'y'},
    {'chart_type':'combo','series_column':'group'},
    {'format':'text'}, {'palette':'unknown'}, {'decimals':7}, {'currency':'INVALID'},
])
def test_invalid_settings_fail_validation(config):
    kind=config.pop('chart_type','bar')
    with pytest.raises(ValidationError):widget(kind,**config)

def test_table_options_are_typed_preserved_and_checked_against_results():
    w=DashboardWidget.model_validate({'id':'table','type':'table','config':{'columns':['y','x'],'sort_column':'y','sort_direction':'desc','page_size':10,'density':'compact','show_row_numbers':True,'column_options':{'y':{'format':'currency','currency':'GBP','width':180,'align':'right','decimals':1}}}})
    out=build_widget_visualization(w,result())
    assert out.display_columns==['y','x'] and out.options['column_options']['y']['width']==180
    assert out.options['page_size']==10 and out.options['show_row_numbers']
    for bad in [{'sort_column':'missing'},{'column_options':{'missing':{'width':200}}}]:
        broken=w.model_copy(update={'config':{**w.config,**bad}})
        with pytest.raises(HTTPException):build_widget_visualization(broken,result())
    for bad in [{'page_size':200},{'column_options':{'y':{'width':10}}}]:
        with pytest.raises(ValidationError):DashboardWidget.model_validate({'id':'table','type':'table','config':bad})

def test_legacy_metric_affixes_and_new_label_percent_scale_survive():
    w=DashboardWidget.model_validate({'id':'metric','type':'metric','config':{'value_column':'y','format':'percent','prefix':'','label':'Margin','percent_scale':'fraction'}})
    out=build_widget_visualization(w,result([{'y':.25}]))
    assert out.options['label']=='Margin' and out.options['percent_scale']=='fraction'
    out=build_widget_visualization(w,result([{'y':None}]))
    assert out.metric_value is None

@pytest.mark.parametrize('old_version',[1,2])
def test_legacy_layouts_remain_readable(old_version):
    w=widget('bar')
    if old_version==1:w.position.w=600;w.position.h=360
    assert DashboardLayout.model_validate({'version':old_version,'widgets':[w.model_dump(mode='json')]}).version==old_version


def test_cached_canvas_client_cannot_downgrade_presentation(monkeypatch):
    dashboard,db=setup_route(monkeypatch,3)
    for requested in [1,2]:
        with pytest.raises(HTTPException) as error:
            asyncio.run(update_dashboard(2,DashboardUpdate.model_validate({'expected_version':4,'layout':{'version':requested,'widgets':[]}}),db,SimpleNamespace(id=1)))
        assert error.value.status_code==409
    assert not db.committed and dashboard.layout['version']==3
