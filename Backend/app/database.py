import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./library.db")

# Heroku may expose the legacy postgres:// scheme; SQLAlchemy expects postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgres://",
        "postgresql+psycopg://",
        1
    )
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql://",
        "postgresql+psycopg://",
        1
    )

# Heroku Postgres requires SSL in production.
if os.getenv("DYNO") and DATABASE_URL.startswith("postgresql://") and "sslmode=" not in DATABASE_URL:
    sep = "&" if "?" in DATABASE_URL else "?"
    DATABASE_URL = f"{DATABASE_URL}{sep}sslmode=require"

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def _add_column_if_missing(conn, table: str, column: str, ddl_type: str):
    """Add `column` to `table` if the live schema doesn't have it yet."""
    inspector = inspect(engine)
    names = [col["name"] for col in inspector.get_columns(table)]
    if column not in names:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def ensure_schema():
    inspector = inspect(engine)
    if not inspector.has_table("users"):
        return
    with engine.begin() as conn:
        if "status" not in [c["name"] for c in inspector.get_columns("users")]:
            conn.execute(text("ALTER TABLE users ADD COLUMN status VARCHAR NOT NULL DEFAULT 'approved'"))
        # Lightweight migrations for later-added columns (SQLite & Postgres compatible).
        _add_column_if_missing(conn, "users", "department", "VARCHAR DEFAULT ''")
        _add_column_if_missing(conn, "users", "session", "VARCHAR DEFAULT ''")
        _add_column_if_missing(conn, "users", "student_id", "VARCHAR DEFAULT ''")
        _add_column_if_missing(conn, "users", "card_number", "VARCHAR DEFAULT ''")
        _add_column_if_missing(conn, "users", "card_expires_on", "DATE NULL")
        _add_column_if_missing(conn, "users", "admin_role", "VARCHAR DEFAULT ''")
        # Existing admin accounts (already seeded) should get a default library
        # role instead of an empty string.
        conn.execute(text("UPDATE users SET admin_role = 'librarian' WHERE role = 'admin' AND (admin_role IS NULL OR admin_role = '')"))
        if inspector.has_table("books"):
            _add_column_if_missing(conn, "books", "department", "VARCHAR DEFAULT ''")
            _add_column_if_missing(conn, "books", "session", "VARCHAR DEFAULT ''")
            _add_column_if_missing(conn, "books", "category", "VARCHAR DEFAULT 'non-academic'")
        if inspector.has_table("notifications"):
            _add_column_if_missing(conn, "notifications", "broadcast_id", "VARCHAR DEFAULT ''")
        # NOTE: brand-new tables (e.g. reviews) are created automatically by
        # Base.metadata.create_all() at import time -- no ALTER needed here.


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
