# AI_README.md — machine-context file. Read this before editing the repo.

PROJECT: KiU Library Manager
TYPE: monolith, FastAPI backend serves static frontend from same process
STACK: Python3.10+/FastAPI/SQLAlchemy/SQLite(default)/JWT(HS256,jose)/bcrypt(passlib) + vanilla-JS/HTML/Tailwind(CDN)
ENTRYPOINT: `Backend/app/main.py` (uvicorn app.main:app), mounts repo-root as static frontend, API under `/api`
DEPLOY: Heroku (`Procfile`, `runtime.txt`), root `requirements.txt` mirrors `Backend/requirements.txt`
DB_FILE: `Backend/library.db` (SQLite, auto-created + auto-seeded on first run; delete to reset)
DOCS: interactive OpenAPI at `/docs` when server running

## 1. FILE MAP (non-venv, non-git)

```
Library-Management/
├── index.html            landing page
├── login.html            login/register UI + OTP verification flow
├── dashboard.html         main app UI (student+admin views, role-gated via JS)
├── favicon.ico
├── css/styles.css         navy/parchment/brass theme, Fraunces + IBM Plex Mono fonts
├── js/
│   ├── config.js          API_BASE + ENDPOINTS map (single source of truth for frontend routes)
│   ├── api.js              fetch wrapper, attaches JWT bearer token
│   ├── auth.js              login/register/OTP/session logic
│   └── dashboard.js         books/borrow/return/fines/notifications/admin UI logic
├── Procfile                Heroku: `web: uvicorn app.main:app --app-dir Backend --host 0.0.0.0 --port $PORT` (verify exact cmd in file)
├── runtime.txt              pinned python version for Heroku
├── requirements.txt          = Backend/requirements.txt (Heroku needs it at root)
├── README.md                 human-facing readme (feature list, setup, full API table)
└── Backend/
    ├── .env.example          env var template (JWT secret, email provider creds)
    ├── requirements.txt
    ├── library.db             SQLite DB (gitignored in practice; present here as sample)
    ├── README.md              older/partial backend-only readme (superseded by root README.md)
    └── app/
        ├── __init__.py
        ├── main.py    (625 lines) — ALL routes + FastAPI app + static mount + CORS(allow_origins=*)
        ├── models.py  (107 lines) — SQLAlchemy ORM: User, Book, Borrow, Notification, EmailVerification, AppSetting, Fine
        ├── schemas.py (147 lines) — Pydantic request/response models
        ├── auth.py     (68 lines) — JWT create/decode, bcrypt hash/verify, get_current_user, require_admin deps
        ├── database.py (47 lines) — SQLAlchemy engine/session/Base, get_db() dependency, DATABASE_URL env override
        ├── email_utils.py (101 lines) — OTP email sending via Brevo API or SMTP; falls back to console print if unconfigured
        └── seed.py     (76 lines) — first-run demo data (2 users + sample books)
```

## 2. DATA MODEL (SQLAlchemy, `models.py`) — exact fields

All PKs are string UUIDs: `{prefix}_{uuid4hex[:12]}` e.g. `u_a1b2c3d4e5f6`, `b_...`, `br_...`, `n_...`, `ev_...`, `f_...`

```
User            id, name, email(unique), hashed_password, role["student"|"admin"],
                status["pending"|"approved"], genres(csv string, use genre_list() to parse),
                email_verified(bool)
Book            id, title, author, isbn, genre, call_number, copies(int), available(int),
                description, cover_url, added_at(date)
Borrow          id, user_id(FK), book_id(FK), borrowed_at(date), returned_at(date|null)
                → active loan iff returned_at IS NULL
Notification    id, user_id(FK), title, body, read(bool), created_at(date)
EmailVerification id, user_id(FK), code, expires_at(str), created_at(date)  -- OTP records
AppSetting      key(PK), value(str)  -- generic k/v store: fine-per-day, grace period, default fine
Fine            id, user_id(FK), amount(str), reason, paid(bool), created_at(date), paid_at(date|null)
```

INVARIANT: `Book.available` decremented on borrow, incremented on return; never goes below 0 in normal flow — check `main.py` borrow handler before modifying.
INVARIANT: new registrations default `status="pending"`; only admins can flip to `"approved"` (see `/admin/users/{id}/approve`). Admin role cannot self-assign at registration — must be promoted by an existing admin. Last-admin cannot be demoted (protection in `main.py`).

## 3. AUTH MODEL

- Password hashing: bcrypt via passlib `CryptContext`.
- Token: JWT HS256, payload `{sub: user_id, exp}`, 7-day expiry (`ACCESS_TOKEN_EXPIRE_MINUTES = 60*24*7`).
- `SECRET_KEY` env var — falls back to hardcoded dev default `"dev-secret-change-me-in-production"` if unset. **MUST override in production.**
- Client sends `Authorization: Bearer <token>`; `oauth2_scheme` has `auto_error=False`, so missing token → manual 401 raise in `get_current_user`, not FastAPI's default.
- Two FastAPI deps gate routes: `get_current_user` (any authed user), `require_admin` (role must == "admin", else 403).
- Email verification: 6-digit OTP stored in `EmailVerification`, sent via Brevo API (preferred) or SMTP (`email_utils.py`); if neither configured, OTP is printed to server stdout (dev fallback).

