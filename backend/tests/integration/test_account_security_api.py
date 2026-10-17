"""Real HTTP, native PostgreSQL, independent cookies and concurrent requests."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
from threading import Barrier

import asyncpg
import httpx

NEW = 'Changed-Passphrase-2026!'


def login(api_client, user, password=None):
    response = api_client.post('auth/login',headers={'Origin':user['headers']['Origin']},data={'username':user['email'],'password':password or user['password']})
    cookie = response.cookies.get('dataplatform_session')
    api_client.cookies.clear()
    return response, {'Origin':user['headers']['Origin'],'Cookie':f'dataplatform_session={cookie}'}


def test_change_password_invalidates_two_sessions_but_preserves_data_and_other_account(api_client,user_factory,sales_dataset_factory):
    owner=user_factory('security-owner');other=user_factory('security-other')
    dataset=sales_dataset_factory(owner['headers'])
    _,second=login(api_client,owner)
    response=api_client.post('auth/password',headers=owner['headers'],json={'current_password':owner['password'],'new_password':NEW})
    assert response.status_code==204,response.text
    assert 'set-cookie' not in response.headers and response.headers['cache-control']=='no-store'
    assert api_client.get('auth/me',headers=owner['headers']).status_code==401
    assert api_client.get('auth/me',headers=second).status_code==401
    assert api_client.get('datasets',headers=second).status_code==401
    assert api_client.get('auth/me',headers=other['headers']).status_code==200
    assert login(api_client,owner)[0].status_code==401
    fresh,headers=login(api_client,owner,NEW);assert fresh.status_code==204
    current=api_client.get('auth/me',headers=headers).json()
    assert current['email_verified'] is True and current['full_name']==owner['full_name']
    assert api_client.get(f"datasets/{dataset['id']}",headers=headers).status_code==200
    assert login(api_client,other)[0].status_code==204


def test_sign_out_everywhere_revokes_both_sessions_and_password_still_works(api_client,user_factory):
    owner=user_factory('security-revoke');_,second=login(api_client,owner)
    r=api_client.post('auth/sessions/revoke',headers=second,json={'current_password':owner['password']})
    assert r.status_code==204,r.text
    assert api_client.get('auth/me',headers=owner['headers']).status_code==401
    assert api_client.get('auth/me',headers=second).status_code==401
    _,fresh=login(api_client,owner)
    assert api_client.get('auth/me',headers=fresh).status_code==200


def test_durable_shared_limit_survives_login_and_expires_without_changing_password(api_client,user_factory):
    owner=user_factory('security-limit')
    for i in range(5):
        path='auth/password' if i%2 else 'auth/sessions/revoke'
        body={'current_password':'wrong-password'}
        if path.endswith('/password'):body['new_password']=NEW
        assert api_client.post(path,headers=owner['headers'],json=body).status_code==400
    _,fresh=login(api_client,owner)
    limit=api_client.post('auth/sessions/revoke',headers=fresh,json={'current_password':owner['password']})
    assert limit.status_code==429 and 1<=int(limit.headers['retry-after'])<=900
    assert api_client.get('auth/me',headers=fresh).status_code==200
    async def expire_window():
        db=await asyncpg.connect(os.environ['TEST_DATABASE_URL'])
        try:await db.execute("UPDATE users SET security_window_started_at=now()-interval '16 minutes' WHERE id=$1",owner['user']['id'])
        finally:await db.close()
    asyncio.run(expire_window())
    assert api_client.post('auth/sessions/revoke',headers=fresh,json={'current_password':owner['password']}).status_code==204


def test_parallel_security_changes_have_one_winner_and_no_lost_version_update(api_client,user_factory):
    owner=user_factory('security-race');barrier=Barrier(2)
    def change(password):
        with httpx.Client(base_url=api_client.base_url,timeout=30) as client:
            barrier.wait(timeout=10)
            r=client.post('auth/password',headers=owner['headers'],json={'current_password':owner['password'],'new_password':password})
            return r.status_code,password
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(change,[NEW,NEW+'Other']))
    assert sorted(s for s,_ in results)==[204,401],results
    winner=next(p for s,p in results if s==204)
    loser=next(p for s,p in results if s==401)
    assert login(api_client,owner,winner)[0].status_code==204
    assert login(api_client,owner,loser)[0].status_code==401


def test_parallel_wrong_attempts_cannot_bypass_distributed_limit(api_client,user_factory):
    owner=user_factory('security-parallel-limit');barrier=Barrier(7)
    def attempt(_):
        with httpx.Client(base_url=api_client.base_url,timeout=30) as client:
            barrier.wait(timeout=10)
            return client.post('auth/sessions/revoke',headers=owner['headers'],json={'current_password':'wrong-password'}).status_code
    with ThreadPoolExecutor(max_workers=7) as pool:statuses=list(pool.map(attempt,range(7)))
    assert statuses.count(400)==5 and statuses.count(429)==2,statuses


def test_legacy_cookie_works_before_revocation_and_cannot_return_afterwards(api_client,user_factory):
    from app.core.security import create_access_token
    owner=user_factory('security-legacy')
    legacy={'Origin':owner['headers']['Origin'],'Cookie':'dataplatform_session='+create_access_token({'sub':owner['email']})}
    assert api_client.get('auth/me',headers=legacy).status_code==200
    assert api_client.post('auth/sessions/revoke',headers=owner['headers'],json={'current_password':owner['password']}).status_code==204
    assert api_client.get('auth/me',headers=legacy).status_code==401
    _,fresh=login(api_client,owner)
    assert api_client.get('auth/me',headers=fresh).status_code==200
    assert api_client.get('auth/me',headers=legacy).status_code==401
