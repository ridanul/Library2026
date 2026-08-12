import uuid
from datetime import date

from sqlalchemy import Column, String, Integer, Boolean, Date, ForeignKey, Text
from sqlalchemy.orm import relationship

from .database import Base


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: gen_id("u"))
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False, default="student")  # "student" | "admin"
    genres = Column(String, default="")  # comma-separated interest genres
    email_verified = Column(Boolean, default=False)

    borrows = relationship("Borrow", back_populates="user")
    notifications = relationship("Notification", back_populates="user")

    def genre_list(self):
        return [g for g in (self.genres or "").split(",") if g]


class Book(Base):
    __tablename__ = "books"

    id = Column(String, primary_key=True, default=lambda: gen_id("b"))
    title = Column(String, nullable=False)
    author = Column(String, nullable=False)
    isbn = Column(String, nullable=False)
    genre = Column(String, nullable=False, default="Unsorted")
    call_number = Column(String, default="")
    copies = Column(Integer, nullable=False, default=1)
    available = Column(Integer, nullable=False, default=1)
    description = Column(Text, default="")
    cover_url = Column(String, default="")
    added_at = Column(Date, default=date.today)

    borrows = relationship("Borrow", back_populates="book")


class Borrow(Base):
    __tablename__ = "borrows"

    id = Column(String, primary_key=True, default=lambda: gen_id("br"))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    book_id = Column(String, ForeignKey("books.id"), nullable=False)
    borrowed_at = Column(Date, default=date.today)
    returned_at = Column(Date, nullable=True)

    user = relationship("User", back_populates="borrows")
    book = relationship("Book", back_populates="borrows")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=lambda: gen_id("n"))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    body = Column(String, nullable=False)
    read = Column(Boolean, default=False)
    created_at = Column(Date, default=date.today)

    user = relationship("User", back_populates="notifications")


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(String, primary_key=True, default=lambda: gen_id("ev"))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    code = Column(String, nullable=False)
    expires_at = Column(String, nullable=False)
    created_at = Column(Date, default=date.today)

    user = relationship("User")
