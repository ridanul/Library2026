# KiU Library Manager

Full stack: HTML/JS/Tailwind frontend backed by a FastAPI API with SQLite/Postgres storage, JWT auth, email verification, and student/admin roles.

## Features

- **Auth** — register/login with bcrypt-hashed passwords, JWT bearer tokens, and **email verification (OTP)** via Brevo API or SMTP.
- **Admin approval flow** — new student accounts are `pending` until an admin approves them. Admin accounts can only be assigned by existing admins.
- **Books** — search by title/author/ISBN, filter by genre, add/edit/delete (admin only), borrow/return with live copy counts.
- **Recommendations** — pulled from each student's saved genre interests.
- **Notifications** — when an admin adds a book, every student who has that genre in their interests automatically gets a "new arrival" notification. Admins can also send manual notifications to individual users or all students.
- **Interests** — students can save/update the genres they follow, which drives both recommendations and notifications.
- **Fines** — admins can charge fines for overdue loans, view all fines, and students can view/pay their fines.
- **Admin settings** — configurable fine-per-day, grace period, and default late-return fine.
- **User management** — admins can approve pending users, promote students to admins, and demote admins back to students (with last-admin protection).

## Project Structure

```
library-app/
  Backend/           FastAPI API
    app/             Application code (main, auth, models, schemas, seed)
    .env.example     Email + JWT configuration template
  frontend/          Frontend files
    css/             Frontend styles
    js/              Frontend JavaScript (config, api, auth, dashboard)
    index.html       Landing page
    login.html       Login/Register with OTP verification
    dashboard.html   Main application dashboard
  Procfile           Heroku deployment
  runtime.txt        Python runtime version
  requirements.txt   Python dependencies
```

## Run it Locally

### Prerequisites
- Python 3.10+
- (Optional) A Brevo API key or SMTP credentials for email verification

### Setup

```bash
# 1. Clone and enter the project
git clone https://github.com/ridanul/Library2026.git
cd Library2026

# 2. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment variables
cp Backend/.env.example Backend/.env
# Edit Backend/.env and add your Brevo API key or SMTP credentials

# 5. Run the server
cd Backend
uvicorn app.main:app --reload
```

Open **http://localhost:8000** — the backend automatically serves the frontend from `frontend/`. The API lives under `http://localhost:8000/api/...`, and interactive docs are at **http://localhost:8000/docs**.

### Demo Accounts

First run creates `Backend/library.db` (SQLite) and seeds it with two demo accounts and a handful of books:

- Student — `student@demo.io` / `student123`
- Admin — `admin@demo.io` / `admin123`

> **Note:** If email verification is not configured, you may need to manually verify the seeded accounts in the database or use the API docs to log in.

Delete `library.db` any time to reset to the seed data.

### Running Frontend and Backend Separately

If you'd rather serve the frontend from somewhere else (e.g. `file://` or a different dev server), that works too — CORS is wide open. Just point `frontend/js/config.js` → `API_BASE` at wherever the backend ends up (e.g. `http://localhost:8000/api`).

## Email Verification

Email verification is handled via a 6-digit OTP sent to the user's email address. Two providers are supported (configured in `Backend/.env`):

1. **Brevo API** (recommended) — set `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME`.
2. **SMTP** — set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.

If email is not configured, the OTP will be printed to the server console for development.

## API Reference

All endpoints are prefixed with `/api`. Authentication is via `Authorization: Bearer <token>`.

### Auth

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/register` | Register a new student account | Public |
| POST | `/auth/verify` | Verify email with OTP code | Public |
| POST | `/auth/resend-verification` | Resend OTP verification email | Public |
| POST | `/auth/login` | Login and get JWT token | Public |
| GET | `/auth/me` | Get current user info | Yes |

### Books

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/books?search=&genre=&page=` | List books with optional filters | Yes |
| GET | `/books/{id}` | Get a single book | Yes |
| POST | `/books` | Add a new book | Admin |
| PUT | `/books/{id}` | Update a book | Admin |
| DELETE | `/books/{id}` | Delete a book | Admin |
| POST | `/books/{id}/borrow` | Borrow a book | Yes |
| POST | `/books/{id}/return` | Return a book | Yes |

### Recommendations & Interests

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/recommendations` | Get book recommendations based on interests | Yes |
| GET | `/users/interests` | Get current user's genre interests | Yes |
| POST | `/users/interests` | Save genre interests | Yes |

### Notifications

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/notifications` | List current user's notifications | Yes |
| POST | `/notifications/{id}/read` | Mark a notification as read | Yes |

### Fines

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/fines` | List current user's fines | Yes |
| POST | `/fines/{id}/pay` | Mark a fine as paid | Yes |

### Admin

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/admin/users/pending` | List pending student accounts | Admin |
| GET | `/admin/users` | List all users | Admin |
| POST | `/admin/users/{id}/approve` | Approve a pending student | Admin |
| POST | `/admin/users/{id}/promote` | Promote a student to admin | Admin |
| POST | `/admin/users/{id}/demote` | Demote an admin to student | Admin |
| GET | `/admin/overdue` | List overdue loans with fines | Admin |
| GET | `/admin/settings` | Get library settings | Admin |
| PUT | `/admin/settings` | Update library settings | Admin |
| POST | `/admin/users/{id}/fine` | Charge a fine to a user | Admin |
| POST | `/admin/users/{id}/fines` | Alias for charging a fine | Admin |
| GET | `/admin/fines` | List all fines | Admin |
| POST | `/admin/notifications` | Send a notification to users | Admin |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

## Deployment

This project is configured for deployment on **Heroku** (see `Procfile` and `runtime.txt`).

```bash
# Deploy to Heroku
heroku create your-app-name
git push heroku main
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SECRET_KEY` | JWT signing secret | Yes (production) |
| `DATABASE_URL` | Database connection string (defaults to SQLite) | No |
| `BREVO_API_KEY` | Brevo API key for email | No* |
| `BREVO_SENDER_EMAIL` | Verified sender email | No* |
| `BREVO_SENDER_NAME` | Sender name | No |
| `SMTP_HOST` | SMTP server host | No* |
| `SMTP_PORT` | SMTP server port | No |
| `SMTP_USER` | SMTP username | No |
| `SMTP_PASS` | SMTP password | No |
| `SMTP_FROM` | From email address | No |
| `FRONTEND_DIR` | Path to frontend files (defaults to `frontend/`) | No |

\* At least one email provider (Brevo API or SMTP) is required for email verification.

## Design Notes

Visual language borrows from library card catalogs and due-date ink stamps: navy/parchment/brass palette, a serif display face (Fraunces) for headings, and monospaced call-number/date labels (IBM Plex Mono) throughout. The recurring "stamp" badge (rotated, dashed border) marks availability status and interest tags — the one signature element the rest of the UI stays quiet around.