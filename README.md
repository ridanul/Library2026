# Athenaeum — Library Management System (Frontend)

Plain HTML / JS / Tailwind frontend, built to sit in front of a FastAPI backend.
No build step — open it, or serve it as static files from FastAPI itself.

## Run it

**Standalone (no backend yet):** just open `login.html` in a browser. The app
auto-detects that the API is unreachable and switches to **demo mode**, using
realistic mock data stored in `localStorage`. A "Demo mode" badge appears in
the header when this happens. Demo logins:

- Student — `student@demo.io` / `student123`
- Admin — `admin@demo.io` / `admin123`

**With your FastAPI backend:**
1. Set the real API URL in `js/config.js` → `API_BASE` (default `http://localhost:8000/api`).
2. Either run FastAPI separately (enable CORS for the origin serving these files),
   or mount this folder as static files, e.g.:
   ```python
   from fastapi.staticfiles import StaticFiles
   app.mount("/", StaticFiles(directory="library-frontend", html=True), name="frontend")
   ```

## Files

```
index.html        redirect to login/dashboard based on session
login.html         sign in + register, with a Student / Admin role toggle
dashboard.html      search & browse, recommendations, notifications, admin "Manage" tab
css/styles.css       fonts + the "due-date stamp" / catalog-card visual language
js/config.js         API base URL + endpoint map — edit this to match your backend
js/api.js            fetch wrapper; falls back to js/mock.js when the API is unreachable
js/mock.js            in-browser mock backend (demo mode only)
js/auth.js            session helpers (token/user in localStorage, route guards)
js/dashboard.js       all dashboard behavior
```

## Expected FastAPI contract

All endpoints are prefixed with `API_BASE` (default `/api`). Auth uses a
bearer token returned from login/register and sent as `Authorization: Bearer <token>`.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{name, email, password, role}` | `role` is `"student"` or `"admin"` |
| POST | `/auth/login` | `{email, password}` | → `{token, user}` |
| GET | `/auth/me` | — | → `{user}` |
| GET | `/books?search=&genre=&page=` | — | → `{items, total}` |
| POST | `/books` | `{title, author, isbn, genre, call_number, copies, description}` | admin only |
| PUT | `/books/{id}` | partial book fields | admin only |
| DELETE | `/books/{id}` | — | admin only |
| POST | `/books/{id}/borrow` | — | decrements `available` |
| POST | `/books/{id}/return` | — | increments `available` |
| GET | `/recommendations` | — | → `{items}`, based on the user's saved interests |
| GET | `/users/interests` | — | → `{genres}` |
| POST | `/users/interests` | `{genres}` | drives both recommendations and new-book alerts |
| GET | `/notifications` | — | → `{items}` — e.g. "new book in a followed genre" |
| POST | `/notifications/{id}/read` | — | marks one as read |

### Suggested `Book` shape
```json
{
  "id": "b1",
  "title": "Piranesi",
  "author": "Susanna Clarke",
  "isbn": "9781635575637",
  "genre": "Fantasy",
  "call_number": "FA 823.92 CLA",
  "copies": 2,
  "available": 1,
  "description": "…",
  "added_at": "2026-08-02"
}
```

### Notification behavior
The intended flow: when an admin adds a book in a given genre, the backend
should create a notification for every student whose saved interests include
that genre (see `js/mock.js`'s `route()` for a working reference of this
exact behavior in-browser).

## Design notes
Visual language borrows from library card catalogs and due-date ink stamps:
navy/parchment/brass palette, a serif display face (Fraunces) for headings, and
monospaced call-number/date labels (IBM Plex Mono) throughout. The recurring
"stamp" badge (rotated, dashed border) marks availability status and interest
tags — the one signature element the rest of the UI stays quiet around.
