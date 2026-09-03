from datetime import date
from typing import Optional, List
from pathlib import Path

import os
import re
import uuid

from fastapi import FastAPI, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from appwrite.client import Client
from appwrite.services.storage import Storage
from appwrite.input_file import InputFile
from appwrite.permission import Permission
from appwrite.role import Role
from .Module.AppwriteModule import storage as appwrite_storage
from . import models, schemas, seed
from .email_utils import send_verification_email
from .database import Base, engine, ensure_schema, get_db
from .auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin,
)

Base.metadata.create_all(bind=engine)

APPWRITE_BUCKET_ID = os.getenv("APPWRITE_BUCKET_ID", "")

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
        department=getattr(u, "department", "") or "",
        session=getattr(u, "session", "") or "",
        student_id=getattr(u, "student_id", "") or "",
        card_number=getattr(u, "card_number", "") or "",
        card_valid_until=getattr(u, "card_expires_on", None),
        genres=u.genre_list(),
        admin_role=getattr(u, "admin_role", "") or "",
    )


def book_out(b: models.Book) -> schemas.BookOut:
    return schemas.BookOut(
        id=b.id, title=b.title, author=b.author, isbn=b.isbn, genre=b.genre,
        call_number=b.call_number or "", copies=b.copies, available=b.available,
        description=b.description or "", cover_url=b.cover_url or "", added_at=b.added_at,
        department=getattr(b, "department", "") or "",
        session=getattr(b, "session", "") or "",
        category=getattr(b, "category", "") or "non-academic",
    )


def _distinct_values(db: Session, column) -> List[str]:
    """Sorted non-empty DISTINCT values for a column across the whole table."""
    rows = db.query(column).distinct().all()
    return sorted({row[0].strip() for row in rows if row[0] and row[0].strip()})


def create_and_send_otp(db: Session, user: models.User) -> str:
    """Create a fresh EmailVerification row and best-effort email it. Returns the code."""
    from datetime import datetime, timedelta
    code = f"{__import__('random').randint(100000,999999)}"
    expires = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
    ev = models.EmailVerification(user_id=user.id, code=code, expires_at=expires)
    db.add(ev)
    db.commit()
    try:
        send_verification_email(user.email, code)
    except Exception as e:
        print(f"[otp] Email verification failed for {user.email}: {e}")
    return code


def _card_expiry_from_session(session_tag: str) -> Optional[date]:
    """Card is valid for 4 years from the session's starting year (ends Jun 30).

    "2023-24" -> issued in 2023 -> valid until 2027-06-30.
    """
    m = re.match(r"\s*(\d{4})", session_tag or "")
    if not m:
        return None
    return date(int(m.group(1)) + 4, 6, 30)


def issue_card_number(db: Session, user: models.User) -> None:
    """Assign the next sequential library card number for the user's role."""
    prefix = "TCH" if user.role == "teacher" else "STU"
    count = db.query(func.count(models.User.id)).scalar() or 0
    seq = max(1, count) + 1
    while db.query(models.User).filter(
        models.User.card_number == f"{prefix}-{seq:04d}",
        models.User.id != user.id,
    ).first() is not None:
        seq += 1
    user.card_number = f"{prefix}-{seq:04d}"
    user.card_expires_on = _card_expiry_from_session(user.session)


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
    existing = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing:
        # Account exists but the email was never verified — resume the OTP flow
        # instead of blocking re-registration. Applies to students and teachers
        # alike (both self-register and need email verification).
        if not getattr(existing, "email_verified", False) and existing.role in ("student", "teacher"):
            create_and_send_otp(db, existing)
            return {"accountExistsUnverified": True}
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    # Force student/teacher role - admin accounts can only be assigned by existing admins
    if payload.role not in ("student", "teacher"):
        raise HTTPException(status_code=403, detail="Admin accounts can only be assigned by existing administrators.")
    user = models.User(
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,  # student or teacher; never admin
        status="pending",  # Registrants stay pending until an admin approves them
        genres="",
        department=payload.department or "",
        session=payload.session or "",
        student_id=payload.student_id or "",
        admin_role="",  # only meaningful for admin accounts
    )
    db.add(user)
    db.flush()  # assign the id before we reference it below
    # Auto-issue a library card: sequential number prefixed by role, valid
    # for 4 years from the session's starting year.
    issue_card_number(db, user)
    db.commit()
    db.refresh(user)
    create_and_send_otp(db, user)
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
    # Both students and teachers need admin approval before they can log in;
    # only admin accounts (created via promotion, never self-registered) skip it.
    return {"status": "ok", "pendingApproval": user.role != "admin" and user.status == "pending"}


