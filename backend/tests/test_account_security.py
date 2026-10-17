import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import Request

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import create_access_token, decode_token, get_password_hash, verify_password
from app.db.session import get_db
from app.main import app
from app.models.user import User
from app.schemas.account_security import PasswordChange, SecurityReauthentication
from app.services import account_security as service

CURRENT = 'Current-Passphrase-123!'
NEXT = 'New-Passphrase-456!'


@pytest.fixture()
def account():
    now = datetime.now(timezone.utc)
    return User(id=42, email='security@example.com', full_name='Saved Name',
                hashed_password=get_password_hash(CURRENT), is_active=True,
                is_superuser=False, email_verified_at=now, created_at=now,
                session_version=0, security_attempts=0, security_window_started_at=None)


def database(account):
    db = AsyncMock()
    row = Mock(); row.scalar_one_or_none.return_value = account
    clock = Mock(); clock.scalar_one.return_value = datetime.now(timezone.utc)
    db.execute.side_effect = [row, clock]
    return db


@pytest.mark.parametrize('payload', [
    {'current_password': '', 'new_password': NEXT},
    {'current_password': CURRENT, 'new_password': 'short'},
    {'current_password': CURRENT, 'new_password': 'a'*129},
    {'current_password': 'a'*129, 'new_password': NEXT},
    {'current_password': CURRENT, 'new_password': '\ud800'*8},
    {'current_password': CURRENT, 'new_password': NEXT, 'id': 99},
    {'current_password': CURRENT, 'new_password': NEXT, 'is_superuser': True},
    {'current_password': CURRENT},
])
def test_separate_schema_forbids_invalid_and_extra_fields(payload):
    with pytest.raises(ValidationError): PasswordChange(**payload)


def test_passwords_are_not_normalized():
    payload = PasswordChange(current_password=' '+CURRENT+' ', new_password=' '+NEXT+' ')
    assert payload.current_password == ' '+CURRENT+' ' and payload.new_password == ' '+NEXT+' '
    with pytest.raises(ValidationError): SecurityReauthentication(current_password=CURRENT, new_password=NEXT)


def test_password_change_is_id_bound_and_revokes_all_prior_versions(account):
    db=database(account)
    asyncio.run(service.secure_account(db,user_id=42,expected_version=0,current_password=CURRENT,new_password=NEXT))
    assert account.session_version == 1 and account.security_attempts == 1
    assert verify_password(NEXT,account.hashed_password) and not verify_password(CURRENT,account.hashed_password)
    assert account.email_verified and account.full_name == 'Saved Name'
    query=db.execute.call_args_list[0].args[0]
    assert query.compile().params['id_1'] == 42 and query._for_update_arg is not None
    assert query.get_execution_options()['populate_existing'] is True
    db.commit.assert_awaited_once()


def test_sign_out_everywhere_preserves_password_and_owned_identity(account):
    original=account.hashed_password;db=database(account)
    asyncio.run(service.secure_account(db,user_id=42,expected_version=0,current_password=CURRENT))
    assert account.session_version == 1 and account.hashed_password == original
    assert account.email == 'security@example.com' and account.email_verified
    db.commit.assert_awaited_once()


@pytest.mark.parametrize('new_password,detail', [(None,'incorrect'),(CURRENT,'different')])
def test_wrong_or_unchanged_password_commits_only_attempt(account,new_password,detail):
    original=account.hashed_password;db=database(account)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(service.secure_account(db,user_id=42,expected_version=0,current_password='wrong' if new_password is None else CURRENT,new_password=new_password))
    assert caught.value.status_code == 400 and detail in caught.value.detail
    assert account.session_version == 0 and account.hashed_password == original and account.security_attempts == 1
    db.commit.assert_awaited_once()


def test_exhausted_limit_skips_expensive_hash_and_reports_retry(account,monkeypatch):
    account.security_attempts=5;account.security_window_started_at=datetime.now(timezone.utc)
    verify=Mock();monkeypatch.setattr(service,'verify_password',verify);db=database(account)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(service.secure_account(db,user_id=42,expected_version=0,current_password=CURRENT))
    assert caught.value.status_code == 429 and 1 <= int(caught.value.headers['Retry-After']) <= 900
    verify.assert_not_called();db.commit.assert_not_awaited();db.rollback.assert_awaited_once()


def test_expired_window_resets_durable_count(account):
    account.security_attempts=5;account.security_window_started_at=datetime(2000,1,1,tzinfo=timezone.utc)
    db=database(account)
    asyncio.run(service.secure_account(db,user_id=42,expected_version=0,current_password=CURRENT))
    assert account.security_attempts == 1 and account.session_version == 1


@pytest.mark.parametrize('scenario,status', [('stale',401),('inactive',403),('pending',403),('missing',401)])
def test_locked_row_rechecks_session_account_and_verification(account,monkeypatch,scenario,status):
    monkeypatch.setattr(settings,'EMAIL_VERIFICATION_REQUIRED',True)
    if scenario=='stale': account.session_version=1
    if scenario=='inactive': account.is_active=False
    if scenario=='pending': account.email_verified_at=None
    db=database(None if scenario=='missing' else account)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(service.secure_account(db,user_id=42,expected_version=0,current_password=CURRENT))
    assert caught.value.status_code == status
    db.commit.assert_not_awaited();db.rollback.assert_awaited_once()


