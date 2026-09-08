import copy
import uuid
from datetime import UTC, datetime, timedelta
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from training_journal_api.models import Workout, WorkoutExercise, WorkoutSet

def payload():
    now = datetime.now(UTC)
    return {
        "id": str(uuid.uuid4()), "date": "2026-09-06", "type": "A", "status": "active",
        "title": "День A", "notes": "", "pre": {}, "post": {},
        "exercises": [{
            "id": str(uuid.uuid4()), "name": "Присед", "warmupSets": [{"weight": None, "reps": 10}],
            "sets": [{"weight": 30.5, "reps": None}, {"weight": None, "reps": 8}],
            "rpe": None, "durationMinutes": 5, "instruction": "медленно", "notes": "",
        }],
        "createdAt": now.isoformat(), "updatedAt": now.isoformat(), "schemaVersion": 1,
        "skipped": ["Планка"], "sourceText": "source",
    }

def test_create_idempotency_and_full_payload(client, headers):
    body = payload(); url = f"/api/v1/workouts/{body['id']}"
    assert client.put(url, json=body, headers=headers).status_code == 200
    assert client.put(url, json=body, headers=headers).json()["status"] == "unchanged"
    saved = client.get(url, headers=headers).json()
    assert saved["sourceText"] == "source" and saved["skipped"] == ["Планка"]

def test_update_replaces_children_and_preserves_order(client, headers, engine):
    body = payload(); url = f"/api/v1/workouts/{body['id']}"; client.put(url, json=body, headers=headers)
    updated = copy.deepcopy(body); updated["updatedAt"] = (datetime.fromisoformat(body["updatedAt"]) + timedelta(seconds=1)).isoformat()
    updated["exercises"] = [{"id": str(uuid.uuid4()), "name": "Тяга", "sets": [{"weight": 40, "reps": 5}], "warmupSets": [], "notes": ""}]
    assert client.put(url, json=updated, headers=headers).status_code == 200
    with Session(engine) as session:
        exercises = session.scalars(select(WorkoutExercise).order_by(WorkoutExercise.position)).all()
        sets = session.scalars(select(WorkoutSet).order_by(WorkoutSet.position)).all()
        assert [item.name for item in exercises] == ["Тяга"]
        assert [(item.position, item.reps) for item in sets] == [(0, 5)]

def test_stale_and_equal_timestamp_conflicts(client, headers):
    body = payload(); url = f"/api/v1/workouts/{body['id']}"; client.put(url, json=body, headers=headers)
    different = copy.deepcopy(body); different["notes"] = "other"
    assert client.put(url, json=different, headers=headers).status_code == 409
    older = copy.deepcopy(body); older["updatedAt"] = (datetime.fromisoformat(body["updatedAt"]) - timedelta(seconds=1)).isoformat()
    assert client.put(url, json=older, headers=headers).status_code == 409

def test_auth_and_id_mismatch(client, headers):
    body = payload()
    assert client.put(f"/api/v1/workouts/{body['id']}", json=body).status_code == 401
    assert client.put(f"/api/v1/workouts/{uuid.uuid4()}", json=body, headers=headers).status_code == 422

def test_delete_cascades_and_repeated_delete(client, headers, engine):
    body = payload(); url = f"/api/v1/workouts/{body['id']}"; client.put(url, json=body, headers=headers)
    deletion = {"clientUpdatedAt": (datetime.fromisoformat(body["updatedAt"]) + timedelta(seconds=1)).isoformat()}
    assert client.request("DELETE", url, json=deletion, headers=headers).status_code == 200
    assert client.request("DELETE", url, json=deletion, headers=headers).status_code == 404
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Workout)) == 0
        assert session.scalar(select(func.count()).select_from(WorkoutExercise)) == 0
        assert session.scalar(select(func.count()).select_from(WorkoutSet)) == 0

def test_stale_delete_is_rejected(client, headers):
    body = payload(); url = f"/api/v1/workouts/{body['id']}"; client.put(url, json=body, headers=headers)
    deletion = {"clientUpdatedAt": (datetime.fromisoformat(body["updatedAt"]) - timedelta(seconds=1)).isoformat()}
    assert client.request("DELETE", url, json=deletion, headers=headers).status_code == 409
