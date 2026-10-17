import importlib.util
from pathlib import Path

import pytest


path=Path(__file__).parents[1]/'scripts/rollout_account_security.py'
spec=importlib.util.spec_from_file_location('security_rollout',path)
rollout=importlib.util.module_from_spec(spec);spec.loader.exec_module(rollout)


@pytest.mark.parametrize('url',[
    'postgresql+asyncpg://postgres:PRIVATE@db.ckjkgsojwtzbiyqxbtdx.supabase.co:5432/postgres',
    'postgresql+asyncpg://postgres.ckjkgsojwtzbiyqxbtdx:PRIVATE@aws-0-eu-west-2.pooler.supabase.com:5432/postgres',
])
def test_rollout_accepts_only_reviewed_project_connection_shapes(url):
    rollout.validate_project_url(url)


@pytest.mark.parametrize('url',[
    'postgresql+asyncpg://postgres:PRIVATE@postgres-test:5432/databricks_clone_test',
    'postgresql+asyncpg://postgres:PRIVATE@db.another-project.supabase.co:5432/postgres',
    'postgresql+asyncpg://postgres.another:PRIVATE@aws-0-eu-west-2.pooler.supabase.com:5432/postgres',
    'postgresql://postgres:PRIVATE@db.ckjkgsojwtzbiyqxbtdx.supabase.co:5432/postgres',
    'postgresql+asyncpg://postgres.ckjkgsojwtzbiyqxbtdx:PRIVATE@fake-pooler.example:5432/postgres',
    'postgresql+asyncpg://postgres:PRIVATE@db.ckjkgsojwtzbiyqxbtdx.supabase.co:5432/another_db',
])
def test_rollout_refuses_unreviewed_databases_without_disclosing_secret(url):
    with pytest.raises(ValueError) as caught:rollout.validate_project_url(url)
    assert 'PRIVATE' not in str(caught.value)
