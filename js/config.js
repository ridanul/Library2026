// ---------------------------------------------------------------------------
// Config: point this at your FastAPI server.
// If the API is unreachable, the app falls back to DEMO_MODE with mock data
// so the frontend can be reviewed/demoed on its own.
// ---------------------------------------------------------------------------
window.LIB_CONFIG = {
  API_BASE: "https://api.has-ib.dev/api",
  DEMO_MODE_FALLBACK: true, // auto-use mock data if the API can't be reached
  ENDPOINTS: {
    register: "/auth/register",          // POST  {name,email,password,role}
    login: "/auth/login",                // POST  {email,password} -> {token,user}
    me: "/auth/me",                      // GET   -> {user}
    books: "/books",                     // GET ?search=&genre=&page= | POST (admin)
    book: (id) => `/books/${id}`,        // GET | PUT (admin) | DELETE (admin)
    borrow: (id) => `/books/${id}/borrow`,   // POST
    returnBook: (id) => `/books/${id}/return`, // POST
    recommendations: "/recommendations", // GET -> [book]
    interests: "/users/interests",       // GET | POST {genres:[]}
    notifications: "/notifications",     // GET -> [notification]
    notificationRead: (id) => `/notifications/${id}/read`, // POST
  },
};
