from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

class WorkoutPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: UUID
    date: date
    type: Literal["A", "B", "C", "extra", "custom"]
    status: Literal["draft", "planned", "active", "completed"]
    notes: str | None = None
    pre: dict[str, Any] = Field(default_factory=dict)
    post: dict[str, Any] = Field(default_factory=dict)
    exercises: list[dict[str, Any]] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime
    schemaVersion: int = 1

class DeletePayload(BaseModel):
    clientUpdatedAt: datetime

class WorkoutSummary(BaseModel):
    id: UUID
    date: date
    type: str
    status: str
    clientUpdatedAt: datetime
    serverUpdatedAt: datetime

class WorkoutList(BaseModel):
    items: list[WorkoutSummary]
    limit: int
    offset: int

class ErrorBody(BaseModel):
    code: str
    message: str
