import re

from datetime import date
from typing import Optional, List, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


# ---------- Password policy ----------
# Shared rules for every newly-created password:
#   * at least PASSWORD_MIN_LENGTH characters
#   * at least one uppercase letter
#   * at least one lowercase letter
#   * at least one special character (any non-alphanumeric)
PASSWORD_MIN_LENGTH = 6

_PASSWORD_RULES = (
    (r"[A-Z]", "at least one uppercase letter"),
    (r"[a-z]", "at least one lowercase letter"),
    (r"[^A-Za-z0-9]", "at least one special character (e.g. !@#$%^&*)"),
)


def validate_password_strength(value: str) -> str:
    """Raise ValueError unless the password satisfies the shared policy."""
    if len(value or "") < PASSWORD_MIN_LENGTH:
        raise ValueError(
            f"Password must be at least {PASSWORD_MIN_LENGTH} characters long."
        )
    for pattern, requirement in _PASSWORD_RULES:
        if not re.search(pattern, value):
            raise ValueError(f"Password must contain {requirement}.")
    return value


# ---------- Auth ----------
DEPARTMENTS = [
    "CSE", "EEE", "CE", "ME", "BBA", "Economics",
    "English", "Law", "Arts & Humanities", "Pharmacy",
]

SESSIONS = [
    "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26",
]


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: Literal["student", "teacher"] = "student"  # admins cannot self-register
    department: str = ""   # e.g. "CSE"
    session: str = ""      # e.g. "2023-24"
    student_id: str = ""   # e.g. "221-15-4501"

    @field_validator("department", "session", "student_id")
    @classmethod
    def strip_optional(cls, value: str) -> str:
        return _clean(value)

    @field_validator("student_id")
    @classmethod
    def digitize_student_id(cls, value: str) -> str:
        # Keep only digits — no hyphens, spaces or letters.
        return re.sub(r"\D", "", value or "")

    @model_validator(mode="after")
    def check_student_id(self):
        if self.role == "student" and len(self.student_id) != 12:
            raise ValueError("Student ID must be exactly 12 digits (no hyphens or spaces).")
        return self

    @model_validator(mode="after")
    def clear_teacher_fields(self):
        """Teachers don't have a session or student ID — blank them so they
        can never be persisted for non-student roles."""
        if self.role == "teacher":
            self.session = ""
            self.student_id = ""
        return self

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, value: str) -> str:
        return validate_password_strength(value)


class ProfileUpdateIn(BaseModel):
    """Self-service profile edit. `password` is optional and validated only when set."""
    name: Optional[str] = None
    password: Optional[str] = None
    department: Optional[str] = None
    session: Optional[str] = None
    student_id: Optional[str] = None
    admin_role: Optional[str] = None  # library role (admins only), e.g. "librarian"

    @field_validator("name", "department", "session", "student_id", "admin_role")
    @classmethod
    def strip_optional(cls, value: Optional[str]) -> Optional[str]:
        return _clean(value) if value is not None else None

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, value: Optional[str]) -> Optional[str]:
        if value:
            validate_password_strength(value)
        return value

    # NOTE: session/student_id are cleared for admins in the update_profile
    # endpoint (main.py), which has access to the current user's role.


class VerifyIn(BaseModel):
    email: EmailStr
    code: str


class ResendVerifyIn(BaseModel):
    email: EmailStr


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    status: str = "approved"
    department: str = ""
    session: str = ""
    student_id: str = ""
    card_number: str = ""
    card_valid_until: Optional[date] = None
    genres: List[str] = []
    admin_role: str = ""  # library role for admins, e.g. "librarian", "cataloger"

    class Config:
        from_attributes = True


class TokenOut(BaseModel):
    token: str
    user: UserOut


# ---------- Books ----------
class BookIn(BaseModel):
    title: str
    author: str
    isbn: str
    genre: str
    call_number: Optional[str] = ""
    copies: int = Field(default=1, ge=1)
    description: Optional[str] = ""
    cover_url: Optional[str] = ""
    department: Optional[str] = ""
    session: Optional[str] = ""
    category: Optional[Literal["academic", "non-academic"]] = "non-academic"


class BookUpdateIn(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    isbn: Optional[str] = None
    genre: Optional[str] = None
    call_number: Optional[str] = None
    copies: Optional[int] = Field(default=None, ge=0)
    description: Optional[str] = None
    cover_url: Optional[str] = None
    department: Optional[str] = None
    session: Optional[str] = None
    category: Optional[Literal["academic", "non-academic"]] = None


class BookOut(BaseModel):
    id: str
    title: str
    author: str
    isbn: str
    genre: str
    call_number: str
    copies: int
    available: int
    description: str
    cover_url: str
    added_at: date
    department: str = ""
    session: str = ""
    category: str = "non-academic"

    class Config:
        from_attributes = True


class BookListOut(BaseModel):
    items: List[BookOut]
    total: int
    authors: list[str]
    departments: List[str] = []
    sessions: List[str] = []
    genres: List[str] = []
    categories: List[str] = []


# ---------- Reviews ----------
class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=1000)


class AdminReviewIn(BaseModel):
    """Manual review creation by an admin."""
    book_id: str
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=1000)


class ReviewOut(BaseModel):
    id: str
    book_id: str
    reviewer_name: str
    rating: int
    comment: str
    status: str
    created_at: date

    class Config:
        from_attributes = True


class ReviewListOut(BaseModel):
    items: List[ReviewOut]
    can_review: bool = False


# ---------- Interests ----------
class InterestsIn(BaseModel):
    genres: List[str]


class InterestsOut(BaseModel):
    genres: List[str]


# ---------- Notifications ----------
class NotificationOut(BaseModel):
    id: str
    title: str
    body: str
    read: bool
    created_at: date

    class Config:
        from_attributes = True


class NotificationListOut(BaseModel):
    items: List[NotificationOut]


class AdminNotificationCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=2000)
    target: Literal["all_students", "all_users", "user"] = "all_students"
    user_id: Optional[str] = None


class AdminNotificationUpdateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=2000)


class RecommendationsOut(BaseModel):
    items: List[BookOut]


# ---------- Fines ----------
class FineOut(BaseModel):
    id: str
    user_id: str
    amount: float
    reason: str
    paid: bool
    created_at: date
    paid_at: Optional[date] = None

    class Config:
        from_attributes = True


class FineCreateIn(BaseModel):
    amount: float
    reason: Optional[str] = "Overdue fine"


class FineListOut(BaseModel):
    items: List[FineOut]
