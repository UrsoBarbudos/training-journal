import os
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

TEST_DATABASE_URL = os.environ.get("TRAINING_JOURNAL_TEST_DATABASE_URL", "")
os.environ.setdefault("DATABASE_URL", TEST_DATABASE_URL or "postgresql+psycopg://localhost/training_journal_test")
os.environ.setdefault("API_BEARER_TOKEN", "test-token")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "https://example.test")

from training_journal_api.database import get_session
from training_journal_api.main import app
from training_journal_api.models import Base

@pytest.fixture(scope="session")
def engine():
    if not TEST_DATABASE_URL:
        pytest.skip("Set TRAINING_JOURNAL_TEST_DATABASE_URL to a dedicated test database")
    database_name = urlparse(TEST_DATABASE_URL.replace("postgresql+psycopg", "postgresql")).path.lstrip("/")
    if database_name in {"rdfilms_crm", "training_journal", "postgres", "rdfilms_stage4_test"} or not database_name.endswith("_test"):
        pytest.fail("Integration tests require a dedicated *_test database and refuse production/CRM databases")
    value = create_engine(TEST_DATABASE_URL)
    with value.connect() as connection:
        assert connection.scalar(text("select current_database()")) == database_name
    Base.metadata.create_all(value)
    yield value
    Base.metadata.drop_all(value)
    value.dispose()

@pytest.fixture(autouse=True)
def clean_database(engine):
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE workout_sets, workout_exercises, workouts CASCADE"))

@pytest.fixture
def client(engine):
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    def override():
        with factory() as session: yield session
    app.dependency_overrides[get_session] = override
    with TestClient(app) as value: yield value
    app.dependency_overrides.clear()

@pytest.fixture
def headers(): return {"Authorization": "Bearer test-token"}
