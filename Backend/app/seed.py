from datetime import date
from sqlalchemy.orm import Session

from . import models
from .auth import hash_password

DEMO_BOOKS = [
    dict(title="The Left Hand of Darkness", author="Ursula K. Le Guin", isbn="9780441478125",
         genre="Sci-Fi", call_number="SF 823.9 LEG", copies=3, available=2,
         description="An envoy navigates a wintry planet where inhabitants have no fixed gender.",
         added_at=date(2026, 7, 28), department="", session="", category="non-academic"),
    dict(title="Gone Girl", author="Gillian Flynn", isbn="9780307588364",
         genre="Mystery", call_number="MY 813.6 FLY", copies=2, available=0,
         description="A marriage unravels into a media circus and a hunt for the truth.",
         added_at=date(2026, 7, 30), department="", session="", category="non-academic"),
    dict(title="Sapiens", author="Yuval Noah Harari", isbn="9780062316097",
         genre="Non-Fiction", call_number="NF 909 HAR", copies=4, available=4,
         description="A sweeping account of how Homo sapiens came to dominate the planet.",
         added_at=date(2026, 6, 14), department="BBA", session="2023-24", category="academic"),
    dict(title="Piranesi", author="Susanna Clarke", isbn="9781635575637",
         genre="Fantasy", call_number="FA 823.92 CLA", copies=2, available=1,
         description="A man lives inside an endless, statue-filled House he cannot leave.",
         added_at=date(2026, 8, 2), department="English", session="2024-25", category="non-academic"),
    dict(title="Project Hail Mary", author="Andy Weir", isbn="9780593135204",
         genre="Sci-Fi", call_number="SF 813.6 WEI", copies=3, available=3,
         description="A lone astronaut wakes with no memory and humanity's survival at stake.",
         added_at=date(2026, 8, 5), department="CSE", session="2022-23", category="academic"),
    dict(title="In Cold Blood", author="Truman Capote", isbn="9780679745587",
         genre="Mystery", call_number="MY 364.15 CAP", copies=2, available=2,
         description="A meticulous account of a real 1959 Kansas murder and its aftermath.",
         added_at=date(2026, 5, 20), department="Law", session="2021-22", category="academic"),
]


def run(db: Session):
    if db.query(models.User).count() > 0:
        return  # already seeded

    student = models.User(
        name="Priya Nair", email="student@demo.io",
        hashed_password=hash_password("student123"),
        role="student", genres="Sci-Fi,Mystery", email_verified=True,
        department="CSE", session="2023-24", student_id="211154150001",
        card_number="STU-0001", card_expires_on=date(2027, 6, 30),
    )
    teacher = models.User(
        # Teachers carry no academic session or student ID — those fields are
        # student-only, consistent with the registration form and profile editor.
        name="Daniel Roy", email="teacher@demo.io",
        hashed_password=hash_password("teacher123"),
        role="teacher", genres="", email_verified=True, status="approved",
        department="EEE", session="", student_id="",
        card_number="TCH-0002", card_expires_on=date(2028, 6, 30),
    )
    admin = models.User(
        name="Marcus Webb", email="admin@demo.io",
        hashed_password=hash_password("admin123"),
        role="admin", genres="", email_verified=True,
        department="", session="", student_id="",
        card_number="", card_expires_on=None,
        admin_role="librarian",
    )
    db.add_all([student, teacher, admin])
    db.flush()  # assign ids before we reference student.id below

    for data in DEMO_BOOKS:
        db.add(models.Book(**data))

    db.add(models.Notification(
        user_id=student.id, title="New arrival in Sci-Fi",
        body="Project Hail Mary by Andy Weir just landed on the shelf.",
        read=False, created_at=date(2026, 8, 5),
    ))
    db.add(models.Notification(
        user_id=student.id, title="New arrival in Fantasy",
        body="Piranesi by Susanna Clarke is now available.",
        read=False, created_at=date(2026, 8, 2),
    ))
    db.add(models.Notification(
        user_id=student.id, title="Reminder",
        body="Gone Girl is fully checked out — you're 2nd in line.",
        read=True, created_at=date(2026, 7, 30),
    ))

    db.commit()
    # Default app settings
    db.add(models.AppSetting(key="fine_per_day", value="0.5"))
    db.add(models.AppSetting(key="grace_days", value="14"))
    db.add(models.AppSetting(key="late_return_default_fine", value="5.0"))
    db.commit()