## 4. API SURFACE (prefix `/api`, see `main.py` for exact impl)

```
AUTH          POST /auth/register            public   {name,email,password} -> pending student
              POST /auth/verify              public   {email,code}
              POST /auth/resend-verification public   {email}
              POST /auth/login               public   {email,password} -> {token,user}
              GET  /auth/me                   auth

BOOKS         GET    /books?search=&genre=&page=   auth
              GET    /books/{id}                    auth
              POST   /books                          admin
              PUT    /books/{id}                     admin
              DELETE /books/{id}                     admin
              POST   /books/{id}/borrow               auth
              POST   /books/{id}/return               auth

RECS/INTEREST GET  /recommendations           auth   (derived from user.genres)
              GET  /users/interests           auth
              POST /users/interests           auth   {genres:[str]}

NOTIFICATIONS GET  /notifications              auth
              POST /notifications/{id}/read    auth

FINES         GET  /fines                      auth
              POST /fines/{id}/pay             auth

ADMIN         GET  /admin/users/pending        admin
              GET  /admin/users                admin
              POST /admin/users/{id}/approve   admin
              POST /admin/users/{id}/promote   admin
              POST /admin/users/{id}/demote    admin
              GET  /admin/overdue              admin
              GET  /admin/settings             admin
              PUT  /admin/settings             admin
              POST /admin/users/{id}/fine      admin
              POST /admin/users/{id}/fines     admin  (alias of above)
              GET  /admin/fines                admin
              POST /admin/notifications        admin  {target: user_id|"all", title, body}

HEALTH        GET  /health                     public
```

Frontend route contract mirrored 1:1 in `js/config.js` `ENDPOINTS` — treat that object as the canonical client-side API map; keep in sync with `main.py` when changing routes.

## 5. RUN / DEV LOOP

```bash
cd Backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set SECRET_KEY + (BREVO_API_KEY or SMTP_*) if testing email
uvicorn app.main:app --reload
# serves frontend + API together at http://localhost:8000 ; docs at /docs
```

Demo accounts (seeded on first run, from `seed.py`):
- student@demo.io / student123
- admin@demo.io / admin123
(May need manual `email_verified=1` DB edit if email provider isn't configured.)

Reset DB: delete `Backend/library.db`, restart server (re-seeds).

## 6. ENV VARS (`Backend/.env`, see `.env.example`)

```
SECRET_KEY          JWT signing secret — REQUIRED in prod, insecure default otherwise
DATABASE_URL        SQLAlchemy URL, defaults to sqlite:///library.db; swap for Postgres in prod
BREVO_API_KEY / BREVO_SENDER_EMAIL / BREVO_SENDER_NAME     email provider option 1
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM  email provider option 2
FRONTEND_DIR        override static-file root (defaults to repo root)
```

## 7. KNOWN QUIRKS / GOTCHAS FOR AGENTS

- CORS is wide open (`allow_origins=["*"]`) in `main.py` — tighten before prod deploy.
- `Backend/README.md` is a stale earlier draft (references `backend/`/`frontend/` subfolder split that no longer exists) — **root `README.md` is authoritative**, this AI_README supersedes both for structure/API lookups.
- `js/config.js` hardcodes prod API base as `https://library.ridanul.tech/api`; `file://` protocol forces localhost fallback. `DEMO_MODE_FALLBACK` currently `false`.
- `__pycache__/*.pyc` and `Backend/venv/` are build artifacts / dependency tree, not source — ignore when reasoning about project logic.
- IDs are prefixed strings, not ints — don't assume integer PKs when writing queries or migrations.
- Genres stored as CSV string on `User.genres`, not a join table — parse via `User.genre_list()`.
- Two near-duplicate "charge fine" endpoints exist (`/admin/users/{id}/fine` and `/admin/users/{id}/fines`) — check `main.py` before assuming one is deprecated.

## 8. WHERE TO LOOK FOR X

| Task | File |
|---|---|
| Add/modify an API route | `Backend/app/main.py` |
| Change DB schema | `Backend/app/models.py` (+ handle migration manually, no Alembic present) |
| Change request/response validation | `Backend/app/schemas.py` |
| Change auth/token logic | `Backend/app/auth.py` |
| Change seed/demo data | `Backend/app/seed.py` |
| Change email templates/provider logic | `Backend/app/email_utils.py` |
| Change frontend API endpoints | `js/config.js` |
| Change frontend request logic | `js/api.js` |
| Change login/register/OTP UI logic | `js/auth.js` + `login.html` |
| Change dashboard behavior (books/fines/notifications/admin) | `js/dashboard.js` + `dashboard.html` |
| Change visual theme | `css/styles.css` |
| Change deploy config | `Procfile`, `runtime.txt`, `requirements.txt` (root) |
