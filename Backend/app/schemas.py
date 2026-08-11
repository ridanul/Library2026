from datetime import date
from typing import Optional, List, Literal

from pydantic import BaseModel, EmailStr, Field


# ---------- Auth ----------
class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: Literal["student", "admin"] = "student"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
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


class RecommendationsOut(BaseModel):
    items: List[BookOut]