@pytest.mark.parametrize('version,stored,valid', [(None,0,True),(None,1,False),(0,0,True),(0,1,False),(1,1,True),(-1,0,False),('0',0,False),(False,0,False),(1.0,1,False),([],0,False)])
def test_cookie_version_is_typed_and_legacy_is_zero_only(account,version,stored,valid):
    account.session_version=stored
    claims={'sub':account.email}
    if version is not None: claims['sv']=version
    token=create_access_token(claims)
    request=Request({'type':'http','headers':[(b'cookie',f'{settings.AUTH_COOKIE_NAME}={token}'.encode())]})
    db=AsyncMock(); result=Mock();result.scalar_one_or_none.return_value=account;db.execute.return_value=result
    if valid: assert asyncio.run(get_current_user(request,db)) is account
    else:
        with pytest.raises(HTTPException) as caught: asyncio.run(get_current_user(request,db))
        assert caught.value.status_code == 401


@pytest.fixture()
def security_client(account,monkeypatch):
    monkeypatch.setattr(settings,'EMAIL_VERIFICATION_REQUIRED',True)
    db=database(account)
    async def test_db():yield db
    app.dependency_overrides[get_db]=test_db
    app.dependency_overrides[get_current_user]=lambda:account
    try:
        with TestClient(app) as client:yield client,account,db
    finally:
        app.dependency_overrides.pop(get_db,None);app.dependency_overrides.pop(get_current_user,None)


@pytest.mark.parametrize('path', ['/auth/password','/auth/sessions/revoke'])
def test_success_revokes_without_overwriting_a_newer_cookie_or_returning_credentials(security_client,path,caplog):
    client,account,db=security_client
    body={'current_password':CURRENT}
    if path.endswith('/password'):body['new_password']=NEXT
    response=client.post('/api/v1'+path,headers={'Origin':settings.FRONTEND_URL},json=body)
    assert response.status_code == 204 and not response.content
    assert 'set-cookie' not in response.headers
    assert response.headers['cache-control']=='no-store'
    assert CURRENT not in caplog.text and NEXT not in caplog.text and account.hashed_password not in caplog.text


@pytest.mark.parametrize('origin',[None,'https://evil.example'])
def test_security_requires_trusted_origin(security_client,origin):
    client,_,db=security_client
    r=client.post('/api/v1/auth/sessions/revoke',headers={'Origin':origin} if origin else {},json={'current_password':CURRENT})
    assert r.status_code==403;db.commit.assert_not_awaited()


def test_malformed_secret_input_is_not_echoed(security_client,caplog):
    client,_,db=security_client
    r=client.post('/api/v1/auth/password',headers={'Origin':settings.FRONTEND_URL},json={'current_password':CURRENT,'new_password':'SHORT_PRIVATE_SECRET','is_superuser':'EXTRA_PRIVATE_SECRET'})
    assert r.status_code==422 and CURRENT not in r.text and 'PRIVATE_SECRET' not in r.text
    assert CURRENT not in caplog.text and 'PRIVATE_SECRET' not in caplog.text
    db.commit.assert_not_awaited()


def test_pending_account_cannot_change_security(security_client):
    client,account,db=security_client;account.email_verified_at=None
    r=client.post('/api/v1/auth/sessions/revoke',headers={'Origin':settings.FRONTEND_URL},json={'current_password':CURRENT})
    assert r.status_code==403 and r.headers['x-email-verification-required']=='true'
    db.commit.assert_not_awaited()


def test_logged_out_account_cannot_change_security(security_client):
    client,_,db=security_client;app.dependency_overrides.pop(get_current_user)
    r=client.post('/api/v1/auth/sessions/revoke',headers={'Origin':settings.FRONTEND_URL},json={'current_password':CURRENT})
    assert r.status_code==401;db.commit.assert_not_awaited()


def test_login_cookie_contains_database_session_version(security_client,monkeypatch):
    from app.api.routes import auth
    client,account,db=security_client;account.session_version=8
    result=Mock();result.scalar_one_or_none.return_value=account;db.execute.side_effect=None;db.execute.return_value=result
    response=client.post('/api/v1/auth/login',headers={'Origin':settings.FRONTEND_URL},data={'username':account.email,'password':CURRENT})
    assert response.status_code==204
    assert decode_token(response.cookies[settings.AUTH_COOKIE_NAME])['sv']==8


def test_explicit_null_session_version_is_not_a_legacy_cookie(account):
    token=create_access_token({'sub':account.email,'sv':None})
    request=Request({'type':'http','headers':[(b'cookie',f'{settings.AUTH_COOKIE_NAME}={token}'.encode())]})
    db=AsyncMock();result=Mock();result.scalar_one_or_none.return_value=account;db.execute.return_value=result
    with pytest.raises(HTTPException) as caught:asyncio.run(get_current_user(request,db))
    assert caught.value.status_code==401
