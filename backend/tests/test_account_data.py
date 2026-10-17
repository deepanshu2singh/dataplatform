import asyncio
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt
from pydantic import ValidationError
import pytest

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import create_access_token, decode_token, get_password_hash
from app.db.session import get_db
from app.main import app
from app.models.dataset import Dataset, DatasetType
from app.models.notebook import Notebook
from app.models.user import User
from app.schemas.account_data import ExportCatalog, ExportRecord, ExportDatasetFile
from app.services import account_data as service
from app.services.storage import build_dataset_object_key

PASSWORD = 'Export-Current-Password-123!'


@pytest.mark.parametrize('case', ['valid', 'bad-filename', 'other-owner'])
def test_source_download_uses_validated_owner_key_before_storage(user, monkeypatch, case):
    key = (f'users/{user.id}/source.csv' if case == 'bad-filename'
           else build_dataset_object_key(99 if case == 'other-owner' else user.id))
    row = Dataset(id=7, owner_id=user.id, name='Original CSV', type=DatasetType.FILE,
                  config={'storage_backend': 'supabase', 'bucket': settings.SUPABASE_STORAGE_BUCKET,
                          'object_key': key})
    monkeypatch.setattr(service, 'owned', AsyncMock(return_value=row))
    storage = Mock()
    storage.create_signed_download = AsyncMock(return_value='https://test.supabase.co/signed-test-file')
    factory = Mock(return_value=storage)
    monkeypatch.setattr(service.SupabaseStorageService, 'from_settings', factory)
    if case != 'valid':
        with pytest.raises(HTTPException) as exc:
            asyncio.run(service.dataset_file_download(AsyncMock(), user, 7))
        assert exc.value.status_code == 404
        factory.assert_not_called()
        storage.create_signed_download.assert_not_awaited()
        return
    result = asyncio.run(service.dataset_file_download(AsyncMock(), user, 7))
    assert result['filename'] == 'dataset-7.csv' and result['expires_in_seconds'] == 60
    assert result['url'] == storage.create_signed_download.return_value
    storage.create_signed_download.assert_awaited_once_with(key, expires_seconds=60)


@pytest.fixture()
def user():
    now = datetime.now(timezone.utc)
    return User(id=42, email='export@example.com', full_name='Saved Name', hashed_password=get_password_hash(PASSWORD),
                created_at=now, updated_at=now, email_verified_at=now, is_active=True, is_superuser=False,
                session_version=3, security_attempts=0, security_window_started_at=None)


def database(user):
    db = AsyncMock(); row=Mock(); row.scalar_one_or_none.return_value=user
    clock=Mock();clock.scalar_one.return_value=datetime.now(timezone.utc)
    db.execute.side_effect=[row,clock]
    return db


def test_confirmation_preserves_password_sessions_verification_and_counts_attempt(user):
    db=database(user); original=user.hashed_password
    result=asyncio.run(service.authorize(db,42,3,PASSWORD))
    assert user.hashed_password==original and user.session_version==3 and user.email_verified
    assert user.security_attempts==1 and result['account']['full_name']=='Saved Name'
    assert not {'hashed_password','session_version','password_reset_digest'} & result['account'].keys()
    service.check_proof(result['proof'],user)
    assert decode_token(result['proof']) is None  # Export proof is not an access cookie.
    query=db.execute.call_args_list[0].args[0]
    assert query._for_update_arg is not None and query.get_execution_options()['populate_existing']
    db.commit.assert_awaited_once()


def test_wrong_password_consumes_only_shared_durable_attempt(user):
    db=database(user)
    with pytest.raises(HTTPException) as exc:asyncio.run(service.authorize(db,42,3,'wrong'))
    assert exc.value.status_code==400 and user.security_attempts==1 and user.session_version==3
    db.commit.assert_awaited_once()


def test_exhausted_window_does_not_hash_password(user,monkeypatch):
    user.security_attempts=5;user.security_window_started_at=datetime.now(timezone.utc)
    db=database(user);verify=Mock();monkeypatch.setattr(service,'verify_password',verify)
    with pytest.raises(HTTPException) as exc:asyncio.run(service.authorize(db,42,3,PASSWORD))
    assert exc.value.status_code==429 and 0<int(exc.value.headers['Retry-After'])<=900
    verify.assert_not_called();db.rollback.assert_awaited_once()


@pytest.mark.parametrize('case,status',[('stale',401),('missing',401),('inactive',403),('unverified',403)])
def test_confirmation_rechecks_locked_identity(user,monkeypatch,case,status):
    monkeypatch.setattr(settings,'EMAIL_VERIFICATION_REQUIRED',True)
    if case=='inactive':user.is_active=False
    if case=='unverified':user.email_verified_at=None
    db=database(None if case=='missing' else user)
    with pytest.raises(HTTPException) as exc:asyncio.run(service.authorize(db,42,2 if case=='stale' else 3,PASSWORD))
    assert exc.value.status_code==status;db.commit.assert_not_awaited()


@pytest.mark.parametrize('case',['other-owner','revoked','access-token','expired','purpose','bool-version','wrong-audience','future','ttl'])
def test_proof_is_purpose_owner_version_expiry_bound(user,case):
    now=datetime.now(timezone.utc);token=service.make_proof(user,now)
    if case=='other-owner':user.id=99
    elif case=='revoked':user.session_version+=1
    elif case=='access-token':token=create_access_token({'sub':user.email,'sv':3})
    elif case=='expired':token=service.make_proof(user,now-timedelta(minutes=16))
    else:
        payload=jwt.get_unverified_claims(token)
        payload.update({'purpose':'login'} if case=='purpose' else {'sv':True} if case=='bool-version' else {'aud':'login'} if case=='wrong-audience' else {'iat':int(now.timestamp())+60} if case=='future' else {'exp':int(now.timestamp())+10000})
        token=jwt.encode(payload,settings.SECRET_KEY,algorithm=settings.ALGORITHM)
    with pytest.raises(HTTPException) as exc:service.check_proof(token,user)
    assert exc.value.status_code==403 and exc.value.headers['Cache-Control']=='no-store'


