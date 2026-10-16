from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.schemas.dashboard import DashboardLayout, DashboardRead, DashboardUpdate
import app.api.routes.dashboards as routes


def note(widget_id='note', **position):
    return {'id': widget_id, 'type': 'markdown', 'config': {'markdown': 'Keep my analysis'}, 'position': {'x': 0, 'y': 0, 'w': 6, 'h': 10, **position}}


def test_legacy_and_new_layouts_roundtrip_without_losing_content():
    legacy = {'version': 1, 'widgets': [note(w=600, h=360)]}
    assert DashboardLayout.model_validate(legacy).widgets[0].position.w == 600
    new = {'version': 2, 'locked': True, 'widgets': [note(x=3, y=50, w=9, h=16)]}
    parsed = DashboardLayout.model_validate(new)
    assert parsed.model_dump()['widgets'][0]['position'] == new['widgets'][0]['position']
    assert parsed.locked and parsed.widgets[0].config['markdown'] == 'Keep my analysis'


@pytest.mark.parametrize('widgets', [
    [note(w=13)], [note(x=7,w=6)], [note(h=4)], [note(y=999,h=8)],
    [note('a'),note('b',x=5)], [note('a'),note('a',y=10)],
])
def test_invalid_canvas_is_rejected(widgets):
    with pytest.raises(ValidationError):
        DashboardLayout.model_validate({'version': 2, 'widgets': widgets})


def test_touching_edges_are_valid_and_unknown_layout_is_rejected():
    assert len(DashboardLayout.model_validate({'version':2,'widgets':[note('a'),note('b',x=6)]}).widgets)==2
    with pytest.raises(ValidationError):
        DashboardLayout.model_validate({'version':4})


class FakeDB:
    committed = False
    async def refresh(self, obj):
        pass


def setup_route(monkeypatch, version=2):
    dashboard = SimpleNamespace(id=2, owner_id=1, name='Analysis', description=None, layout={'version':version,'widgets':[]}, version=4, is_public=False, created_at=datetime.now(timezone.utc),updated_at=None)
    db=FakeDB()
    async def owned(*_): return dashboard
    async def refs(*_): pass
    async def commit(*_,**__):
        db.committed=True
        dashboard.version+=1
    async def read(*_): return DashboardRead.model_validate(dashboard)
    monkeypatch.setattr(routes,'get_owned_dashboard',owned)
    monkeypatch.setattr(routes,'validate_layout_references',refs)
    monkeypatch.setattr(routes,'commit_with_optimistic_lock',commit)
    monkeypatch.setattr(routes,'build_dashboard_read',read)
    return dashboard, db


@pytest.mark.parametrize('payload', [
    {'layout': {'version':1,'widgets':[]}},
    {'layout': {'version':2,'widgets':[]}},
    {'expected_version':3,'layout': {'version':2,'widgets':[]}},
])
def test_cached_or_stale_client_cannot_overwrite_canvas(monkeypatch,payload):
    dashboard, db=setup_route(monkeypatch)
    original=dashboard.layout
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.update_dashboard(2,DashboardUpdate.model_validate(payload),db,SimpleNamespace(id=1)))
    assert error.value.status_code==409
    assert dashboard.layout==original and not db.committed


def test_explicit_save_upgrades_legacy_and_preserves_exact_canvas(monkeypatch):
    dashboard,db=setup_route(monkeypatch,1)
    layout={'version':2,'locked':True,'widgets':[note(x=4,y=17,w=8,h=16)]}
    result=asyncio.run(routes.update_dashboard(2,DashboardUpdate.model_validate({'expected_version':4,'layout':layout}),db,SimpleNamespace(id=1)))
    assert db.committed and result.version==5
    assert result.layout.version==2 and result.layout.locked
    assert result.layout.widgets[0].position.model_dump()==layout['widgets'][0]['position']


def test_legacy_update_remains_compatible(monkeypatch):
    _,db=setup_route(monkeypatch,1)
    result=asyncio.run(routes.update_dashboard(2,DashboardUpdate(name='Renamed'),db,SimpleNamespace(id=1)))
    assert db.committed and result.name=='Renamed' and result.layout.version==1
