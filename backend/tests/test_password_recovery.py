import asyncio
from datetime import datetime, timedelta, timezone
import importlib.util
import io
from pathlib import Path
from unittest.mock import AsyncMock, Mock

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
import httpx
import pytest

from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.main import app
from app.models.user import User
from app.schemas.password_recovery import RecoveryConfirm, RecoveryRequest
from app.services import password_recovery as service
from app.services import email_verification

NOW = datetime.now(timezone.utc)
OLD = ' Old-Password-123! '
NEW = ' New-Password-456! '
CODE = '00123456'


@pytest.fixture
def account():
    u = User(id=41, email='reset@example.com', hashed_password=get_password_hash(OLD), full_name='Existing Name',
             is_active=True, is_superuser=False, email_verified_at=NOW, session_version=2,
             password_reset_nonce='random-test-nonce', password_reset_expires_at=NOW+timedelta(minutes=10),
             password_reset_attempts=0, password_reset_window_count=1, password_reset_window_started_at=NOW,
             password_reset_last_sent_at=NOW-timedelta(seconds=61))
    u.password_reset_digest=service._digest(u,u.password_reset_nonce,CODE)
    return u


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(service,'_public_budget',AsyncMock())
    monkeypatch.setattr(service,'_minimum_duration',AsyncMock())
    monkeypatch.setattr(service,'_reserve_delivery_budget',AsyncMock())
    monkeypatch.setattr(service,'_deliver',AsyncMock(return_value=True))
    monkeypatch.setattr(settings,'RESEND_API_KEY',SecretStr('re_PRIVATE_TEST_KEY'))
    monkeypatch.setattr(settings,'EMAIL_FROM','no-reply@notify.sprout-sql.com')


def database(user):
    db=AsyncMock();row=Mock();row.scalar_one_or_none.return_value=user
    clock=Mock();clock.scalar_one.return_value=NOW
    db.execute.side_effect=[row,clock,clock]
    return db


def test_digest_is_bound_to_purpose_identity_nonce_and_session(account):
    digest=service._digest(account,'nonce',CODE)
    assert digest != email_verification._digest(account,'nonce',CODE)
    account.session_version+=1
    assert digest != service._digest(account,'nonce',CODE)
    account.session_version-=1;account.email='other@example.com'
    assert digest != service._digest(account,'nonce',CODE)
    assert digest != service._digest(account,'different',CODE)


@pytest.mark.parametrize('extra',[
 {'code':'1234567'}, {'code':'１２３４５６７８'}, {'code':CODE+'\n'},
 {'code':12345678}, {'new_password':'short'}, {'new_password':'a'*129},
 {'new_password':'\ud800'*8}, {'is_superuser':True}, {'email_verified':True},
])
def test_allowlisted_schema_rejects_invalid_inputs(extra):
    with pytest.raises(ValidationError):RecoveryConfirm(**({'email':'reset@example.com','code':CODE,'new_password':NEW}|extra))


def test_password_spaces_are_not_normalized():
    p=RecoveryConfirm(email='reset@example.com',code=CODE,new_password=NEW)
    assert p.new_password==NEW
    with pytest.raises(ValidationError):RecoveryRequest(email='reset@example.com',code=CODE)


