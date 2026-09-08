"""Initial Training Journal schema."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "workouts",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("workout_date", sa.Date(), nullable=False),
        sa.Column("workout_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("pre", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("post", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("client_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("client_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("server_updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("workout_type IN ('A','B','C','extra','custom')", name="ck_workout_type"),
        sa.CheckConstraint("status IN ('draft','planned','active','completed')", name="ck_workout_status"),
    )
    op.create_index("ix_workouts_workout_date", "workouts", ["workout_date"])
    op.create_table(
        "workout_exercises",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("workout_id", uuid, sa.ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("planned_exercise_id", uuid),
        sa.Column("actual_exercise_id", uuid),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("plan_weight", sa.Numeric()),
        sa.Column("plan_reps", sa.Integer()),
        sa.Column("plan_sets", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("feedback", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("notes", sa.Text()),
        sa.UniqueConstraint("workout_id", "position", name="uq_workout_exercise_position"),
    )
    op.create_table(
        "workout_sets",
        sa.Column("workout_exercise_id", uuid, sa.ForeignKey("workout_exercises.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("position", sa.Integer(), primary_key=True),
        sa.Column("weight", sa.Numeric()),
        sa.Column("reps", sa.Integer()),
        sa.Column("set_type", sa.Text(), nullable=False),
        sa.CheckConstraint("set_type IN ('working','warmup')", name="ck_workout_set_type"),
    )

def downgrade():
    op.drop_table("workout_sets")
    op.drop_table("workout_exercises")
    op.drop_index("ix_workouts_workout_date", table_name="workouts")
    op.drop_table("workouts")
