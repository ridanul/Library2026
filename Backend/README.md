
# KiU Library Manager

Full stack: the HTML/JS/Tailwind frontend from before, now backed by a real
FastAPI API with SQLite storage, JWT auth, and student/admin roles.

```
library-app/
  backend/     FastAPI API (this is the new part)
  frontend/    the static site (unchanged, just now talks to a real API)
```

## Run it

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open **http://localhost:8000** — the backend automatically mounts the
`frontend/` folder (as long as it's next to `backend/`, which it is here) and
serves the whole site from one process. The API lives under
`http://localhost:8000/api/...`, and interactive docs are at
**http://localhost:8000/docs**.

First run creates `backend/library.db` (SQLite) and seeds it with two demo
accounts and a handful of books:

- Student — `student@demo.io` / `student123`
- Admin — `admin@demo.io` / `admin123`

Delete `library.db` any time to reset to the seed data.

### Running frontend and backend separately
If you'd rather serve the frontend from somewhere else (e.g. `file://` or a
different dev server), that works too — CORS is wide open. Just point
`frontend/js/config.js` → `API_BASE` at wherever the backend ends up
(e.g. `http://localhost:8000/api`).

## What's implemented

- **Auth** — register/login with bcrypt-hashed passwords, JWT bearer tokens,
  a `role` of `student` or `admin` set at registration (matches the frontend's
  toggle).
- **Books** — search by title/author/ISBN, filter by genre, add/edit/delete
  (admin only), borrow/return with live copy counts.
- **Recommendations** — pulled from each student's saved genre interests.
- **Notifications** — when an admin adds a book, every student who has that
  genre in their interests automatically gets a "new arrival" notification.
- **Interests** — students can save/update the genres they follow, which
  drives both recommendations and notifications.

Route-by-route detail is in `backend/app/main.py`; it implements exactly the
contract documented in `frontend/README.md`.

## Notes for going to production

- Set a real `SECRET_KEY` env var (used to sign JWTs) — the code falls back
  to a dev default otherwise.
- Swap `DATABASE_URL` (env var) from SQLite to Postgres/MySQL for anything
  beyond a demo — the SQLAlchemy models don't need to change.
- Lock down CORS `allow_origins` in `app/main.py` to your real frontend
  origin instead of `*`.