@pytest.mark.parametrize('case',['missing','inactive','cooldown','hour-limit','budget-limit','transport-uncertain','normal','unverified'])
def test_request_responses_never_disclose_account_or_delivery(account,case,monkeypatch):
    if case=='inactive':account.is_active=False
    if case=='cooldown':account.password_reset_last_sent_at=NOW
    if case=='hour-limit':account.password_reset_window_count=5
    if case=='unverified':account.email_verified_at=None
    if case=='budget-limit':monkeypatch.setattr(service,'_reserve_delivery_budget',AsyncMock(side_effect=HTTPException(429,'private provider detail')))
    if case=='transport-uncertain':service._deliver.return_value=False
    db=database(None if case=='missing' else account)
    before_hash=account.hashed_password;before_version=account.session_version
    result=asyncio.run(service.request_recovery(db,'reset@example.com'))
    assert result==service.GENERIC_RESPONSE and CODE not in str(result)
    assert account.hashed_password==before_hash and account.session_version==before_version
    service._minimum_duration.assert_awaited_once()
    if case in ['normal','unverified','transport-uncertain']:
        service._deliver.assert_awaited_once();db.commit.assert_awaited_once()
        assert service._reserve_delivery_budget.await_count==1
        args=service._deliver.call_args.args
        assert len(args[2])==8 and args[2].isascii() and args[2].isdigit()
        assert account.password_reset_digest != args[2]
        assert account.password_reset_digest==service._digest(account,args[1],args[2])
        assert account.password_reset_window_count==2
    else:
        service._deliver.assert_not_awaited();db.rollback.assert_awaited_once()


def test_success_atomically_changes_password_consumes_proof_and_revokes(account):
    db=database(account)
    asyncio.run(service.confirm_recovery(db,account.email,CODE,NEW))
    assert verify_password(NEW,account.hashed_password) and not verify_password(OLD,account.hashed_password)
    assert account.session_version==3 and account.email_verified_at==NOW and account.full_name=='Existing Name'
    assert account.password_reset_digest is None and account.password_reset_nonce is None and account.password_reset_expires_at is None
    query=db.execute.call_args_list[0].args[0]
    assert query._for_update_arg is not None and query.get_execution_options()['populate_existing'] is True
    assert db.commit.await_count==2;assert service._deliver.call_args.args[2] is None


def test_unverified_account_is_not_verified_by_recovery(account):
    account.email_verified_at=None
    asyncio.run(service.confirm_recovery(database(account),account.email,CODE,NEW))
    assert not account.email_verified


@pytest.mark.parametrize('case',['missing','inactive','expired','used','exhausted','wrong','revoked'])
def test_invalid_codes_cannot_change_password_or_session(account,case):
    if case=='inactive':account.is_active=False
    if case=='expired':account.password_reset_expires_at=NOW
    if case=='used':account.password_reset_digest=None
    if case=='exhausted':account.password_reset_attempts=5
    if case=='revoked':account.session_version+=1
    db=database(None if case=='missing' else account);old_hash=account.hashed_password;version=account.session_version
    with pytest.raises(HTTPException) as error:
        asyncio.run(service.confirm_recovery(db,account.email,'99999999' if case=='wrong' else CODE,NEW))
    assert error.value.status_code==400 and account.hashed_password==old_hash and account.session_version==version
    service._deliver.assert_not_awaited()
    if case in ['wrong','revoked']:db.commit.assert_awaited_once();assert account.password_reset_attempts==1
    else:db.rollback.assert_awaited_once()


def test_fifth_wrong_attempt_invalidates_challenge(account):
    account.password_reset_attempts=4;db=database(account)
    with pytest.raises(HTTPException):asyncio.run(service.confirm_recovery(db,account.email,'99999999',NEW))
    assert account.password_reset_attempts==5 and account.password_reset_digest is None and account.password_reset_nonce is None


def test_same_password_consumes_attempt_without_revoking(account):
    db=database(account)
    with pytest.raises(HTTPException) as error:asyncio.run(service.confirm_recovery(db,account.email,CODE,OLD))
    assert error.value.status_code==400 and 'different' in error.value.detail
    assert account.session_version==2 and account.password_reset_attempts==1


@pytest.mark.parametrize('path',['request','confirm'])
def test_anonymous_route_is_origin_protected_and_redacts_sensitive_validation(path):
    with TestClient(app) as client:
        body={'email':'PRIVATE_INVALID_EMAIL','code':'PRIVATE_RESET_CODE','new_password':'PRIVATE_SHORT'}
        r=client.post('/api/v1/auth/password-recovery/'+path,headers={'Origin':settings.FRONTEND_URL},json=body)
        assert r.status_code==422 and r.headers['cache-control']=='no-store'
        assert not any(v in r.text for v in body.values())
        assert client.post('/api/v1/auth/password-recovery/'+path,json=body,headers={'Origin':'https://evil.example'}).status_code==403


