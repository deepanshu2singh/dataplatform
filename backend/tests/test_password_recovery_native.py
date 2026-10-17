"""Real PostgreSQL API/locking cases; no provider network traffic."""
import asyncio
from datetime import datetime, timezone
import importlib.util
import os
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import asyncpg
import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.security import create_access_token, get_password_hash, verify_password
from app.db.session import get_db
from app.main import app
from app.models.user import User
from app.models.notebook import Notebook
from app.models.email_delivery_limit import EmailDeliveryLimit
from app.services import password_recovery as service
from test_migrations import _with_database, _run_alembic

OLD='Recovery-Old-Password-123!'
NEW='Recovery-New-Password-456!'


@pytest.mark.parametrize('case',[
    'success-and-preservation','concurrent-confirm','parallel-send',
    'five-wrong-attempts','expired-code','resend-replaces-code',
    'authenticated-revocation','unverified-stays-unverified',
    'delivery-uncertain','global-limit','same-generic-response',
])
def test_native_password_recovery(monkeypatch,case):
    if not os.environ.get('TEST_DATABASE_URL'):
        pytest.skip('Disposable native PostgreSQL TEST_DATABASE_URL required')
    monkeypatch.setattr(settings,'EMAIL_VERIFICATION_REQUIRED',True)
    monkeypatch.setattr(settings,'RESEND_API_KEY',SecretStr('re_TEST_ONLY_NEVER_SEND'))
    monkeypatch.setattr(settings,'EMAIL_FROM','no-reply@notify.sprout-sql.com')
    monkeypatch.setattr(settings,'AUTH_COOKIE_SECURE',False)
    monkeypatch.setattr(service,'_minimum_duration',AsyncMock())
    values=iter([123456,234567,345678,456789,567890])
    monkeypatch.setattr(service.secrets,'randbelow',lambda _:next(values))
    delivered=[]
    async def deliver(email,nonce,code):
        delivered.append((email,nonce,code))
        return case!='delivery-uncertain'
    monkeypatch.setattr(service,'_deliver',deliver)

    def body(direct_url,async_url):
        migrated=_run_alembic(async_url,'upgrade','head');assert migrated.returncode==0,migrated.stderr
        async def exercise():
            engine=create_async_engine(async_url,poolclass=NullPool)
            sessions=async_sessionmaker(engine,expire_on_commit=False)
            async def database():
                async with sessions() as db:
                    try:yield db
                    except Exception:
                        await db.rollback();raise
            app.dependency_overrides[get_db]=database
            try:
                email=f"owner-{uuid4().hex}@example.com"
                async with sessions() as db:
                    user=User(email=email,hashed_password=get_password_hash(OLD),full_name='Existing Owner',email_verified_at=None if case=='unverified-stays-unverified' else datetime.now(timezone.utc))
                    other=User(email=f"other-{uuid4().hex}@example.com",hashed_password=get_password_hash(OLD),email_verified_at=datetime.now(timezone.utc))
                    db.add_all([user,other]);await db.flush()
                    uid,oid=user.id,other.id
                    db.add(Notebook(name='Preserved notebook',owner_id=uid,content={'cells':[]}))
                    await db.commit()
                headers={'Origin':settings.FRONTEND_URL}
                owner_cookie={settings.AUTH_COOKIE_NAME:create_access_token({'sub':email,'sv':0})}
                other_cookie={settings.AUTH_COOKIE_NAME:create_access_token({'sub':other.email,'sv':0})}
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver',headers=headers) as client:
                    async def request(address=email):
                        return await client.post('/api/v1/auth/password-recovery/request',json={'email':address})
                    async def confirm(code,password=NEW,address=email):
                        return await client.post('/api/v1/auth/password-recovery/confirm',json={'email':address,'code':code,'new_password':password})
                    async def sql(statement,*args):
                        conn=await asyncpg.connect(direct_url)
                        try:return await conn.fetchval(statement,*args)
                        finally:await conn.close()
                    if case=='global-limit':
                        async with sessions() as db:
                            await service._public_budget(db,'request')
                        await sql("UPDATE email_delivery_limits SET count=60,window_started_at=date_trunc('minute',now())+interval '1 minute' WHERE key='recovery-requests-minute'")
                        assert (await request()).status_code==429 and not delivered
                        return
                    if case=='parallel-send':
                        responses=await asyncio.gather(request(),request())
                        assert [r.status_code for r in responses]==[202,202]
                        assert responses[0].json()==responses[1].json() and len(delivered)==1
                        assert await sql("SELECT password_reset_window_count FROM users WHERE id=$1",uid)==1
                        assert await sql("SELECT count FROM email_delivery_limits WHERE key='verification-day'")==1
                        return
                    first=await request();assert first.status_code==202 and first.json()==service.GENERIC_RESPONSE
                    assert 'set-cookie' not in first.headers and first.headers['cache-control']=='no-store'
                    code=delivered[-1][2]
                    if case=='same-generic-response':
                        missing=await request(f"missing-{uuid4().hex}@example.com")
                        cooldown=await request()
                        await sql("UPDATE users SET is_active=false WHERE id=$1",uid)
                        inactive=await request()
                        assert all(r.status_code==202 and r.json()==first.json() for r in [missing,cooldown,inactive])
                        assert len(delivered)==1
                        return
                    assert code is not None
                    assert await sql("SELECT password_reset_digest FROM users WHERE id=$1",uid)!=code
                    if case=='five-wrong-attempts':
                        for _ in range(5):assert (await confirm('99999999')).status_code==400
                        assert (await confirm(code)).status_code==400
                        assert await sql("SELECT password_reset_attempts FROM users WHERE id=$1",uid)==5
                        assert await sql("SELECT password_reset_digest FROM users WHERE id=$1",uid) is None
                        assert await sql("SELECT session_version FROM users WHERE id=$1",uid)==0
                        return
                    if case=='expired-code':
                        await sql("UPDATE users SET password_reset_expires_at=now()-interval '1 second' WHERE id=$1",uid)
                        assert (await confirm(code)).status_code==400
                        assert await sql("SELECT session_version FROM users WHERE id=$1",uid)==0
                        return
                    if case=='authenticated-revocation':
                        response=await client.post('/api/v1/auth/sessions/revoke',cookies=owner_cookie,json={'current_password':OLD})
                        assert response.status_code==204
                        assert (await confirm(code)).status_code==400
                        return
                    if case=='resend-replaces-code':
                        await sql("UPDATE users SET password_reset_last_sent_at=now()-interval '61 seconds' WHERE id=$1",uid)
                        assert (await request()).status_code==202
                        newer=delivered[-1][2];assert newer!=code
                        assert (await confirm(code)).status_code==400
                        code=newer
                    if case=='concurrent-confirm':
                        responses=await asyncio.gather(confirm(code),confirm(code,NEW+'Other'))
                        assert sorted(r.status_code for r in responses)==[204,400]
                    else:
                        response=await confirm(code);assert response.status_code==204,response.text
                        assert 'set-cookie' not in response.headers
                    assert (await confirm(code)).status_code==400
                    assert (await client.get('/api/v1/auth/me',cookies=owner_cookie)).status_code==401
                    assert (await client.get('/api/v1/auth/me',cookies=other_cookie)).status_code==200
                    async with sessions() as db:
                        saved=await db.get(User,uid)
                        assert saved.session_version==1 and saved.full_name=='Existing Owner'
                        assert saved.email_verified is (case!='unverified-stays-unverified')
                        assert saved.password_reset_digest is None and saved.password_reset_nonce is None
                        assert verify_password(NEW,saved.hashed_password) or (case=='concurrent-confirm' and verify_password(NEW+'Other',saved.hashed_password))
                        assert not verify_password(OLD,saved.hashed_password)
                        notebook=await db.scalar(select(Notebook).where(Notebook.owner_id==uid))
                        assert notebook.name=='Preserved notebook' and notebook.version==1
                    assert delivered[-1][2] is None
            finally:
                app.dependency_overrides.pop(get_db,None)
                await engine.dispose()
        asyncio.run(exercise())
    _with_database(body)


