import hmac
import uuid
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_session
from .models import Workout, WorkoutExercise, WorkoutSet
from .schemas import DeletePayload, WorkoutList, WorkoutPayload, WorkoutSummary

settings = get_settings()
app = FastAPI(title="Training Journal API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=False, allow_methods=["GET", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])

def error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})

@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content=detail, headers=exc.headers)

@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"code": "validation_error", "message": "Некорректные данные запроса", "errors": exc.errors()})

def authorize(authorization: str | None = Header(default=None)) -> None:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token, settings.api_bearer_token):
        raise error(status.HTTP_401_UNAUTHORIZED, "unauthorized", "Неверный Bearer-токен")

def number(value: Any) -> Decimal | None:
    if value in (None, ""): return None
    try: return Decimal(str(value))
    except (InvalidOperation, ValueError): return None

def integer(value: Any) -> int | None:
    if value in (None, ""): return None
    try: return int(value)
    except (TypeError, ValueError): return None

def maybe_uuid(value: Any) -> uuid.UUID | None:
    try: return uuid.UUID(str(value)) if value else None
    except ValueError: return None

def build_exercises(body: WorkoutPayload) -> list[WorkoutExercise]:
    result = []
    for position, item in enumerate(body.exercises):
        exercise_id = maybe_uuid(item.get("id")) or uuid.uuid5(body.id, f"exercise:{position}")
        plan = item.get("plan") or {}
        feedback = dict(item.get("feedback") or {})
        for key in ("rpe", "durationMinutes", "instruction", "replacedFrom"):
            if key in item: feedback[key] = item[key]
        exercise = WorkoutExercise(
            id=exercise_id, position=position, planned_exercise_id=maybe_uuid(item.get("plannedExerciseId")),
            actual_exercise_id=maybe_uuid(item.get("actualExerciseId")), name=str(item.get("name") or ""),
            plan_weight=number(plan.get("weight")), plan_reps=integer(plan.get("reps")),
            plan_sets=integer(plan.get("sets")) or len(item.get("sets") or []), feedback=feedback,
            notes=item.get("notes") or None,
        )
        combined = [("warmup", value) for value in item.get("warmupSets", [])] + [("working", value) for value in item.get("sets", [])]
        if not combined:
            combined = [(value.get("type", "working"), value) for value in item.get("actualSets", [])]
        exercise.sets = [WorkoutSet(position=index, weight=number(value.get("weight")), reps=integer(value.get("reps")), set_type=set_type) for index, (set_type, value) in enumerate(combined)]
        result.append(exercise)
    return result

@app.get("/api/v1/health")
def health(session: Session = Depends(get_session)):
    session.execute(text("SELECT 1"))
    return {"status": "ok"}

@app.put("/api/v1/workouts/{workout_id}", dependencies=[Depends(authorize)])
def put_workout(workout_id: uuid.UUID, body: WorkoutPayload, session: Session = Depends(get_session)):
    if workout_id != body.id: raise error(422, "id_mismatch", "id в URL не совпадает с body.id")
    payload = body.model_dump(mode="json", by_alias=True)
    current = session.get(Workout, workout_id)
    if current:
        if body.updatedAt < current.client_updated_at: raise error(409, "stale_update", "На сервере уже есть более новая версия")
        if body.updatedAt == current.client_updated_at:
            if payload == current.payload: return {"status": "unchanged", "id": str(workout_id), "serverUpdatedAt": current.server_updated_at}
            raise error(409, "timestamp_conflict", "Одинаковое время изменения соответствует разным данным")
        session.execute(delete(WorkoutExercise).where(WorkoutExercise.workout_id == workout_id))
    else:
        current = Workout(id=workout_id)
        session.add(current)
    current.workout_date = body.date; current.workout_type = body.type; current.status = body.status
    current.notes = body.notes; current.pre = body.pre; current.post = body.post; current.payload = payload
    current.client_created_at = body.createdAt; current.client_updated_at = body.updatedAt
    current.server_updated_at = datetime.now(UTC); current.schema_version = body.schemaVersion
    current.exercises = build_exercises(body)
    session.commit(); session.refresh(current)
    return {"status": "saved", "id": str(workout_id), "serverUpdatedAt": current.server_updated_at}

@app.delete("/api/v1/workouts/{workout_id}", dependencies=[Depends(authorize)])
def delete_workout(workout_id: uuid.UUID, body: DeletePayload, session: Session = Depends(get_session)):
    current = session.get(Workout, workout_id)
    if not current: raise error(404, "not_found", "Тренировка не найдена")
    if body.clientUpdatedAt < current.client_updated_at: raise error(409, "stale_delete", "На сервере уже есть более новая версия")
    session.delete(current); session.commit()
    return {"status": "deleted", "id": str(workout_id)}

@app.get("/api/v1/workouts", response_model=WorkoutList, dependencies=[Depends(authorize)])
def list_workouts(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), session: Session = Depends(get_session)):
    rows = session.scalars(select(Workout).order_by(Workout.workout_date.desc()).limit(limit).offset(offset)).all()
    return WorkoutList(items=[WorkoutSummary(id=row.id, date=row.workout_date, type=row.workout_type, status=row.status, clientUpdatedAt=row.client_updated_at, serverUpdatedAt=row.server_updated_at) for row in rows], limit=limit, offset=offset)

@app.get("/api/v1/workouts/{workout_id}", dependencies=[Depends(authorize)])
def get_workout(workout_id: uuid.UUID, session: Session = Depends(get_session)):
    row = session.get(Workout, workout_id)
    if not row: raise error(404, "not_found", "Тренировка не найдена")
    return row.payload