@app.post("/api/auth/resend-verification")
def resend_verification(payload: schemas.ResendVerifyIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if getattr(user, "email_verified", False):
        raise HTTPException(status_code=400, detail="Email is already verified.")
    create_and_send_otp(db, user)
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=schemas.TokenOut)
def login(payload: schemas.LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    if not getattr(user, 'email_verified', False):
        raise HTTPException(status_code=403, detail="Email not verified. Please verify your email before signing in.")
    if user.role != "admin" and getattr(user, 'status', 'approved') != "approved":
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")
    token = create_access_token(user.id)
    return schemas.TokenOut(token=token, user=user_out(user))


@app.get("/api/auth/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return user_out(current_user)


@app.put("/api/users/me", response_model=schemas.UserOut)
def update_profile(
    payload: schemas.ProfileUpdateIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Self-service profile update: name, academic info and optional password change."""
    data = payload.dict(exclude_unset=True, exclude_none=True)
    if "name" in data and not data["name"]:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")
    if data.get("password"):
        current_user.hashed_password = hash_password(data["password"])
    # Admins are administrative staff — they never carry an academic session or
    # student ID, so ignore any values for those fields on admin accounts.
    if current_user.role == "admin":
        data["session"] = ""
        data["student_id"] = ""
    for field in ("name", "department", "session", "student_id"):
        if field in data:
            setattr(current_user, field, data[field])
    # Only admins may set their own library role (e.g. librarian). Non-admins hold
    # no admin_role, so this field is ignored for them.
    if current_user.role == "admin" and "admin_role" in data:
        current_user.admin_role = data["admin_role"] or ""
    db.commit()
    db.refresh(current_user)
    return user_out(current_user)


# ===========================================================================
# Admin approval flow
# ===========================================================================
@app.get("/api/admin/users/pending")
def list_pending_users(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    users = (
        db.query(models.User)
        .filter(models.User.role.in_(["student", "teacher"]), models.User.status == "pending")
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
    if user.role not in ("student", "teacher"):
        raise HTTPException(status_code=400, detail="Only student or teacher accounts can be approved.")
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
    # Admins are administrative staff, not students/teachers — they carry no
    # academic session, student ID, or student-style library card. Clear any
    # leftover values from their previous role.
    user.session = ""
    user.student_id = ""
    user.card_number = ""
    user.card_expires_on = None
    # Assign a default library role when promoting to admin; can be edited in
    # the admin's profile afterwards.
    if not getattr(user, "admin_role", ""):
        user.admin_role = "librarian"
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
    user.admin_role = ""
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

    # One shared group id ties together every copy of this broadcast so the
    # admin can edit or delete the whole notification at once.
    broadcast_id = f"nb_{uuid.uuid4().hex[:10]}"
    for recipient in recipients:
        db.add(models.Notification(
            user_id=recipient.id,
            title=title,
            body=body,
            read=False,
            created_at=date.today(),
            broadcast_id=broadcast_id,
        ))
    db.commit()
    return {"status": "ok", "count": len(recipients), "id": broadcast_id}


@app.get("/api/admin/notifications")
def list_admin_notifications(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """Every admin-created notification (broadcasts), one entry per broadcast group."""
    rows = (
        db.query(models.Notification)
        .filter(models.Notification.broadcast_id != "", models.Notification.broadcast_id.isnot(None))
        .all()
    )
    groups: dict = {}
    for n in rows:
        groups.setdefault(n.broadcast_id, []).append(n)
    items = []
    for gid, members in groups.items():
        first = members[0]
        items.append({
            "id": gid,
            "title": first.title,
            "body": first.body,
            "created_at": first.created_at,
            "recipients": len(members),
            "unread": sum(1 for m in members if not m.read),
        })
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return {"items": items}


@app.put("/api/admin/notifications/{group_id}")
def update_admin_notification(
    group_id: str,
    payload: schemas.AdminNotificationUpdateIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Edit the title/body of every copy belonging to a broadcast group."""
    title = payload.title.strip()
    body = payload.body.strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Title and body are required.")
    members = db.query(models.Notification).filter(models.Notification.broadcast_id == group_id).all()
    if not members:
        raise HTTPException(status_code=404, detail="Notification not found.")
    for m in members:
        m.title = title
        m.body = body
    db.commit()
    return {"status": "ok", "count": len(members)}


@app.delete("/api/admin/notifications/{group_id}")
def delete_admin_notification(
    group_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Delete every copy belonging to a broadcast group."""
    members = db.query(models.Notification).filter(models.Notification.broadcast_id == group_id).all()
    if not members:
        raise HTTPException(status_code=404, detail="Notification not found.")
    for m in members:
        db.delete(m)
    db.commit()
    return {"status": "ok", "deleted": len(members)}


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
@app.get(
    "/api/books",
    response_model=schemas.BookListOut,
)
def list_books(
    search: Optional[str] = Query(default=""),
    author: Optional[str] = Query(default=""),
    genre: Optional[str] = Query(default=""),
    department: Optional[str] = Query(default=""),
    session: Optional[str] = Query(default=""),
    category: Optional[str] = Query(default=""),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Book)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(models.Book.title.ilike(like), models.Book.author.ilike(like), models.Book.isbn.ilike(like)))
    if author:
        q = q.filter(models.Book.author == author)    
    if genre:
        q = q.filter(models.Book.genre == genre)
    if department:
        q = q.filter(models.Book.department == department)
    if session:
        q = q.filter(models.Book.session == session)
    if category:
        q = q.filter(models.Book.category == category)
    total = q.count()
    items = q.order_by(models.Book.added_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    # Facets are computed over the whole table (ignoring the active filters)
    # so dropdown options stay stable while filtering.
    return schemas.BookListOut(
        items=[book_out(b) for b in items],
        total=total,
        authors=_distinct_values(db, models.Book.author),
        departments=_distinct_values(db, models.Book.department),
        sessions=_distinct_values(db, models.Book.session),
        genres=_distinct_values(db, models.Book.genre),
        categories=_distinct_values(db, models.Book.category),
    )


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
        department=payload.department or "", session=payload.session or "",
        category=payload.category or "non-academic",
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
    # Admins manage the library -- they cannot borrow books themselves.
    if current_user.role == "admin":
        raise HTTPException(status_code=403, detail="Admin accounts cannot borrow books.")
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
# Admin: marked return + review moderation / manual reviews
# ===========================================================================
@app.post("/api/admin/borrows/{borrow_id}/return")
def admin_mark_return(
    borrow_id: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Mark an active loan as returned from the dashboard."""
    br = db.query(models.Borrow).filter(models.Borrow.id == borrow_id).first()
    if not br:
        raise HTTPException(status_code=404, detail="Borrow record not found.")
    if br.returned_at is not None:
        raise HTTPException(status_code=400, detail="That loan is already returned.")
    br.returned_at = date.today()
    book = db.query(models.Book).filter(models.Book.id == br.book_id).first()
    available_after = min(book.copies, book.available + 1) if book else None
    if book:
        book.available = available_after
    db.commit()
    return {"status": "ok", "borrow_id": br.id, "returned_at": date.today(), "available": available_after}


def _review_out(r: models.Review) -> schemas.ReviewOut:
    return schemas.ReviewOut(
        id=r.id,
        book_id=r.book_id,
        reviewer_name=r.reviewer_name or (r.user.name if r.user else "Member"),
        rating=r.rating,
        comment=r.comment or "",
        status=r.status,
        created_at=r.created_at,
    )


@app.get("/api/books/{book_id}/reviews", response_model=schemas.ReviewListOut)
def list_book_reviews(
    book_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Approved reviews for a book; also reports whether the caller may write one
    (only members who borrowed the book — admins cannot borrow, hence never can)."""
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    items = (
        db.query(models.Review)
        .filter(models.Review.book_id == book.id, models.Review.status == "approved")
        .order_by(models.Review.created_at.desc())
        .all()
    )
    has_borrowed = (
        current_user.role != "admin"
        and db.query(models.Borrow)
        .filter(models.Borrow.user_id == current_user.id, models.Borrow.book_id == book.id)
        .first()
        is not None
    )
    return schemas.ReviewListOut(items=[_review_out(r) for r in items], can_review=has_borrowed)


@app.post("/api/books/{book_id}/reviews", response_model=schemas.ReviewOut, status_code=status.HTTP_201_CREATED)
def create_book_review(
    book_id: str,
    payload: schemas.ReviewIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Students/teachers who borrowed this book may submit a review.
    Submissions land in the pending queue for admin moderation."""
    if current_user.role == "admin":
        raise HTTPException(status_code=403, detail="Admins manage reviews instead of writing them.")
    book = db.query(models.Book).filter(models.Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    has_borrowed = (
        db.query(models.Borrow)
        .filter(models.Borrow.user_id == current_user.id, models.Borrow.book_id == book.id)
        .first()
    )
    if not has_borrowed:
        raise HTTPException(status_code=403, detail="Only members who have borrowed this book can review it.")
    review = models.Review(
        book_id=book.id,
        user_id=current_user.id,
        reviewer_name=current_user.name,
        rating=payload.rating,
        comment=payload.comment.strip(),
        status="pending",
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return _review_out(review)


@app.get("/api/admin/reviews/pending")
def list_pending_reviews(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    rows = (
        db.query(models.Review)
        .filter(models.Review.status == "pending")
        .order_by(models.Review.created_at.desc())
        .all()
    )
    out = []
    for r in rows:
        item = _review_out(r).dict()
        item["bookTitle"] = r.book.title if r.book else ""
        out.append(item)
    return {"items": out}


def _moderate_review(review_id: str, new_status: str, db: Session):
    review = db.query(models.Review).filter(models.Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found.")
    review.status = new_status
    db.commit()
    db.refresh(review)
    return _review_out(review)


@app.post("/api/admin/reviews/{review_id}/approve", response_model=schemas.ReviewOut)
def approve_review(review_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return _moderate_review(review_id, "approved", db)


@app.post("/api/admin/reviews/{review_id}/reject", response_model=schemas.ReviewOut)
def reject_review(review_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return _moderate_review(review_id, "rejected", db)


@app.post("/api/admin/reviews", response_model=schemas.ReviewOut, status_code=status.HTTP_201_CREATED)
def add_review_manually(
    payload: schemas.AdminReviewIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Admin-authored review; published immediately."""
    book = db.query(models.Book).filter(models.Book.id == payload.book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    review = models.Review(
        book_id=book.id,
        user_id=admin.id,
        reviewer_name=f"{admin.name} (Librarian)",
        rating=payload.rating,
        comment=payload.comment.strip(),
        status="approved",
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return _review_out(review)


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
# Cover image upload (admin). Accepts real JPEGs only, <=5MB.
# ===========================================================================
MAX_COVER_BYTES = 5 * 1024 * 1024  # 5MB


# ===========================================================================
# Cover image upload (admin). Accepts real JPEGs only, <=5MB.
# ===========================================================================
MAX_COVER_BYTES = 5 * 1024 * 1024  # 5MB


@app.post("/api/uploads/cover")
async def upload_cover(
    file: UploadFile = File(...),
    admin: models.User = Depends(require_admin)
):
    """Upload a JPEG book cover to Appwrite Storage."""

    content_type = (file.content_type or "").lower()
    filename = (file.filename or "").lower()

    # if (
    #     content_type not in ("image/jpeg", "image/jpg")
    #     and not filename.endswith((".jpg", ".jpeg"))
    # ):
    #     raise HTTPException(
    #         status_code=400,
    #         detail="Only JPG/JPEG images are accepted."
    #     )

    data = await file.read(MAX_COVER_BYTES + 1)

    if len(data) > MAX_COVER_BYTES:
        raise HTTPException(
            status_code=400,
            detail="Cover image must be 5MB or smaller."
        )

    if not data:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty."
        )

    # # Verify JPEG magic bytes.
    # if not data.startswith(b"\xff\xd8\xff"):
    #     raise HTTPException(
    #         status_code=400,
    #         detail="That file is not a valid JPEG image."
    #     )

    # Generate unique Appwrite file ID.
    file_id = uuid.uuid4().hex

    try:
        result = appwrite_storage.create_file(
            bucket_id=APPWRITE_BUCKET_ID,
            file_id=file_id,
            file=InputFile.from_bytes(
                data,
                filename=f"{file_id}.jpg"
            ),
            permissions=[
                Permission.read(Role.any())
            ]
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload cover: {str(e)}"
        )

    uploaded_id = getattr(result, "id", None) or result.get("$id") or result.get("id")
    if not uploaded_id:
        raise HTTPException(status_code=500, detail="Appwrite upload succeeded but returned no file ID.")

    # Public Appwrite file-view URL
    url = (
        f"{os.getenv('APPWRITE_ENDPOINT', 'https://cloud.appwrite.io/v1')}"
        f"/storage/buckets/{APPWRITE_BUCKET_ID}"
        f"/files/{uploaded_id}/view"
        f"?project={os.environ['APPWRITE_PROJECT_ID']}"
    )

    return {
        "file_id": uploaded_id,
        "url": url
    }


# ===========================================================================
# Optionally serve static frontend assets/pages from the same process.
# By default this points at the dedicated "frontend/" folder in repo root.
# ===========================================================================
_repo_root = Path(__file__).resolve().parents[2]
_frontend_dir = Path(os.getenv("FRONTEND_DIR", str(_repo_root / "frontend"))).resolve()


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


@app.get("/kiu_logo.png")
def frontend_favicon():
    return _serve_frontend_page("kiu_logo.png")
