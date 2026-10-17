"""Real owner/cookie/session/version export checks against disposable PostgreSQL."""
import asyncio
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.db.session import get_db
from app.main import app
from app.models.user import User
from app.models.dataset import Dataset, DatasetType
from app.models.notebook import Notebook
from app.models.dashboard import Dashboard
from app.models.dataset_upload import DatasetUpload
from app.services import account_data as service
from app.services.storage import build_dataset_object_key
from test_migrations import _with_database, _run_alembic

PASSWORD='Native-Export-Password-123!'


@pytest.mark.parametrize('case',['roundtrip-and-isolation','concurrent-limit','revoked-proof','changed-record','pagination','unverified'])
def test_native_account_data(case,monkeypatch):
    if not os.environ.get('TEST_DATABASE_URL'):
        pytest.skip('Disposable native PostgreSQL TEST_DATABASE_URL required')
    monkeypatch.setattr(settings,'EMAIL_VERIFICATION_REQUIRED',True)
    monkeypatch.setattr(settings,'AUTH_COOKIE_SECURE',False)
    monkeypatch.setattr(settings,'STORAGE_BACKEND','supabase')
    storage=Mock();storage.create_signed_download=AsyncMock(return_value='https://test.supabase.co/storage/v1/object/sign/datasets/source.csv?token=test-only')
    monkeypatch.setattr(service.SupabaseStorageService,'from_settings',lambda:storage)
    def body(direct_url,async_url):
        migrated=_run_alembic(async_url,'upgrade','head');assert migrated.returncode==0,migrated.stderr
        async def exercise():
            engine=create_async_engine(async_url,poolclass=NullPool);sessions=async_sessionmaker(engine,expire_on_commit=False)
            async def database():
                async with sessions() as db:
                    try:yield db
                    except Exception:await db.rollback();raise
            app.dependency_overrides[get_db]=database
            try:
                async with sessions() as db:
                    now=datetime.now(timezone.utc)
                    owner=User(email=f'export-{uuid4().hex}@example.com',full_name='Owner 🌱',hashed_password=get_password_hash(PASSWORD),email_verified_at=None if case=='unverified' else now)
                    other=User(email=f'other-{uuid4().hex}@example.com',hashed_password=get_password_hash(PASSWORD),email_verified_at=now)
                    db.add_all([owner,other]);await db.flush();uid,oid=owner.id,other.id
                    source_key=build_dataset_object_key(uid)
                    dataset=Dataset(name='Original CSV',type=DatasetType.FILE,owner_id=uid,config={'storage_backend':'supabase','bucket':settings.SUPABASE_STORAGE_BUCKET,'object_key':source_key,'password':'DO-NOT-EXPORT'},schema_info={})
                    foreign=Notebook(name='Other owner secret',owner_id=oid,content={'secret':'not yours'})
                    large=Notebook(name='Full saved notebook',owner_id=uid,content={'cells':[{'type':'python','content':'do not execute','output':'é🌱'*650_000}]})
                    db.add_all([dataset,foreign,large,Dashboard(name='Saved dashboard',owner_id=uid,layout={'widgets':[]})]);await db.flush()
                    did,nid,fid=dataset.id,large.id,foreign.id
                    db.add(DatasetUpload(id=uuid4().hex,owner_id=uid,object_key=build_dataset_object_key(uid),bucket=settings.SUPABASE_STORAGE_BUCKET,original_filename='source.csv',name='Upload',expected_size=10,status='pending',expires_at=now))
                    if case=='pagination':db.add_all(Notebook(name=f'Page{i}',owner_id=uid,content={}) for i in range(30))
                    await db.commit()
                cookie={settings.AUTH_COOKIE_NAME:create_access_token({'sub':owner.email,'sv':0})}
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver',headers={'Origin':settings.FRONTEND_URL},cookies=cookie) as client:
                    async def post(path,data):return await client.post('/api/v1/account-data/'+path,json=data)
                    denied=await client.post('/api/v1/account-data/authorize',json={'current_password':PASSWORD},headers={'Origin':'https://untrusted.invalid'})
                    assert denied.status_code==403
                    result=await post('authorize',{'current_password':PASSWORD})
                    if case=='unverified':assert result.status_code==403;return
                    assert result.status_code==200,result.text
                    assert result.headers['cache-control']=='no-store' and 'set-cookie' not in result.headers
                    proof=result.json()['proof']
                    assert (await client.get('/api/v1/auth/me')).status_code==200
                    async with sessions() as db:
                        saved=await db.get(User,uid);assert saved.session_version==0 and saved.email_verified and saved.security_attempts==1
                    async def catalog(category,after=None):return await post('catalog',{'proof':proof,'category':category,'after':after})
                    async def record(key,revision='1',offset=0):return await post('record',{'proof':proof,'category':'notebooks','record_id':str(key),'revision':revision,'offset':offset})
                    if case=='concurrent-limit':
                        results=await asyncio.gather(*(post('authorize',{'current_password':'wrong'}) for _ in range(6)))
                        assert sorted(r.status_code for r in results)==[400,400,400,400,429,429]
                        async with sessions() as db:assert (await db.get(User,uid)).security_attempts==5
                        return
                    if case=='revoked-proof':
                        revoked=await client.post('/api/v1/auth/sessions/revoke',json={'current_password':PASSWORD});assert revoked.status_code==204
                        assert (await catalog('datasets')).status_code==401
                        client.cookies.set(settings.AUTH_COOKIE_NAME,create_access_token({'sub':owner.email,'sv':1}))
                        assert (await catalog('datasets')).status_code==403
                        return
                    if case=='changed-record':
                        async with sessions() as db:
                            saved=await db.get(Notebook,nid);saved.name='Changed';await db.commit()
                        assert (await record(nid)).status_code==409
                        return
                    if case=='pagination':
                        first=(await catalog('notebooks')).json();second=(await catalog('notebooks',first['next_cursor'])).json()
                        assert len(first['items'])==25 and len(second['items'])==6 and second['next_cursor'] is None
                        assert len({r['id'] for r in first['items']+second['items']})==31
                        return
                    assert (await record(fid)).status_code==404
                    other_cookie=create_access_token({'sub':other.email,'sv':0});client.cookies.set(settings.AUTH_COOKIE_NAME,other_cookie)
                    assert (await catalog('notebooks')).status_code==403
                    client.cookies.set(settings.AUTH_COOKIE_NAME,cookie[settings.AUTH_COOKIE_NAME])
                    chunks=[];offset=0
                    while True:
                        response=await record(nid,offset=offset);assert response.status_code==200,response.text
                        assert len(response.content)<1024*1024
                        value=response.json();chunks.append(base64.b64decode(value['data_base64']))
                        if value['next_offset'] is None:break
                        offset=value['next_offset']
                    data=b''.join(chunks);assert len(data)>3*1024*1024 and hashlib.sha256(data).hexdigest()==value['sha256']
                    assert json.loads(data)['content']==large.content
                    for category in ['datasets','dashboards','uploads']:
                        page=(await catalog(category)).json();assert len(page['items'])==1
                    link=await post('dataset-file',{'proof':proof,'dataset_id':did});assert link.status_code==200
                    storage.create_signed_download.assert_awaited_once_with(source_key,expires_seconds=60)
                    assert (await post('dataset-file',{'proof':proof,'dataset_id':999999})).status_code==404
                    assert 'DO-NOT-EXPORT' not in result.text
            finally:
                app.dependency_overrides.pop(get_db,None);await engine.dispose()
        asyncio.run(exercise())
    _with_database(body)
