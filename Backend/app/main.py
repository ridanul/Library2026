from datetime import date
from typing import Optional

import os

from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import or_

from . import models, schemas, seed
from .database import Base, engine, get_db
from .auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Athenaeum Library API", version="1.0.0")

# Allow the static frontend (any origin, incl. file:// / localhost dev servers) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    db = next(get_db())
    seed.run(db)


def user_out(u: models.User) -> schemas.UserOut:
    return schemas.UserOut(id=u.id, name=u.name, email=u.email, role=u.role, genres=u.genre_list())


def book_out(b: models.Book) -> schemas.BookOut:
    return schemas.BookOut(
        id=b.id, title=b.title, author=b.author, isbn=b.isbn, genre=b.genre,
        call_number=b.call_number or "", copies=b.copies, available=b.available,
        description=b.description or "", cover_url=b.cover_url or "", added_at=b.added_at,
    )


# ===========================================================================
# Auth
# ===========================================================================
@app.post("/api/auth/register", response_model=schemas.TokenOut)
def register(payload: schemas.RegisterIn, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    user = models.User(
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        genres="",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id)
    return schemas.TokenOut(token=token, user=user_out(user))


@app.post("/api/auth/login", response_model=schemas.TokenOut)
def login(payload: schemas.LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    token = create_access_token(user.id)
    return schemas.TokenOut(token=token, user=user_out(user))


@app.get("/api/auth/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return user_out(current_user)


# ===========================================================================
# Books
# ===========================================================================
@app.get("/api/books", response_model=schemas.BookListOut)
def list_books(
    search: Optional[str] = Query(default=""),
    genre: Optional[str] = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Book)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(models.Book.title.ilike(like), models.Book.author.ilike(like), models.Book.isbn.ilike(like)))
    if genre:
        q = q.filter(models.Book.genre == genre)
    total = q.count()
    items = q.order_by(models.Book.added_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return schemas.BookListOut(items=[book_out(b) for b in items], total=total)


@app.get("/api/books/{book_id}", response_model=schemas.BookOut)
def get_book(book_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    return book_out(book)


@app.post("/api/books", response_model=schemas.BookOut, status_code=status.HTTP_201_CREATED)
def add_book(payload: schemas.BookIn, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    book = models.Book(
        title=payload.title, author=payload.author, isbn=payload.isbn, genre=payload.genre,
        call_number=payload.call_number or "", copies=payload.copies, available=payload.copies,
        description=payload.description or "", cover_url=payload.cover_url or "", added_at=date.today(),
    )
    db.add(book)
    db.flush()

    # Notify every student who has this genre in their saved interests.
    interested_students = db.query(models.User).filter(
        models.User.role == "student",
        models.User.genres.ilike(f"%{payload.genre}%"),
    ).all()
    for student in interested_students:
        if payload.genre in student.genre_list():
            db.add(models.Notification(
                user_id=student.id,
                title=f"New arrival in {payload.genre}",
                body=f"{payload.title} by {payload.author} just landed on the shelf.",
                read=False, created_at=date.today(),
            ))

    db.commit()
    db.refresh(book)
    return book_out(book)


@app.put("/api/books/{book_id}", response_model=schemas.BookOut)
def update_book(book_id: str, payload: schemas.BookUpdateIn, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    data = payload.dict(exclude_unset=True)
    copies_delta = None
    if "copies" in data:
        copies_delta = data["copies"] - book.copies
    for field, value in data.items():
        setattr(book, field, value)
    if copies_delta is not None:
        book.available = max(0, book.available + copies_delta)
    db.commit()
    db.refresh(book)
    return book_out(book)


@app.delete("/api/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    db.delete(book)
    db.commit()
    return None


@app.post("/api/books/{book_id}/borrow", response_model=schemas.BookOut)
def borrow_book(book_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.available < 1:
        raise HTTPException(status_code=400, detail="No copies available.")
    book.available -= 1
    db.add(models.Borrow(user_id=current_user.id, book_id=book.id))
    db.commit()
    db.refresh(book)
    return book_out(book)


@app.post("/api/books/{book_id}/return", response_model=schemas.BookOut)
def return_book(book_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    open_borrow = (
        db.query(models.Borrow)
        .filter(models.Borrow.book_id == book.id, models.Borrow.user_id == current_user.id, models.Borrow.returned_at.is_(None))
        .first()
    )
    if open_borrow:
        open_borrow.returned_at = date.today()
    book.available = min(book.copies, book.available + 1)
    db.commit()
    db.refresh(book)
    return book_out(book)


# ===========================================================================
# Interests & Recommendations
# ===========================================================================
@app.get("/api/users/interests", response_model=schemas.InterestsOut)
def get_interests(current_user: models.User = Depends(get_current_user)):
    return schemas.InterestsOut(genres=current_user.genre_list())


@app.post("/api/users/interests", response_model=schemas.InterestsOut)
def set_interests(payload: schemas.InterestsIn, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    current_user.genres = ",".join(payload.genres)
    db.commit()
    return schemas.InterestsOut(genres=payload.genres)


@app.get("/api/recommendations", response_model=schemas.RecommendationsOut)
def get_recommendations(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    genres = current_user.genre_list()
    if genres:
        items = db.query(models.Book).filter(models.Book.genre.in_(genres)).order_by(models.Book.added_at.desc()).limit(6).all()
    else:
        items = []
    if not items:
        items = db.query(models.Book).order_by(models.Book.added_at.desc()).limit(4).all()
    return schemas.RecommendationsOut(items=[book_out(b) for b in items])


# ===========================================================================
# Notifications
# ===========================================================================
@app.get("/api/notifications", response_model=schemas.NotificationListOut)
def list_notifications(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    items = (
        db.query(models.Notification)
        .filter(models.Notification.user_id == current_user.id)
        .order_by(models.Notification.created_at.desc())
        .all()
    )
    return schemas.NotificationListOut(items=[schemas.NotificationOut.model_validate(n) for n in items])


@app.post("/api/notifications/{notification_id}/read", response_model=schemas.NotificationOut)
def mark_notification_read(notification_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    n = db.query(models.Notification).filter(
        models.Notification.id == notification_id, models.Notification.user_id == current_user.id
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found.")
    n.read = True
    db.commit()
    db.refresh(n)
    return schemas.NotificationOut.model_validate(n)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ===========================================================================
# Optionally serve the static frontend from the same process.
# Set FRONTEND_DIR to the built frontend folder (defaults to ../frontend next
# to this backend) — if it exists, it's mounted at "/" so the whole site runs
# from a single `uvicorn app.main:app` command. API routes above still win.
# ===========================================================================
_frontend_dir = os.getenv("FRONTEND_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
if os.path.isdir(_frontend_dir):
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")