def test_native_recovery_migration_preserves_populated_0007_and_constraints():
    if not os.environ.get('TEST_DATABASE_URL'):
        pytest.skip('Disposable native PostgreSQL TEST_DATABASE_URL required')
    def body(direct_url,async_url):
        prior=_run_alembic(async_url,'upgrade','20261017_0007');assert prior.returncode==0,prior.stderr
        async def inspect(seed=False):
            db=await asyncpg.connect(direct_url)
            try:
                if seed:
                    await db.execute("INSERT INTO users(email,hashed_password,full_name,email_verified_at,session_version) VALUES('legacy-reset@example.com','preserved-hash','Saved Owner',now(),3)")
                    return
                row=await db.fetchrow("SELECT * FROM users WHERE email='legacy-reset@example.com'")
                assert row['hashed_password']=='preserved-hash' and row['session_version']==3 and row['email_verified_at'] is not None
                assert row['password_reset_attempts']==0 and row['password_reset_window_count']==0
                assert row['password_reset_digest'] is None
                for clause in ['password_reset_attempts=-1','password_reset_attempts=6','password_reset_window_count=6']:
                    with pytest.raises(asyncpg.CheckViolationError):await db.execute('UPDATE users SET '+clause)
            finally:await db.close()
        asyncio.run(inspect(seed=True))
        up=_run_alembic(async_url,'upgrade','head');assert up.returncode==0,up.stderr
        asyncio.run(inspect())
        check=_run_alembic(async_url,'check');assert check.returncode==0,check.stderr
        down=_run_alembic(async_url,'downgrade','20261017_0007');assert down.returncode==0,down.stderr
        up=_run_alembic(async_url,'upgrade','head');assert up.returncode==0,up.stderr
    _with_database(body)