@pytest.mark.parametrize('model,body',[
    (ExportCatalog,{'proof':'secret','category':'users'}),
    (ExportCatalog,{'proof':'secret','category':'datasets','user_id':99}),
    (ExportRecord,{'proof':'secret','category':'notebooks','record_id':'1','revision':'1','offset':True}),
    (ExportDatasetFile,{'proof':'secret','dataset_id':True}),
    (ExportDatasetFile,{'proof':'secret','dataset_id':1,'object_key':'users/99/file.csv'}),
])
def test_allowlists_forbid_identity_storage_and_bad_offsets(model,body):
    with pytest.raises(ValidationError):model(**body)


def test_catalog_query_is_owner_filtered_bounded_and_does_not_load_content(user):
    db=AsyncMock();result=Mock();result.all.return_value=[SimpleNamespace(id=n,name=f'Item{n}',version=1) for n in range(26,52)];db.execute.return_value=result
    page=asyncio.run(service.catalog(db,user,'notebooks','25'))
    query=db.execute.call_args.args[0];params=query.compile().params
    assert params['owner_id_1']==42 and params['id_1']==25
    assert len(page['items'])==25 and page['next_cursor']=='50'
    assert 'content' not in str(query) and query._limit_clause.value==26


def test_record_fragment_roundtrip_multibyte_large_content_and_no_execution(user,monkeypatch):
    row=Notebook(id=7,owner_id=42,name='分析 🌱',description=None,content={'cells':[{'code':'print("do not execute")','output':'é🌱'*1000}]},version=8,created_at=user.created_at)
    monkeypatch.setattr(service,'FRAGMENT_BYTES',37)
    original=AsyncMock(return_value=row);monkeypatch.setattr(service,'owned',original)
    chunks=[];offset=0
    while True:
        part=asyncio.run(service.record_fragment(AsyncMock(),user,'notebooks','7','8',offset));chunks.append(base64.b64decode(part['data_base64']))
        if part['next_offset'] is None:break
        offset=part['next_offset']
    data=b''.join(chunks);value=json.loads(data)
    assert value['content']==row.content and value['name']=='分析 🌱'
    assert hashlib.sha256(data).hexdigest()==part['sha256'] and len(data)==part['total_bytes']
    assert len(chunks)>2 and not {'owner_id','hashed_password'} & value.keys()


def test_dataset_serialization_omits_arbitrary_config_and_storage_secrets(user):
    row=Dataset(id=1,name='Source',owner_id=42,type=DatasetType.FILE,config={'password':'NEVER-EXPORT','object_key':'users/42/a.csv','file_path':'/private/server'},schema_info={},version=1,created_at=user.created_at)
    data=service.serialize('datasets',row)
    assert 'config' not in data and 'NEVER-EXPORT' not in json.dumps(data)
    assert data['source_file_download']=='separate'


@pytest.mark.parametrize('case,status',[('changed',409),('oversize',413),('offset',422)])
def test_record_errors_never_return_partial_success(user,monkeypatch,case,status):
    row=Notebook(id=1,owner_id=42,name='N',content={'cells':[]},version=2,created_at=user.created_at)
    monkeypatch.setattr(service,'owned',AsyncMock(return_value=row))
    if case=='oversize':monkeypatch.setattr(service,'MAX_RECORD_BYTES',1)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(service.record_fragment(AsyncMock(),user,'notebooks','1','1' if case=='changed' else '2',1 if case=='offset' else 0))
    assert exc.value.status_code==status


def test_owned_query_never_trusts_requester_for_owner(user):
    db=AsyncMock();result=Mock();result.scalar_one_or_none.return_value=None;db.execute.return_value=result
    with pytest.raises(HTTPException) as exc:asyncio.run(service.owned(db,user,'datasets','999'))
    assert exc.value.status_code==404 and db.execute.call_args.args[0].compile().params['owner_id_1']==42


@pytest.mark.parametrize('path,payload',[
    ('authorize',{'current_password':'PRIVATE_PASSWORD_SENTINEL','user_id':99}),
    ('catalog',{'proof':'PRIVATE_PROOF_SENTINEL','category':'bad'}),
    ('record',{'proof':'PRIVATE_PROOF_SENTINEL','category':'notebooks','record_id':'1','revision':'1','offset':True}),
])
def test_validation_redacts_inputs_and_response_is_no_store(user,path,payload,monkeypatch):
    monkeypatch.setattr(settings,'EMAIL_VERIFICATION_REQUIRED',True)
    app.dependency_overrides[get_current_user]=lambda:user
    async def fake_db():yield AsyncMock()
    app.dependency_overrides[get_db]=fake_db
    try:
        with TestClient(app) as client:
            r=client.post('/api/v1/account-data/'+path,json=payload,headers={'Origin':settings.FRONTEND_URL})
            assert r.status_code==422 and 'PRIVATE_' not in r.text and r.headers['cache-control']=='no-store'
            assert 'set-cookie' not in r.headers
    finally:app.dependency_overrides.clear()
