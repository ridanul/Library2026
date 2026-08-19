from datetime import date
from typing import Optional, List, Literal

from pydantic import BaseModel, EmailStr, Field


# ---------- Auth ----------
class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: Literal["student"] = "student"  # Only students can self-register


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
    genres: List[str] = []

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


class BookUpdateIn(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    isbn: Optional[str] = None
    genre: Optional[str] = None
    call_number: Optional[str] = None
    copies: Optional[int] = Field(default=None, ge=0)
    description: Optional[str] = None
    cover_url: Optional[str] = None


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

    class Config:
        from_attributes = True


class BookListOut(BaseModel):
    items: List[BookOut]
    total: int


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
