import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase): pass

class Workout(Base):
    __tablename__ = "workouts"
    __table_args__ = (
        CheckConstraint("workout_type IN ('A','B','C','extra','custom')", name="ck_workout_type"),
        CheckConstraint("status IN ('draft','planned','active','completed')", name="ck_workout_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workout_date: Mapped[date] = mapped_column(Date, index=True)
    workout_type: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    pre: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    post: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    client_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    client_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    server_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    exercises: Mapped[list["WorkoutExercise"]] = relationship(cascade="all, delete-orphan", order_by="WorkoutExercise.position")

class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"
    __table_args__ = (UniqueConstraint("workout_id", "position", name="uq_workout_exercise_position"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workout_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workouts.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    planned_exercise_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actual_exercise_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(Text)
    plan_weight: Mapped[Decimal | None] = mapped_column(Numeric)
    plan_reps: Mapped[int | None] = mapped_column(Integer)
    plan_sets: Mapped[int] = mapped_column(Integer, default=0)
    feedback: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    sets: Mapped[list["WorkoutSet"]] = relationship(cascade="all, delete-orphan", order_by="WorkoutSet.position")

class WorkoutSet(Base):
    __tablename__ = "workout_sets"
    __table_args__ = (CheckConstraint("set_type IN ('working','warmup')", name="ck_workout_set_type"),)
    workout_exercise_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workout_exercises.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    weight: Mapped[Decimal | None] = mapped_column(Numeric)
    reps: Mapped[int | None] = mapped_column(Integer)
    set_type: Mapped[str] = mapped_column(Text)
