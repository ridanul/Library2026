// ---------------------------------------------------------------------------
// API client. Wraps fetch() to the FastAPI backend described in config.js.
// Every function returns a Promise resolving to plain data (already parsed).
// On network failure, and only if LIB_CONFIG.DEMO_MODE_FALLBACK is true,
// calls are routed to Mock.* so the UI stays usable without a live backend.
// ---------------------------------------------------------------------------
var Api = (() => {
  const { API_BASE, ENDPOINTS, DEMO_MODE_FALLBACK } = window.LIB_CONFIG;

  function authHeaders() {
    const token = localStorage.getItem("lib_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function request(path, { method = "GET", body, auth = true } = {}) {
    const url = `${API_BASE}${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? authHeaders() : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError(err.detail || `Request failed (${res.status})`, res.status);
      }
      if (res.status === 204) return null;
      return res.json();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // Network-level failure (backend not running, CORS, offline, etc.)
      if (DEMO_MODE_FALLBACK) {
        window.__LIB_DEMO_ACTIVE__ = true;
        return Mock.route(path, method, body);
      }
      throw new ApiError("Could not reach the library server.", 0);
    }
  }

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiError,
    register: (data) => request(ENDPOINTS.register, { method: "POST", body: data, auth: false }),
    login: (data) => request(ENDPOINTS.login, { method: "POST", body: data, auth: false }),
    me: () => request(ENDPOINTS.me),
    listBooks: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request(`${ENDPOINTS.books}${qs ? `?${qs}` : ""}`);
    },
    addBook: (data) => request(ENDPOINTS.books, { method: "POST", body: data }),
    updateBook: (id, data) => request(ENDPOINTS.book(id), { method: "PUT", body: data }),
    deleteBook: (id) => request(ENDPOINTS.book(id), { method: "DELETE" }),
    borrowBook: (id) => request(ENDPOINTS.borrow(id), { method: "POST" }),
    returnBook: (id) => request(ENDPOINTS.returnBook(id), { method: "POST" }),
    getRecommendations: () => request(ENDPOINTS.recommendations),
    getInterests: () => request(ENDPOINTS.interests),
    setInterests: (genres) => request(ENDPOINTS.interests, { method: "POST", body: { genres } }),
    listPendingUsers: () => request("/admin/users/pending"),
    approveUser: (id) => request(`/admin/users/${id}/approve`, { method: "POST" }),
    getOverdueLoans: () => request("/admin/overdue"),
    getNotifications: () => request(ENDPOINTS.notifications),
    markNotificationRead: (id) => request(ENDPOINTS.notificationRead(id), { method: "POST" }),
  };
})();
window.Api = Api;
