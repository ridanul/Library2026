// ---------------------------------------------------------------------------
// Session helpers shared across pages.
// ---------------------------------------------------------------------------
const Auth = {
  getUser() {
    try { return JSON.parse(localStorage.getItem("lib_user") || "null"); }
    catch { return null; }
  },
  setSession(token, user) {
    localStorage.setItem("lib_token", token);
    localStorage.setItem("lib_user", JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem("lib_token");
    localStorage.removeItem("lib_user");
  },
  isLoggedIn() {
    return !!localStorage.getItem("lib_token");
  },
  isAdmin() {
    return this.getUser()?.role === "admin";
  },
  requireAuth() {
    if (!this.isLoggedIn()) window.location.href = "login.html";
  },
  redirectIfLoggedIn() {
    if (this.isLoggedIn()) window.location.href = "dashboard.html";
  },
  logout() {
    this.clearSession();
    window.location.href = "login.html";
  },
};