@pytest.mark.parametrize('case',['success','rejected','timeout','malformed'])
def test_real_transport_is_scoped_and_never_logs_secrets(case,monkeypatch,caplog):
    captured=[]
    class Client:
        def __init__(self,**kwargs):assert kwargs['follow_redirects'] is False
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            captured.append((url,kwargs))
            if case=='timeout':raise httpx.ReadTimeout('PRIVATE_PROVIDER_BODY')
            return httpx.Response(403 if case=='rejected' else 200,json={'id':'message'} if case!='malformed' else {'id':None})
    spec=importlib.util.spec_from_file_location('real_recovery_service',Path(service.__file__))
    real=importlib.util.module_from_spec(spec);spec.loader.exec_module(real)
    monkeypatch.setattr(real.httpx,'AsyncClient',Client)
    assert asyncio.run(real._deliver('private@example.com','PRIVATE_NONCE',CODE)) is (case=='success')
    url,request=captured[0];assert url=='https://api.resend.com/emails'
    assert request['headers']['Idempotency-Key']=='password-recovery/code/PRIVATE_NONCE'
    assert CODE in request['json']['text'] and 'password reset' in request['json']['subject']
    assert all(x not in caplog.text for x in [CODE,'private@example.com','PRIVATE_NONCE','PRIVATE_PROVIDER_BODY','re_PRIVATE_TEST_KEY'])


def test_additive_migration_has_no_account_rewrites():
    path=Path(__file__).parents[1]/'alembic/versions/20261017_0008_password_recovery.py'
    spec=importlib.util.spec_from_file_location('recovery_migration',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    assert module.down_revision=='20261017_0007'
    output=io.StringIO();context=MigrationContext.configure(url='postgresql://',opts={'as_sql':True,'output_buffer':output})
    with Operations.context(context):module.upgrade()
    sql=output.getvalue();assert sql.count('ADD COLUMN')==7 and 'UPDATE ' not in sql and 'DROP ' not in sql


def test_completion_notice_reserves_in_current_window_not_request_time(account):
    account.password_reset_last_sent_at=NOW-timedelta(days=1)
    db=database(account);clock=Mock();clock.scalar_one.return_value=NOW
    db.execute.side_effect=[clock]
    asyncio.run(service._completion_notice(db,account.email,'notice-nonce'))
    assert service._reserve_delivery_budget.call_args.args[1] == NOW
    # The notice obtains its own database clock, not the challenge timestamp.
    assert 'clock_timestamp' in str(db.execute.call_args.args[0])
    db.commit.assert_awaited_once()
    service._deliver.assert_awaited_once_with(account.email,'notice-nonce',None)


def test_notification_budget_failure_does_not_undo_completed_reset(account,monkeypatch):
    monkeypatch.setattr(service,'_reserve_delivery_budget',AsyncMock(side_effect=HTTPException(429,'budget')))
    db=database(account)
    asyncio.run(service.confirm_recovery(db,account.email,CODE,NEW))
    assert account.session_version==3 and account.password_reset_digest is None
    assert verify_password(NEW,account.hashed_password)
    db.commit.assert_awaited_once();db.rollback.assert_awaited_once()
    service._deliver.assert_not_awaited()


def test_new_hour_restores_send_budget_without_changing_password(account):
    account.password_reset_window_count=5
    account.password_reset_window_started_at=NOW-timedelta(hours=2)
    db=database(account)
    asyncio.run(service.request_recovery(db,account.email))
    assert account.password_reset_window_count==1 and account.password_reset_window_started_at==NOW
    assert account.session_version==2 and verify_password(OLD,account.hashed_password)

