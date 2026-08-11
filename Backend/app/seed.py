from datetime import date
from sqlalchemy.orm import Session

from . import models
from .auth import hash_password

DEMO_BOOKS = [
    dict(title="The Left Hand of Darkness", author="Ursula K. Le Guin", isbn="9780441478125",
         genre="Sci-Fi", call_number="SF 823.9 LEG", copies=3, available=2,
         description="An envoy navigates a wintry planet where inhabitants have no fixed gender.",
         added_at=date(2026, 7, 28)),
    dict(title="Gone Girl", author="Gillian Flynn", isbn="9780307588364",
         genre="Mystery", call_number="MY 813.6 FLY", copies=2, available=0,
         description="A marriage unravels into a media circus and a hunt for the truth.",
         added_at=date(2026, 7, 30)),
    dict(title="Sapiens", author="Yuval Noah Harari", isbn="9780062316097",
         genre="Non-Fiction", call_number="NF 909 HAR", copies=4, available=4,
         description="A sweeping account of how Homo sapiens came to dominate the planet.",
         added_at=date(2026, 6, 14)),
    dict(title="Piranesi", author="Susanna Clarke", isbn="9781635575637",
         genre="Fantasy", call_number="FA 823.92 CLA", copies=2, available=1,
         description="A man lives inside an endless, statue-filled House he cannot leave.",
         added_at=date(2026, 8, 2)),
    dict(title="Project Hail Mary", author="Andy Weir", isbn="9780593135204",
         genre="Sci-Fi", call_number="SF 813.6 WEI", copies=3, available=3,
         description="A lone astronaut wakes with no memory and humanity's survival at stake.",
         added_at=date(2026, 8, 5)),
    dict(title="In Cold Blood", author="Truman Capote", isbn="9780679745587",
         genre="Mystery", call_number="MY 364.15 CAP", copies=2, available=2,
         description="A meticulous account of a real 1959 Kansas murder and its aftermath.",
         added_at=date(2026, 5, 20)),
]


def run(db: Session):
    if db.query(models.User).count() > 0:
        return  # already seeded

    student = models.User(
        name="Priya Nair", email="student@demo.io",
        hashed_password=hash_password("student123"),
        role="student", genres="Sci-Fi,Mystery",
    )
    admin = models.User(
        name="Marcus Webb", email="admin@demo.io",
        hashed_password=hash_password("admin123"),
        role="admin", genres="",
    )
    db.add_all([student, admin])
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
