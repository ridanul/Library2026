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
    const token = localStorage.getItem("lib_token");
    return !!token && token !== "null";
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
  // Password policy mirror of Backend/app/schemas.py validate_password_strength.
  // Returns '' when valid, otherwise a human-friendly message.
  passwordProblem(pw) {
    if (!pw || pw.length < 6) return "Password must be at least 6 characters long.";
    if (!/[A-Z]/.test(pw)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(pw)) return "Password must contain at least one lowercase letter.";
    if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain at least one special character (e.g. !@#$%^&*).";
    return "";
  },
};
