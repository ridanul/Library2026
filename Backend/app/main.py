from datetime import date
from typing import Optional
from pathlib import Path

import os

from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from . import models, schemas, seed
from .email_utils import send_verification_email
from .database import Base, engine, ensure_schema, get_db
from .auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="KiU Library API", version="1.0.0")

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
    ensure_schema()
    db = next(get_db())
    seed.run(db)


def user_out(u: models.User) -> schemas.UserOut:
    return schemas.UserOut(
        id=u.id,
        name=u.name,
        email=u.email,
        role=u.role,
        status=getattr(u, "status", "approved"),
        genres=u.genre_list(),
    )


def book_out(b: models.Book) -> schemas.BookOut:
    return schemas.BookOut(
        id=b.id, title=b.title, author=b.author, isbn=b.isbn, genre=b.genre,
        call_number=b.call_number or "", copies=b.copies, available=b.available,
        description=b.description or "", cover_url=b.cover_url or "", added_at=b.added_at,
    )


def get_setting(db: Session, key: str, default: str) -> str:
    s = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    return s.value if s else default


def set_setting(db: Session, key: str, value: str):
    s = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if s:
        s.value = value
    else:
        s = models.AppSetting(key=key, value=value)
        db.add(s)
    db.commit()


# ===========================================================================
# Auth
# ===========================================================================
@app.post("/api/auth/register")
def register(payload: schemas.RegisterIn, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    # Force student role - admin accounts can only be assigned by existing admins
    if payload.role != "student":
        raise HTTPException(status_code=403, detail="Admin accounts can only be assigned by existing administrators.")
    user = models.User(
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role="student",  # Force student role
        status="pending",  # Students are pending until admin approval
        genres="",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # Create a verification code and send email
    from datetime import datetime, timedelta
    code = f"{__import__('random').randint(100000,999999)}"
    expires = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
    ev = models.EmailVerification(user_id=user.id, code=code, expires_at=expires)
    db.add(ev)
    db.commit()
    # send email (best-effort)
    try:
        send_verification_email(user.email, code)
    except Exception as e:
        print(f"[register] Email verification failed for {user.email}: {e}")
    # Email verification is required; students remain pending until an admin approves them.
    return {"pendingVerification": True, "pendingApproval": True}


@app.post("/api/auth/verify")
def verify_email(payload: schemas.VerifyIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    ev = (
        db.query(models.EmailVerification)
        .filter(models.EmailVerification.user_id == user.id, models.EmailVerification.code == payload.code)
        .order_by(models.EmailVerification.created_at.desc())
        .first()
    )
    if not ev:
        raise HTTPException(status_code=400, detail="Invalid verification code.")
    from datetime import datetime
    if datetime.utcnow().isoformat() > ev.expires_at:
        raise HTTPException(status_code=400, detail="Verification code expired.")
    user.email_verified = True
    db.delete(ev)
    db.commit()
    return {"status": "ok", "pendingApproval": user.role == "student" and user.status == "pending"}


@app.post("/api/auth/resend-verification")
def resend_verification(payload: schemas.ResendVerifyIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if getattr(user, "email_verified", False):
        raise HTTPException(status_code=400, detail="Email is already verified.")
    from datetime import datetime, timedelta
    code = f"{__import__('random').randint(100000,999999)}"
    expires = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
    ev = models.EmailVerification(user_id=user.id, code=code, expires_at=expires)
    db.add(ev)
    db.commit()
    try:
        send_verification_email(user.email, code)
    except Exception:
        pass
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=schemas.TokenOut)
def login(payload: schemas.LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    if not getattr(user, 'email_verified', False):
        raise HTTPException(status_code=403, detail="Email not verified. Please verify your email before signing in.")
    if user.role == "student" and getattr(user, 'status', 'approved') != "approved":
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")
    token = create_access_token(user.id)
    return schemas.TokenOut(token=token, user=user_out(user))


@app.get("/api/auth/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return user_out(current_user)


# ===========================================================================
# Admin approval flow
# ===========================================================================
@app.get("/api/admin/users/pending")
def list_pending_users(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    users = (
        db.query(models.User)
        .filter(models.User.role == "student", models.User.status == "pending")
        .order_by(models.User.name.asc())
        .all()
    )
    return {"items": [user_out(u) for u in users]}


@app.get("/api/admin/users")
def list_users(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    users = db.query(models.User).order_by(models.User.name.asc()).all()
    return {"items": [user_out(u) for u in users]}


@app.post("/api/admin/users/{user_id}/approve")
def approve_user(user_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.role != "student":
        raise HTTPException(status_code=400, detail="Only student accounts can be approved.")
    if not user.email_verified:
        raise HTTPException(status_code=400, detail="User must verify their email before admin approval.")
    user.status = "approved"
    db.commit()
    return {"status": "approved", "user": user_out(user)}


@app.post("/api/admin/users/{user_id}/promote")
def promote_to_admin(user_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """Promote a student to admin role (admin-only endpoint)"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="User is already an admin.")
    user.role = "admin"
    user.status = "approved"
    db.commit()
    return {"status": "ok", "user": user_out(user)}


@app.post("/api/admin/users/{user_id}/demote")
def demote_from_admin(user_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """Demote an admin to student role (admin-only endpoint) - with protection for last admin"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.role != "admin":
        raise HTTPException(status_code=400, detail="User is not an admin.")
    
    # Check if this is the last admin
    admin_count = db.query(models.User).filter(models.User.role == "admin").count()
    if admin_count <= 1:
        raise HTTPException(status_code=403, detail="Cannot remove the last admin. There must be at least one admin in the system.")
    
    user.role = "student"
    user.status = "pending"
    db.commit()
    return {"status": "ok", "user": user_out(user)}




# Admin: overdue loans + settings
@app.get("/api/admin/overdue")
def list_overdue(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    from datetime import date, timedelta
    grace_days = int(get_setting(db, "grace_days", "14"))
    fine_per_day = float(get_setting(db, "fine_per_day", "0.5"))
    items = []
    borrows = db.query(models.Borrow).filter(models.Borrow.returned_at.is_(None)).all()
    for br in borrows:
        due = br.borrowed_at + timedelta(days=grace_days)
        if date.today() > due:
            days_over = (date.today() - due).days
            fine = round(days_over * fine_per_day, 2)
            items.append({
                "id": br.id,
                "userId": br.user_id,
                "userName": br.user.name,
                "bookId": br.book_id,
                "bookTitle": br.book.title,
                "borrowed_at": br.borrowed_at,
                "due_date": due,
                "days_overdue": days_over,
                "fine": fine,
            })
    return {"items": items}


@app.get("/api/admin/settings")
def get_admin_settings(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return {
        "fine_per_day": float(get_setting(db, "fine_per_day", "0.5")),
        "grace_days": int(get_setting(db, "grace_days", "14")),
        "late_return_default_fine": float(get_setting(db, "late_return_default_fine", "5.0")),
    }


@app.put("/api/admin/settings")
def put_admin_settings(payload: dict, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if "fine_per_day" in payload:
        set_setting(db, "fine_per_day", str(float(payload["fine_per_day"])))
    if "grace_days" in payload:
        set_setting(db, "grace_days", str(int(payload["grace_days"])))
    if "late_return_default_fine" in payload:
        set_setting(db, "late_return_default_fine", str(float(payload["late_return_default_fine"])))
    return get_admin_settings(db, admin)


@app.post("/api/admin/users/{user_id}/fine")
def charge_fine(user_id: str, payload: dict, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    raw_amount = payload.get("amount")
    if raw_amount in (None, ""):
        amount = float(get_setting(db, "late_return_default_fine", "5.0"))
    else:
        try:
            amount = float(raw_amount)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid amount.")
    if amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative.")
    reason = payload.get("reason", "Overdue fine")
    from datetime import date
    # create a Fine record
    fine = models.Fine(user_id=user.id, amount=str(round(amount, 2)), reason=reason)
    db.add(fine)
    db.add(models.Notification(
        user_id=user.id,
        title=f"Fine issued: ${amount:.2f}",
        body=f"A fine of ${amount:.2f} has been applied. {reason}",
        read=False,
        created_at=date.today(),
    ))
    db.commit()
    db.refresh(fine)
    return {"status": "ok", "fine": {"id": fine.id, "amount": float(fine.amount), "reason": fine.reason}}


# Alias: plural route used by frontend/mock
@app.post("/api/admin/users/{user_id}/fines")
def create_fine_alias(user_id: str, payload: dict, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return charge_fine(user_id, payload, db, admin)


@app.post("/api/admin/notifications")
def create_admin_notification(payload: schemas.AdminNotificationCreateIn, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    title = payload.title.strip()
    body = payload.body.strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Title and body are required.")

    if payload.target == "user":
        if not payload.user_id:
            raise HTTPException(status_code=400, detail="user_id is required when target is 'user'.")
        recipients = db.query(models.User).filter(models.User.id == payload.user_id).all()
    elif payload.target == "all_users":
        recipients = db.query(models.User).all()
    else:
        recipients = db.query(models.User).filter(models.User.role == "student").all()

    if not recipients:
        raise HTTPException(status_code=404, detail="No recipients found.")

    for recipient in recipients:
        db.add(models.Notification(
            user_id=recipient.id,
            title=title,
            body=body,
            read=False,
            created_at=date.today(),
        ))
    db.commit()
    return {"status": "ok", "count": len(recipients)}


@app.get("/api/fines", response_model=schemas.FineListOut)
def list_my_fines(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    fines = db.query(models.Fine).filter(models.Fine.user_id == current_user.id).order_by(models.Fine.created_at.desc()).all()
    return schemas.FineListOut(items=fines)


@app.get("/api/admin/fines", response_model=schemas.FineListOut)
def list_all_fines(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    fines = db.query(models.Fine).order_by(models.Fine.created_at.desc()).all()
    return schemas.FineListOut(items=fines)


@app.post("/api/fines/{fine_id}/pay")
def pay_fine(fine_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    fine = db.query(models.Fine).filter(models.Fine.id == fine_id).first()
    if not fine:
        raise HTTPException(status_code=404, detail="Fine not found.")
    # only the owner or an admin can mark as paid
    if fine.user_id != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="Not authorized.")
    from datetime import date
    fine.paid = True
    fine.paid_at = date.today()
    db.add(models.Notification(
        user_id=fine.user_id,
        title=f"Fine paid: ${float(fine.amount):.2f}",
        body=f"Your fine of ${float(fine.amount):.2f} has been marked as paid.",
        read=False,
        created_at=date.today(),
    ))
    db.commit()
    return {"status": "ok"}


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
# Optionally serve static frontend assets/pages from the same process.
# By default this points at the repository root where index/login/dashboard
# plus css/js live in this project structure.
# ===========================================================================
_repo_root = Path(__file__).resolve().parents[2]
_frontend_dir = Path(os.getenv("FRONTEND_DIR", str(_repo_root))).resolve()


def _frontend_file(name: str) -> Path:
    return _frontend_dir / name


def _serve_frontend_page(name: str):
    target = _frontend_file(name)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Frontend page not found.")
    return FileResponse(target)


if _frontend_dir.is_dir():
    css_dir = _frontend_file("css")
    js_dir = _frontend_file("js")

    if css_dir.is_dir():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="frontend-css")
    if js_dir.is_dir():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="frontend-js")


@app.get("/")
def frontend_root():
    return _serve_frontend_page("index.html")


@app.get("/index.html")
def frontend_index_page():
    return _serve_frontend_page("index.html")


@app.get("/login.html")
def frontend_login_page():
    return _serve_frontend_page("login.html")


@app.get("/dashboard.html")
def frontend_dashboard_page():
    return _serve_frontend_page("dashboard.html")


@app.get("/favicon.ico")
def frontend_favicon():
    return _serve_frontend_page("favicon.ico")
