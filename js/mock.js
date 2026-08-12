// ---------------------------------------------------------------------------
// Mock backend. Simulates the FastAPI contract in-browser using localStorage,
// so this frontend can be explored before the real API exists. Swap this out
// with nothing — Api.js only calls into here when a real request fails.
// ---------------------------------------------------------------------------
const Mock = (() => {
  const DB_KEY = "lib_mock_db_v1";

  function seed() {
    return {
      users: [
        { id: "u1", name: "Priya Nair", email: "student@demo.io", password: "student123", role: "student", status: "approved", email_verified: true, genres: ["Sci-Fi", "Mystery"] },
        { id: "u2", name: "Marcus Webb", email: "admin@demo.io", password: "admin123", role: "admin", status: "approved", email_verified: true, genres: [] },
      ],
      books: [
        { id: "b1", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", isbn: "9780441478125", genre: "Sci-Fi", call_number: "SF 823.9 LEG", copies: 3, available: 2, cover_url: "", description: "A envoy navigates a wintry planet where inhabitants have no fixed gender.", added_at: "2026-07-28" },
        { id: "b2", title: "Gone Girl", author: "Gillian Flynn", isbn: "9780307588364", genre: "Mystery", call_number: "MY 813.6 FLY", copies: 2, available: 0, cover_url: "", description: "A marriage unravels into a media circus and a hunt for the truth.", added_at: "2026-07-30" },
        { id: "b3", title: "Sapiens", author: "Yuval Noah Harari", isbn: "9780062316097", genre: "Non-Fiction", call_number: "NF 909 HAR", copies: 4, available: 4, cover_url: "", description: "A sweeping account of how Homo sapiens came to dominate the planet.", added_at: "2026-06-14" },
        { id: "b4", title: "Piranesi", author: "Susanna Clarke", isbn: "9781635575637", genre: "Fantasy", call_number: "FA 823.92 CLA", copies: 2, available: 1, cover_url: "", description: "A man lives inside an endless, statue-filled House he cannot leave.", added_at: "2026-08-02" },
        { id: "b5", title: "Project Hail Mary", author: "Andy Weir", isbn: "9780593135204", genre: "Sci-Fi", call_number: "SF 813.6 WEI", copies: 3, available: 3, cover_url: "", description: "A lone astronaut wakes with no memory and humanity's survival at stake.", added_at: "2026-08-05" },
        { id: "b6", title: "In Cold Blood", author: "Truman Capote", isbn: "9780679745587", genre: "Mystery", call_number: "MY 364.15 CAP", copies: 2, available: 2, cover_url: "", description: "A meticulous account of a real 1959 Kansas murder and its aftermath.", added_at: "2026-05-20" },
      ],
      notifications: [
        { id: "n1", title: "New arrival in Sci-Fi", body: "Project Hail Mary by Andy Weir just landed on the shelf.", read: false, created_at: "2026-08-05" },
        { id: "n2", title: "New arrival in Fantasy", body: "Piranesi by Susanna Clarke is now available.", read: false, created_at: "2026-08-02" },
        { id: "n3", title: "Reminder", body: "Gone Girl is fully checked out — you're 2nd in line.", read: true, created_at: "2026-07-30" },
      ],
      loans: [
        { id: "loan1", userId: "u1", userName: "Priya Nair", bookId: "b1", bookTitle: "The Left Hand of Darkness", borrowed_at: "2026-07-28", due_date: "2026-08-01", returned: false },
      ],
      session: null, // {userId}
    };
  }

  function db() {
    let d = JSON.parse(localStorage.getItem(DB_KEY) || "null");
    if (!d) {
      d = seed();
      localStorage.setItem(DB_KEY, JSON.stringify(d));
      return d;
    }

    const changed = [];
    if (!Array.isArray(d.users)) { d.users = []; changed.push("users"); }
    if (!Array.isArray(d.books)) { d.books = []; changed.push("books"); }
    if (!Array.isArray(d.notifications)) { d.notifications = []; changed.push("notifications"); }
    if (!Array.isArray(d.loans)) { d.loans = []; changed.push("loans"); }

    d.users = d.users.map((u) => ({
      ...u,
      role: u.role || "student",
      status: u.status || (u.role === "admin" ? "approved" : "approved"),
      genres: Array.isArray(u.genres) ? u.genres : [],
    }));

    if (changed.length) {
      localStorage.setItem(DB_KEY, JSON.stringify(d));
    }
    return d;
  }
  function save(d) {
    localStorage.setItem(DB_KEY, JSON.stringify(d));
  }
  function token(userId) {
    return `demo.${userId}`;
  }
  function userFromToken() {
    const t = localStorage.getItem("lib_token") || "";
    const id = t.split(".")[1];
    return db().users.find((u) => u.id === id) || null;
  }
  function publicUser(u) {
    return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, genres: u.genres };
  }
  function delay(ms = 350) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function route(path, method, body) {
    await delay();
    const d = db();

    if (path === "/auth/register" && method === "POST") {
      if (d.users.some((u) => u.email === body.email)) {
        const e = new Error("An account with that email already exists.");
        e.status = 409;
        throw e;
      }
      const role = body.role || "student";
      const user = {
        id: `u${Date.now()}`,
        name: body.name,
        email: body.email,
        password: body.password,
        role,
        status: "approved",
        email_verified: false,
        genres: [],
      };
      d.users.push(user);
      save(d);
      return { pendingVerification: true };
    }

    if (path === "/auth/verify" && method === "POST") {
      const user = d.users.find((u) => u.email === body.email);
      if (!user) { const e = new Error("User not found"); e.status = 404; throw e; }
      user.email_verified = true;
      if (user.role === "student") {
        user.status = "pending";
      }
      save(d);
      return { status: "ok", pendingApproval: user.role === "student" };
    }

    if (path === "/auth/resend-verification" && method === "POST") {
      const user = d.users.find((u) => u.email === body.email);
      if (!user) { const e = new Error("User not found"); e.status = 404; throw e; }
      // no-op in mock
      return { status: "ok" };
    }

    if (path === "/auth/login" && method === "POST") {
      const user = d.users.find((u) => u.email === body.email && u.password === body.password);
      if (!user) {
        const e = new Error("Incorrect email or password.");
        e.status = 401;
        throw e;
      }
      if (!user.email_verified) {
        const e = new Error("Email not verified. Please verify your email before signing in.");
        e.status = 403;
        throw e;
      }
      if (user.role === "student" && user.status !== "approved") {
        const e = new Error("Your account is pending admin approval.");
        e.status = 403;
        throw e;
      }
      return { token: token(user.id), user: publicUser(user) };
    }

    if (path === "/auth/me") {
      const user = userFromToken();
      if (!user) { const e = new Error("Not authenticated"); e.status = 401; throw e; }
      return { user: publicUser(user) };
    }

    if (path === "/admin/users/pending" && method === "GET") {
      return { items: d.users.filter((u) => u.role === "student" && u.status === "pending") };
    }

    if (path.match(/^\/admin\/users\/[^/]+\/approve$/) && method === "POST") {
      const id = path.split("/")[3];
      const user = d.users.find((u) => u.id === id);
      if (!user) { const e = new Error("User not found"); e.status = 404; throw e; }
      user.status = "approved";
      save(d);
      return { user: publicUser(user) };
    }

    if (path === "/admin/overdue" && method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      return { items: d.loans.filter((loan) => !loan.returned && loan.due_date < today) };
    }

    if (path.startsWith("/books") && method === "GET") {
      const url = new URL(`http://x${path}`);
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const genre = url.searchParams.get("genre") || "";
      let results = d.books;
      if (search) {
        results = results.filter(
          (b) => b.title.toLowerCase().includes(search) || b.author.toLowerCase().includes(search) || b.isbn.includes(search)
        );
      }
      if (genre) results = results.filter((b) => b.genre === genre);
      return { items: results, total: results.length };
    }

    if (path === "/books" && method === "POST") {
      const book = {
        id: `b${Date.now()}`,
        call_number: body.call_number || "N/A",
        available: Number(body.copies || 1),
        added_at: new Date().toISOString().slice(0, 10),
        ...body,
      };
      d.books.unshift(book);
      // simulate a "new book" notification going out to interested students
      d.notifications.unshift({
        id: `n${Date.now()}`,
        title: `New arrival in ${book.genre}`,
        body: `${book.title} by ${book.author} just landed on the shelf.`,
        read: false,
        created_at: book.added_at,
      });
      save(d);
      return book;
    }

    if (path.match(/^\/books\/[^/]+$/) && method === "PUT") {
      const id = path.split("/")[2];
      const idx = d.books.findIndex((b) => b.id === id);
      if (idx === -1) { const e = new Error("Book not found"); e.status = 404; throw e; }
      d.books[idx] = { ...d.books[idx], ...body };
      save(d);
      return d.books[idx];
    }

    if (path.match(/^\/books\/[^/]+$/) && method === "DELETE") {
      const id = path.split("/")[2];
      d.books = d.books.filter((b) => b.id !== id);
      save(d);
      return null;
    }

    if (path.match(/^\/books\/[^/]+\/borrow$/) && method === "POST") {
      const id = path.split("/")[2];
      const book = d.books.find((b) => b.id === id);
      if (!book || book.available < 1) { const e = new Error("No copies available."); e.status = 400; throw e; }
      const user = userFromToken();
      if (!user) { const e = new Error("Not authenticated"); e.status = 401; throw e; }
      book.available -= 1;
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date();
      due.setDate(due.getDate() + 7);
      d.loans.push({
        id: `loan${Date.now()}`,
        userId: user.id,
        userName: user.name,
        bookId: id,
        bookTitle: book.title,
        borrowed_at: today,
        due_date: due.toISOString().slice(0, 10),
        returned: false,
      });
      save(d);
      return book;
    }

    if (path.match(/^\/books\/[^/]+\/return$/) && method === "POST") {
      const id = path.split("/")[2];
      const book = d.books.find((b) => b.id === id);
      if (book) { book.available = Math.min(book.copies, book.available + 1); }
      const loan = d.loans.find((entry) => entry.bookId === id && !entry.returned);
      if (loan) { loan.returned = true; }
      save(d);
      return book;
    }

    if (path === "/recommendations") {
      const user = userFromToken();
      const genres = user?.genres?.length ? user.genres : ["Sci-Fi"];
      const recs = d.books.filter((b) => genres.includes(b.genre)).slice(0, 6);
      return { items: recs.length ? recs : d.books.slice(0, 4) };
    }

    if (path === "/users/interests" && method === "GET") {
      const user = userFromToken();
      return { genres: user?.genres || [] };
    }
    if (path === "/users/interests" && method === "POST") {
      const user = userFromToken();
      if (user) {
        const idx = d.users.findIndex((u) => u.id === user.id);
        d.users[idx].genres = body.genres;
        save(d);
      }
      return { genres: body.genres };
    }

    if (path === "/notifications") {
      return { items: d.notifications };
    }
    if (path.match(/^\/notifications\/[^/]+\/read$/) && method === "POST") {
      const id = path.split("/")[2];
      const n = d.notifications.find((n) => n.id === id);
      if (n) { n.read = true; save(d); }
      return n;
    }

    const e = new Error(`No mock route for ${method} ${path}`);
    e.status = 404;
    throw e;
  }

  return { route };
})();
