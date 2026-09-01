Auth.requireAuth();

const state = {
  user: Auth.getUser(),
  books: [],
  view: "browse",
  browse: { page: 1, pageSize: 9, total: 0 },
  manage: { page: 1, pageSize: 10, total: 0 },
  admin: {
    settings: { fine_per_day: 0.5, grace_days: 14, late_return_default_fine: 5 },
    users: [],
    students: { page: 1, pageSize: 10, total: 0 },
    teachers: { page: 1, pageSize: 10, total: 0 },
  },
};

const headerUserName = document.getElementById("headerUserName");
const headerUserRole = document.getElementById("headerUserRole");
const logoutBtn = document.getElementById("logoutBtn");
headerUserName.textContent = state.user?.name || "Reader";
// For admins, surface their library role (e.g. "librarian") next to the title.
headerUserRole.textContent = state.user?.role === "admin"
  ? (state.user?.admin_role || "librarian")
  : (state.user?.role || "student");
logoutBtn.addEventListener("click", () => Auth.logout());

if (Auth.isAdmin()) {
  document.getElementById("manageNavBtn")?.classList.remove("hidden");
  document.getElementById("manageNavBtnMobile")?.classList.remove("hidden");
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`view-${view}`)?.classList.remove("hidden");
  if (view === "recommendations") loadRecommendations();
  if (view === "notifications") loadNotifications();
  if (view === "manage") loadManageTable();
}
setView("browse");

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2400);
}

function renderPager(container, { page, pageSize, total, onPageChange }) {
  const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize));
  if (!container) return;
  if (total <= pageSize) {
    container.innerHTML = "";
    return;
  }
  const prevDisabled = page <= 1 ? "disabled opacity-50 cursor-not-allowed" : "";
  const nextDisabled = page >= pageCount ? "disabled opacity-50 cursor-not-allowed" : "";
  container.innerHTML = `
    <button data-page="${page - 1}" class="px-3 py-1.5 border border-ink/20 rounded text-sm ${prevDisabled}">Prev</button>
    <span class="text-xs font-mono text-charcoal/60 px-2">Page ${page} of ${pageCount}</span>
    <button data-page="${page + 1}" class="px-3 py-1.5 border border-ink/20 rounded text-sm ${nextDisabled}">Next</button>
  `;
  container.querySelectorAll("button[data-page]").forEach((btn) => {
    if (btn.hasAttribute("disabled")) return;
    btn.addEventListener("click", () => onPageChange(Number(btn.dataset.page)));
  });
}

function bookCard(book, { showBorrow = true } = {}) {
  const stampClass = book.available > 0 ? "stamp-available" : "stamp-out";
  const stampText = book.available > 0 ? `${book.available} available` : "checked out";
  return `
    <div data-detail="${book.id}" class="relative bg-white border border-ink/10 rounded-lg p-5 pt-6 shadow-sm hover:shadow-md transition">
      <span class="card-tab">${escapeHtml(book.genre || "Unsorted")}</span>
      <h3 class="font-display text-lg text-ink leading-snug mb-0.5">${escapeHtml(book.title)}</h3>
      <p class="text-sm text-charcoal/60 mb-3">${escapeHtml(book.author)}</p>
      ${(book.department || book.session) ? `<p class="text-xs font-mono text-brass mb-2">${escapeHtml([book.department, book.session].filter(Boolean).join(" · "))}</p>` : ""}
      <p class="text-sm text-charcoal/70 mb-4 line-clamp-3">${escapeHtml(book.description || "")}</p>
      <div class="flex items-center justify-between">
        <span class="stamp ${stampClass}">${stampText}</span>
        <span class="font-mono text-[11px] text-charcoal/40">${escapeHtml(book.call_number || "")}</span>
      </div>
      ${showBorrow ? `
      <button data-borrow="${book.id}" ${book.available < 1 ? "disabled" : ""}
        class="mt-4 w-full text-sm font-medium py-2 rounded transition
        ${book.available > 0 ? "bg-ink text-parchment hover:bg-ink/90" : "bg-charcoal/10 text-charcoal/40 cursor-not-allowed"}">
        ${book.available > 0 ? "Borrow this copy" : "Join waitlist"}
      </button>` : ""}
    </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const bookGrid = document.getElementById("bookGrid");
const bookEmpty = document.getElementById("bookEmpty");
const searchInput = document.getElementById("searchInput");
const genreFilter = document.getElementById("genreFilter");
const departmentFilter = document.getElementById("departmentFilter");
const sessionFilter = document.getElementById("sessionFilter");
const categoryFilter = document.getElementById("categoryFilter");

const ALL_DEPARTMENTS = ["CSE", "EEE", "CE", "ME", "BBA", "Economics", "English", "Law", "Arts & Humanities", "Pharmacy"];
const ALL_SESSIONS = ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"];
const ALL_CATEGORIES = ["academic", "non-academic"];

let searchDebounce;

async function loadBooks() {
  try {
    const resp = await Api.listBooks({
      search: searchInput.value.trim(),
      genre: genreFilter.value,
      department: departmentFilter.value,
      session: sessionFilter.value,
      page: state.browse.page,
      page_size: state.browse.pageSize,
    });
    state.books = resp.items;
    state.browse.total = resp.total;
    renderBookGrid(resp.items);
    populateFilters(resp);
    renderPager(document.getElementById("browsePagination"), {
      page: state.browse.page,
      pageSize: state.browse.pageSize,
      total: resp.total,
      onPageChange: (nextPage) => {
        state.browse.page = nextPage;
        loadBooks();
      },
    });
  } catch (err) {
    toast(err.message || "Could not load books.");
  }
}

function renderBookGrid(items) {
  bookGrid.innerHTML = items.map((b) => bookCard(b, { showBorrow: !Auth.isAdmin() })).join("");
  bookEmpty.classList.toggle("hidden", items.length > 0);
  bookGrid.querySelectorAll("[data-borrow]").forEach((btn) => {
    btn.addEventListener("click", () => borrowBook(btn.dataset.borrow));
  });
  bookGrid.querySelectorAll("[data-detail]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest('[data-borrow]')) return;
      openBookDetail(el.dataset.detail);
    });
  });
}

function fillFilterSelect(sel, options, allLabel) {
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    options.map((v) => `<option value="${escapeHtml(v)}"${v === sel.value ? " selected" : ""}>${escapeHtml(v)}</option>`).join("");
}

// Populate filter dropdowns. Server facets cover the whole catalog so every
// option stays visible while a filter is active; fall back to what was fetched.
function populateFilters(facets = {}) {
  const fallback = (key) => [...new Set(state.books.map((b) => b[key]).filter(Boolean))].sort();
  fillFilterSelect(genreFilter, facets.genres?.length ? facets.genres : fallback("genre"), "All genres");
  fillFilterSelect(departmentFilter, facets.departments?.length ? facets.departments : fallback("department"), "All departments");
  fillFilterSelect(sessionFilter, facets.sessions?.length ? facets.sessions : fallback("session"), "All sessions");
  // Academic/non-academic is a fixed pair; keep it stable regardless of facets.
  fillFilterSelect(categoryFilter, facets.categories?.length === 1 ? facets.categories : ALL_CATEGORIES,
    "Academic & non-academic");
}

async function borrowBook(id) {
  try {
    await Api.borrowBook(id);
    toast("Borrowed — enjoy the read.");
    loadBooks();
    if (state.view === "manage") loadManageTable();
  } catch (err) {
    toast(err.message || "Could not borrow that book.");
  }
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.browse.page = 1;
    loadBooks();
  }, 300);
});

genreFilter.addEventListener("change", () => {
  state.browse.page = 1;
  loadBooks();
});

departmentFilter.addEventListener("change", () => {
  state.browse.page = 1;
  loadBooks();
});

sessionFilter.addEventListener("change", () => {
  state.browse.page = 1;
  loadBooks();
});

categoryFilter.addEventListener("change", () => {
  state.browse.page = 1;
  loadBooks();
});

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("q") && !Auth.isAdmin()) {
  searchInput.value = urlParams.get("q");
}

if (Auth.isAdmin()) {
  // Admins get the management dashboard only: hide Browse / For You entry
  // points and land directly on the Manage view (borrowing is blocked server-side).
  document.querySelectorAll('[data-view="browse"], [data-view="recommendations"]')
    .forEach((btn) => btn.classList.add("hidden"));
  setView("manage");
} else {
  loadBooks();
}

const bookDetailModal = document.getElementById("bookDetailModal");
const closeDetail = document.getElementById("closeDetailModal");
const detailCover = document.getElementById("detailCover");
const detailTitle = document.getElementById("detailTitle");
const detailAuthor = document.getElementById("detailAuthor");
const detailIsbn = document.getElementById("detailIsbn");
const detailDescription = document.getElementById("detailDescription");
const detailAvailable = document.getElementById("detailAvailable");
const detailBorrowBtn = document.getElementById("detailBorrowBtn");
closeDetail?.addEventListener("click", () => bookDetailModal?.classList.add("hidden"));

async function openBookDetail(id) {
  try {
    const [book, revResp] = await Promise.all([Api.getBook(id), Api.getBookReviews(id)]);
    detailCover.src = Api.coverUrl(book.cover_url) || "https://via.placeholder.com/160x220?text=Cover";
    const metaBits = [book.department, book.session].filter(Boolean).join(" · ");
    const metaEl = document.getElementById("detailMeta");
    if (metaEl) {
      metaEl.textContent = metaBits;
      metaEl.classList.toggle("hidden", !metaBits);
    }
    detailTitle.textContent = book.title;
    detailAuthor.textContent = book.author;
    detailIsbn.textContent = `ISBN: ${book.isbn}`;
    detailDescription.textContent = book.description || "";
    detailAvailable.textContent = book.available > 0 ? `${book.available} available` : "checked out";
    // Admins cannot borrow -- hide the button entirely for them.
    if (Auth.isAdmin()) {
      detailBorrowBtn.disabled = true;
      detailBorrowBtn.classList.add("hidden");
    } else {
      detailBorrowBtn.classList.remove("hidden");
      detailBorrowBtn.disabled = book.available < 1;
      detailBorrowBtn.onclick = async () => {
        try {
          await Api.borrowBook(book.id);
          toast("Borrowed — enjoy the read.");
          bookDetailModal.classList.add("hidden");
          loadBooks();
        } catch (err) {
          toast(err.message || "Could not borrow that book.");
        }
      };
    }
    renderReviews(revResp);
    document.getElementById("reviewBookId").value = id;
    document.getElementById("reviewComment").value = "";
    bookDetailModal.classList.remove("hidden");
  } catch (err) {
    toast(err.message || "Could not load book details.");
  }
}

function starsFor(rating) {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function renderReviews(resp) {
  const wrap = document.getElementById("detailReviews");
  const form = document.getElementById("reviewForm");
  if (!wrap || !form) return;
  const items = resp.items || [];
  wrap.innerHTML = items.length
    ? items.map((r) => `
        <div class="rounded border border-ink/10 bg-white p-2">
          <p class="text-sm text-ink">${starsFor(r.rating)} <span class="font-medium ml-1">${escapeHtml(r.reviewer_name)}</span></p>
          <p class="text-sm text-charcoal/70">${escapeHtml(r.comment)}</p>
          <p class="font-mono text-[11px] text-charcoal/40">${escapeHtml(String(r.created_at || ""))}</p>
        </div>`).join("")
    : `<p class="text-sm text-charcoal/50">No approved reviews yet.</p>`;
  // Only members who borrowed this book get the write-review form.
  form.classList.toggle("hidden", !resp.can_review);
}

const settingsModal = document.getElementById("settingsModal");
const openSettingsBtn = document.getElementById("openSettingsBtn");
if (openSettingsBtn && settingsModal) {
  openSettingsBtn.addEventListener("click", async () => {
    try {
      const s = await Api.getAdminSettings();
      state.admin.settings = {
        fine_per_day: Number(s.fine_per_day ?? 0),
        grace_days: Number(s.grace_days ?? 14),
        late_return_default_fine: Number(s.late_return_default_fine ?? 5),
      };
      document.getElementById("settingFine").value = state.admin.settings.fine_per_day.toFixed(2);
      document.getElementById("settingGrace").value = String(state.admin.settings.grace_days);
      document.getElementById("settingLateDefaultFine").value = state.admin.settings.late_return_default_fine.toFixed(2);
      settingsModal.classList.remove("hidden");
    } catch (err) {
      toast(err.message || "Could not load settings.");
    }
  });
  document.getElementById("closeSettingsModal").addEventListener("click", () => settingsModal.classList.add("hidden"));
  document.getElementById("cancelSettingsBtn").addEventListener("click", () => settingsModal.classList.add("hidden"));
  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    try {
      const fine = parseFloat(document.getElementById("settingFine").value || "0");
      const grace = parseInt(document.getElementById("settingGrace").value || "0", 10);
      const lateDefault = parseFloat(document.getElementById("settingLateDefaultFine").value || "0");
      await Api.putAdminSettings({ fine_per_day: fine, grace_days: grace, late_return_default_fine: lateDefault });
      state.admin.settings = { fine_per_day: fine, grace_days: grace, late_return_default_fine: lateDefault };
      settingsModal.classList.add("hidden");
      toast("Settings saved.");
      loadAdminPanels();
    } catch (err) {
      toast(err.message || "Could not save settings.");
    }
  });
}

const fineModal = document.getElementById("fineModal");
if (fineModal) {
  document.getElementById("closeFineModal").addEventListener("click", () => fineModal.classList.add("hidden"));
  document.getElementById("cancelFineBtn").addEventListener("click", () => fineModal.classList.add("hidden"));
  document.getElementById("saveFineBtn").addEventListener("click", async () => {
    try {
      const userId = document.getElementById("fineUserId").value;
      const rawAmount = document.getElementById("fineAmount").value;
      const payload = {
        reason: document.getElementById("fineReason").value || "Overdue fine",
      };
      if (rawAmount !== "") payload.amount = parseFloat(rawAmount);
      await Api.createFine(userId, payload);
      fineModal.classList.add("hidden");
      toast("Fine applied.");
      loadAdminPanels();
    } catch (err) {
      toast(err.message || "Could not apply fine.");
    }
  });
}

const ALL_GENRES = ["Sci-Fi", "Fantasy", "Mystery", "Non-Fiction", "Romance", "History", "Poetry", "Biography"];

async function loadRecommendations() {
  try {
    const [{ items }, { genres }] = await Promise.all([Api.getRecommendations(), Api.getInterests()]);
    document.getElementById("interestChips").innerHTML = genres.length
      ? genres.map((g) => `<span class="stamp stamp-new border-brass text-brass">${escapeHtml(g)}</span>`).join("")
      : `<span class="text-sm text-charcoal/50">No interests set yet.</span>`;
    document.getElementById("recGrid").innerHTML = items.map((b) => bookCard(b, { showBorrow: !Auth.isAdmin() })).join("");
    document.getElementById("recEmpty").classList.toggle("hidden", items.length > 0);
    document.getElementById("recGrid").querySelectorAll("[data-borrow]").forEach((btn) => {
      btn.addEventListener("click", () => borrowBook(btn.dataset.borrow));
    });
  } catch (err) {
    toast(err.message || "Could not load recommendations.");
  }
}

document.getElementById("editInterestsBtn")?.addEventListener("click", openInterestsModal);
async function openInterestsModal() {
  const { genres } = await Api.getInterests();
  const opts = document.getElementById("interestOptions");
  opts.innerHTML = ALL_GENRES.map((g) => `
    <button type="button" data-genre="${g}"
      class="interest-chip stamp ${genres.includes(g) ? "stamp-new border-brass text-brass" : "border-charcoal/20 text-charcoal/50"}">
      ${g}
    </button>`).join("");
  opts.querySelectorAll(".interest-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const active = chip.classList.contains("text-brass");
      chip.classList.toggle("text-brass", !active);
      chip.classList.toggle("border-brass", !active);
      chip.classList.toggle("stamp-new", !active);
      chip.classList.toggle("text-charcoal/50", active);
      chip.classList.toggle("border-charcoal/20", active);
    });
  });
  document.getElementById("interestsModal").classList.remove("hidden");
}

document.getElementById("closeInterestsModal")?.addEventListener("click", () =>
  document.getElementById("interestsModal").classList.add("hidden")
);
document.getElementById("saveInterestsBtn")?.addEventListener("click", async () => {
  const selected = [...document.querySelectorAll(".interest-chip.text-brass")].map((c) => c.dataset.genre);
  try {
    await Api.setInterests(selected);
    document.getElementById("interestsModal").classList.add("hidden");
    toast("Interests saved.");
    loadRecommendations();
  } catch (err) {
    toast(err.message || "Could not save interests.");
  }
});

async function loadNotifications() {
  if (Auth.isAdmin()) {
    // Admins manage notifications instead of viewing a personal inbox.
    document.getElementById("adminNotifSection").classList.remove("hidden");
    document.getElementById("memberNotifWrap").classList.add("hidden");
    initAdminNotifications();
    loadAdminNotifications();
    return;
  }
  document.getElementById("adminNotifSection").classList.add("hidden");
  document.getElementById("memberNotifWrap").classList.remove("hidden");
  try {
    const { items } = await Api.getNotifications();
    const list = document.getElementById("notifList");
    list.innerHTML = items.map((n) => `
      <div class="flex items-start gap-3 bg-white border border-ink/10 rounded-lg p-4 ${n.read ? "opacity-60" : ""}">
        <span class="mt-1 w-2 h-2 rounded-full flex-shrink-0 ${n.read ? "bg-charcoal/20" : "bg-brass"}"></span>
        <div class="flex-1">
          <p class="font-medium text-ink text-sm">${escapeHtml(n.title)}</p>
          <p class="text-sm text-charcoal/60">${escapeHtml(n.body)}</p>
          <p class="font-mono text-[11px] text-charcoal/40 mt-1">${escapeHtml(n.created_at)}</p>
        </div>
        ${!n.read ? `<button data-read="${n.id}" class="text-xs font-mono text-brass hover:underline flex-shrink-0">Mark read</button>` : ""}
      </div>`).join("");
    document.getElementById("notifEmpty").classList.toggle("hidden", items.length > 0);
    list.querySelectorAll("[data-read]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Api.markNotificationRead(btn.dataset.read);
        loadNotifications();
        refreshNotifDot();
      });
    });
    refreshNotifDotFrom(items);
  } catch (err) {
    toast(err.message || "Could not load notifications.");
  }
}

let adminNotifBound = false;

function populateAdminNotifUser() {
  const userSel = document.getElementById("adminNotifUser");
  if (!userSel) return;
  userSel.innerHTML = (state.admin.users || []).map((u) =>
    `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join("");
}

function adminNotifTargetVisible() {
  const target = document.getElementById("adminNotifTarget");
  document.getElementById("adminNotifUserWrap").classList.toggle("hidden", target?.value !== "user");
}

function resetAdminNotifForm() {
  const gid = document.getElementById("adminNotifGroupId");
  if (!gid) return;
  document.getElementById("adminNotifTitle").value = "";
  document.getElementById("adminNotifBody").value = "";
  const statusEl = document.getElementById("adminNotifStatus");
  statusEl.textContent = "";
  statusEl.className = "text-sm text-charcoal/60";
  document.getElementById("adminNotifFormTitle").textContent = "Send notification";
  document.getElementById("adminNotifSendBtn").textContent = "Send notification";
  document.getElementById("adminNotifTarget").disabled = false;
  document.getElementById("adminNotifCancelEditBtn").classList.add("hidden");
  adminNotifTargetVisible();
}

function initAdminNotifications() {
  const target = document.getElementById("adminNotifTarget");
  if (adminNotifBound || !target) return;
  adminNotifBound = true;
  populateAdminNotifUser();
  target.addEventListener("change", adminNotifTargetVisible);
  document.getElementById("adminNotifSendBtn").addEventListener("click", async () => {
    const groupId = document.getElementById("adminNotifGroupId").value;
    const title = document.getElementById("adminNotifTitle").value.trim();
    const body = document.getElementById("adminNotifBody").value.trim();
    const statusEl = document.getElementById("adminNotifStatus");
    if (!title || !body) {
      statusEl.textContent = "Title and message are required.";
      statusEl.className = "text-sm text-rust";
      return;
    }
    try {
      if (groupId) {
        await Api.updateAdminNotification(groupId, { title, body });
        statusEl.textContent = "Notification updated for all recipients.";
      } else {
        const payload = { title, body, target: target.value };
        if (target.value === "user") payload.user_id = document.getElementById("adminNotifUser").value;
        const res = await Api.createAdminNotification(payload);
        statusEl.textContent = `Sent to ${res.count} recipient(s).`;
      }
      statusEl.className = "text-sm text-sage";
      resetAdminNotifForm();
      loadAdminNotifications();
    } catch (err) {
      statusEl.textContent = err.message || "Could not save notification.";
      statusEl.className = "text-sm text-rust";
    }
  });
  document.getElementById("adminNotifCancelEditBtn").addEventListener("click", resetAdminNotifForm);
  adminNotifTargetVisible();
}

async function loadAdminNotifications() {
  const listEl = document.getElementById("adminNotifList");
  if (!listEl) return;
  populateAdminNotifUser();
  try {
    const { items } = await Api.adminNotifications();
    listEl.innerHTML = items.length
      ? items.map((n) => `
          <div class="rounded border border-ink/10 bg-white p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1">
                <p class="font-medium text-ink text-sm">${escapeHtml(n.title)}</p>
                <p class="text-sm text-charcoal/70">${escapeHtml(n.body)}</p>
                <p class="font-mono text-[11px] text-charcoal/40 mt-1">${escapeHtml(String(n.created_at))} · ${n.recipients} recipient(s) · ${n.unread} unread</p>
              </div>
              <div class="flex gap-2 flex-shrink-0">
                <button data-editnotif="${n.id}" class="text-xs font-mono text-ink hover:underline">Edit</button>
                <button data-delnotif="${n.id}" class="text-xs font-mono text-rust hover:underline">Delete</button>
              </div>
            </div>
          </div>`).join("")
      : `<p class="text-sm text-charcoal/50">No notifications sent yet. Compose one above.</p>`;
    listEl.querySelectorAll("[data-editnotif]").forEach((b) => {
      const item = items.find((x) => x.id === b.dataset.editnotif);
      if (item) b.addEventListener("click", () => startEditNotification(item));
    });
    listEl.querySelectorAll("[data-delnotif]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this notification for all recipients?")) return;
        try {
          await Api.deleteAdminNotification(b.dataset.delnotif);
          toast("Notification deleted.");
          loadAdminNotifications();
        } catch (err) {
          toast(err.message || "Could not delete the notification.");
        }
      })
    );
  } catch (err) {
    listEl.innerHTML = `<p class="text-sm text-rust">${escapeHtml(err.message || "Could not load notifications.")}</p>`;
  }
}

function startEditNotification(n) {
  resetAdminNotifForm();
  document.getElementById("adminNotifGroupId").value = n.id;
  document.getElementById("adminNotifTitle").value = n.title;
  document.getElementById("adminNotifBody").value = n.body;
  document.getElementById("adminNotifFormTitle").textContent = "Edit notification";
  document.getElementById("adminNotifSendBtn").textContent = "Save changes";
  document.getElementById("adminNotifCancelEditBtn").classList.remove("hidden");
  document.getElementById("adminNotifTarget").disabled = true;
  document.getElementById("adminNotifUserWrap").classList.add("hidden");
}

function refreshNotifDotFrom(items) {
  const hasUnread = items.some((n) => !n.read);
  document.getElementById("notifDot")?.classList.toggle("hidden", !hasUnread);
}

async function refreshNotifDot() {
  try {
    const { items } = await Api.getNotifications();
    refreshNotifDotFrom(items);
  } catch {
    // non-critical
  }
}
refreshNotifDot();

const bookModal = document.getElementById("bookModal");
const bookForm = document.getElementById("bookForm");

function openBookModal(book = null) {
  document.getElementById("bookModalTitle").textContent = book ? "Edit book" : "Add a book";
  document.getElementById("bookId").value = book?.id || "";
  document.getElementById("bookTitle").value = book?.title || "";
  document.getElementById("bookAuthor").value = book?.author || "";
  document.getElementById("bookIsbn").value = book?.isbn || "";
  document.getElementById("bookGenre").value = book?.genre || "";
  document.getElementById("bookCallNumber").value = book?.call_number || "";
  document.getElementById("bookCopies").value = book?.copies || 1;
  document.getElementById("bookDescription").value = book?.description || "";
  document.getElementById("bookDepartment").value = book?.department || "";
  document.getElementById("bookSession").value = book?.session || "";
  document.getElementById("bookCategory").value = book?.category || "non-academic";
  document.getElementById("bookFormError").classList.add("hidden");
  document.getElementById("genreList").innerHTML = ALL_GENRES.map((g) => `<option value="${g}">`).join("");
  document.getElementById("bookDeptList").innerHTML = ALL_DEPARTMENTS.map((d) => `<option value="${d}">`).join("");
  document.getElementById("bookSessionList").innerHTML = ALL_SESSIONS.map((s) => `<option value="${s}">`).join("");
  document.getElementById("bookCoverFile").value = "";
  const preview = document.getElementById("bookCoverPreview");
  if (book?.cover_url) {
    preview.src = Api.coverUrl(book.cover_url);
    preview.classList.remove("hidden");
  } else {
    preview.classList.add("hidden");
    preview.removeAttribute("src");
  }
  bookModal.classList.remove("hidden");
}

document.getElementById("openAddBookBtn")?.addEventListener("click", () => openBookModal());
document.getElementById("closeBookModal")?.addEventListener("click", () => bookModal.classList.add("hidden"));
document.getElementById("cancelBookModal")?.addEventListener("click", () => bookModal.classList.add("hidden"));

// Live-preview a chosen cover image; only real JPEGs are allowed through.
document.getElementById("bookCoverFile")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById("bookCoverPreview");
  if (!file) {
    preview.classList.add("hidden");
    return;
  }
  if (!/^image\/jpe?g$/i.test(file.type)) {
    toast("Please choose a JPG image.");
    e.target.value = "";
    preview.classList.add("hidden");
    return;
  }
  preview.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");
});

bookForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("bookId").value;
  const payload = {
    title: document.getElementById("bookTitle").value.trim(),
    author: document.getElementById("bookAuthor").value.trim(),
    isbn: document.getElementById("bookIsbn").value.trim(),
    genre: document.getElementById("bookGenre").value.trim(),
    call_number: document.getElementById("bookCallNumber").value.trim(),
    copies: Number(document.getElementById("bookCopies").value),
    description: document.getElementById("bookDescription").value.trim(),
    department: document.getElementById("bookDepartment").value.trim(),
    session: document.getElementById("bookSession").value.trim(),
    category: document.getElementById("bookCategory").value,
  };
  try {
    // Upload a freshly-picked cover first so it can be attached to the payload.
    // On edit without a new file, cover_url is omitted and stays unchanged.
    const coverFile = document.getElementById("bookCoverFile").files[0];
    if (coverFile) {
      const up = await Api.uploadCover(coverFile);
      payload.cover_url = up.url;
    }
    if (id) await Api.updateBook(id, payload);
    else await Api.addBook(payload);
    bookModal.classList.add("hidden");
    toast(id ? "Book updated." : "Book added to the catalog.");
    loadBooks();
    loadManageTable();
  } catch (err) {
    const errEl = document.getElementById("bookFormError");
    errEl.textContent = err.message || "Could not save this book.";
    errEl.classList.remove("hidden");
  }
});

async function loadManageTable() {
  try {
    const { items, total } = await Api.listBooks({
      page: state.manage.page,
      page_size: state.manage.pageSize,
    });
    state.manage.total = total;
    document.getElementById("manageTableBody").innerHTML = items.map((b) => `
      <tr class="border-t border-ink/5">
        <td class="px-4 py-3 font-medium text-ink">${escapeHtml(b.title)}</td>
        <td class="px-4 py-3 text-charcoal/70">${escapeHtml(b.author)}</td>
        <td class="px-4 py-3 text-charcoal/70">${escapeHtml(b.genre)}</td>
        <td class="px-4 py-3 font-mono text-xs text-charcoal/50">${escapeHtml(b.call_number || "")}</td>
        <td class="px-4 py-3 text-charcoal/70">${b.available}/${b.copies}</td>
        <td class="px-4 py-3 text-right space-x-2">
          <button data-edit="${b.id}" class="text-xs font-mono text-ink hover:underline">Edit</button>
          <button data-delete="${b.id}" class="text-xs font-mono text-rust hover:underline">Delete</button>
        </td>
      </tr>`).join("");

    document.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => openBookModal(items.find((b) => b.id === btn.dataset.edit)))
    );

    document.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this book from the catalog?")) return;
        await Api.deleteBook(btn.dataset.delete);
        toast("Book removed.");
        loadManageTable();
        loadBooks();
      })
    );

    renderPager(document.getElementById("managePagination"), {
      page: state.manage.page,
      pageSize: state.manage.pageSize,
      total,
      onPageChange: (nextPage) => {
        state.manage.page = nextPage;
        loadManageTable();
      },
    });

    loadAdminPanels();
  } catch (err) {
    toast(err.message || "Could not load the collection.");
  }
}

async function loadAdminPanels() {
  if (!Auth.isAdmin()) return;
  try {
    const [{ items: pendingUsers }, { items: overdueLoans }, usersResp, settingsResp] = await Promise.all([
      Api.listPendingUsers(),
      Api.getOverdueLoans(),
      Api.listUsers(),
      Api.getAdminSettings(),
    ]);

    state.admin.users = usersResp.items || [];
    state.admin.settings = {
      fine_per_day: Number(settingsResp.fine_per_day ?? 0.5),
      grace_days: Number(settingsResp.grace_days ?? 14),
      late_return_default_fine: Number(settingsResp.late_return_default_fine ?? 5),
    };

    document.getElementById("pendingCount").textContent = pendingUsers.length;
    document.getElementById("overdueCount").textContent = overdueLoans.length;

    const pendingList = document.getElementById("pendingUsersList");
    pendingList.innerHTML = pendingUsers.length
      ? pendingUsers.map((user) => `
        <div class="flex items-center justify-between gap-3 rounded border border-ink/10 bg-parchment/60 p-3">
          <div>
            <p class="font-medium text-ink">${escapeHtml(user.name)}</p>
            <p class="text-xs font-mono text-charcoal/50">${escapeHtml(user.email)}</p>
          </div>
          <button data-approve="${user.id}" class="text-xs font-mono bg-ink text-parchment px-3 py-1.5 rounded hover:bg-ink/90">Approve</button>
        </div>`).join("")
      : `<p class="text-sm text-charcoal/50">No student applications are waiting.</p>`;

    pendingList.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await Api.approveUser(btn.dataset.approve);
        toast("Student approved.");
        loadAdminPanels();
      });
    });

    const overdueList = document.getElementById("overdueList");
    overdueList.innerHTML = overdueLoans.length
      ? overdueLoans.map((loan) => `
        <div class="rounded border border-rust/20 bg-rust/5 p-3">
          <p class="font-medium text-ink">${escapeHtml(loan.userName)} — ${escapeHtml(loan.bookTitle)}</p>
          <p class="text-xs font-mono text-charcoal/50">Due ${escapeHtml(loan.due_date)} · not returned</p>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs text-charcoal/60">Overdue days: ${escapeHtml(String(loan.days_overdue || "—"))} · Fine: ${loan.fine ? ("$" + Number(loan.fine).toFixed(2)) : "—"}</div>
            <div class="flex items-center gap-2">
              <button data-return="${loan.id}" class="text-xs font-mono border border-ink/20 text-ink px-3 py-1.5 rounded hover:bg-parchmentDark transition">Mark returned</button>
              <button data-charge="${loan.userId}" data-amount="${loan.fine ?? ""}" class="text-xs font-mono bg-ink text-parchment px-3 py-1.5 rounded hover:bg-ink/90">Charge fine</button>
            </div>
          </div>
        </div>`).join("")
      : `<p class="text-sm text-charcoal/50">No overdue loans right now.</p>`;

    overdueList.querySelectorAll("[data-return]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await Api.adminReturnLoan(btn.dataset.return);
          toast("Loan marked as returned.");
          loadAdminPanels();
          loadBooks();
        } catch (err) {
          toast(err.message || "Could not mark that loan returned.");
        }
      });
    });

    overdueList.querySelectorAll("[data-charge]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const userId = btn.dataset.charge;
        const amount = btn.dataset.amount || String(state.admin.settings.late_return_default_fine.toFixed(2));
        document.getElementById("fineUserId").value = userId;
        document.getElementById("fineAmount").value = amount;
        document.getElementById("fineReason").value = "Overdue fine";
        document.getElementById("fineModal").classList.remove("hidden");
      });
    });

    initAdminNotificationForm();
    renderMemberTables();
    loadPendingReviews();
    initManualReview();
  } catch (err) {
    document.getElementById("pendingUsersList").innerHTML = `<p class="text-sm text-rust">${escapeHtml(err.message || "Could not load admin panels.")}</p>`;
    document.getElementById("overdueList").innerHTML = "";
  }
}

function initAdminNotificationForm() {
  const targetSelect = document.getElementById("notifTargetSelect");
  const userWrap = document.getElementById("notifUserSelectWrap");
  const userSelect = document.getElementById("notifUserSelect");
  const sendBtn = document.getElementById("sendAdminNotificationBtn");
  const status = document.getElementById("adminNotifStatus");
  if (!targetSelect || !userWrap || !userSelect || !sendBtn) return;

  userSelect.innerHTML = state.admin.users.map((u) =>
    `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`
  ).join("");

  const syncTarget = () => {
    const isUser = targetSelect.value === "user";
    userWrap.classList.toggle("hidden", !isUser);
  };

  if (!targetSelect.dataset.bound) {
    targetSelect.addEventListener("change", syncTarget);
    sendBtn.addEventListener("click", async () => {
      const title = document.getElementById("notifTitleInput").value.trim();
      const body = document.getElementById("notifBodyInput").value.trim();
      const target = targetSelect.value;
      if (!title || !body) {
        status.textContent = "Title and message are required.";
        status.className = "text-sm text-rust";
        return;
      }
      const payload = { title, body, target };
      if (target === "user") payload.user_id = userSelect.value;
      try {
        const result = await Api.createAdminNotification(payload);
        status.textContent = `Sent to ${result.count} recipient(s).`;
        status.className = "text-sm text-sage";
        document.getElementById("notifTitleInput").value = "";
        document.getElementById("notifBodyInput").value = "";
      } catch (err) {
        status.textContent = err.message || "Could not send notification.";
        status.className = "text-sm text-rust";
      }
    });
    targetSelect.dataset.bound = "1";
  }

  syncTarget();
}

// ===========================================================================
// Admin: Students/Teachers tables
// ===========================================================================
function memberRow(u) {
  const statusBadge = u.status === "approved"
    ? `<span class="stamp stamp-available text-[10px]">approved</span>`
    : `<span class="stamp stamp-new border-brass text-brass text-[10px]">pending</span>`;
  const approveBtn = (u.status === "pending")
    ? `<button data-approve-user="${u.id}" class="text-xs font-mono bg-ink text-parchment px-3 py-1.5 rounded hover:bg-ink/90">Approve</button>`
    : "";
  return `<tr class="border-t border-ink/5">
        <td class="px-4 py-3 font-medium text-ink">${escapeHtml(u.name)}</td>
        <td class="px-4 py-3 text-charcoal/60">${escapeHtml(u.email)}</td>
        <td class="px-4 py-3 font-mono text-xs text-charcoal/60">${escapeHtml(u.card_number || "—")}</td>
        <td class="px-4 py-3 text-xs text-charcoal/60">${escapeHtml([u.department, u.session].filter(Boolean).join(" · ") || "—")}</td>
        <td class="px-4 py-3">${statusBadge}</td>
        <td class="px-4 py-3 text-right">${approveBtn}</td>
      </tr>`;
}

function renderMemberTables() {
  const users = state.admin.users || [];
  const students = users.filter((u) => u.role === "student");
  const teachers = users.filter((u) => u.role === "teacher");

  // Paginate each member group and render its page of rows.
  const groups = [
    { tbodyId: "studentsTableBody", pagId: "studentsPagination", key: "students", rows: students, emptyMsg: "No students registered yet." },
    { tbodyId: "teachersTableBody", pagId: "teachersPagination", key: "teachers", rows: teachers, emptyMsg: "No teachers registered yet." },
  ];

  for (const g of groups) {
    const tbody = document.getElementById(g.tbodyId);
    if (!tbody) continue;

    const pstate = state.admin[g.key];
    pstate.total = g.rows.length;
    const pageCount = Math.max(1, Math.ceil(pstate.total / pstate.pageSize));
    if (pstate.page > pageCount) pstate.page = pageCount;
    const start = (pstate.page - 1) * pstate.pageSize;
    const pageRows = g.rows.slice(start, start + pstate.pageSize);

    tbody.innerHTML = pageRows.length
      ? pageRows.map(memberRow).join("")
      : `<tr><td colspan="6" class="px-4 py-3 text-sm text-charcoal/50">${g.emptyMsg}</td></tr>`;

    tbody.querySelectorAll("[data-approve-user]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await Api.approveUser(btn.dataset.approveUser);
          toast("Account approved.");
          loadAdminPanels();
        } catch (err) {
          toast(err.message || "Could not approve account.");
        }
      })
    );

    renderPager(document.getElementById(g.pagId), {
      page: pstate.page,
      pageSize: pstate.pageSize,
      total: g.rows.length,
      onPageChange: (nextPage) => {
        pstate.page = nextPage;
        renderMemberTables();
      },
    });
  }
}

// ===========================================================================
// Review moderation + manual admin reviews
// ===========================================================================
async function loadPendingReviews() {
  const listEl = document.getElementById("pendingReviewsList");
  if (!listEl) return;
  try {
    const { items } = await Api.pendingReviews();
    listEl.innerHTML = items.length
      ? items.map((r) => `
          <div class="rounded border border-ink/10 bg-parchment/60 p-3">
            <p class="text-sm text-ink">${starsFor(r.rating)} · <span class="font-medium">${escapeHtml(r.bookTitle || "")}</span></p>
            <p class="text-sm text-charcoal/70">${escapeHtml(r.comment)}</p>
            <p class="text-xs font-mono text-charcoal/50 mb-2">by ${escapeHtml(r.reviewer_name)} · ${escapeHtml(String(r.created_at || ""))}</p>
            <div class="flex gap-2">
              <button data-review-approve="${r.id}" class="text-xs font-mono bg-ink text-parchment px-3 py-1.5 rounded hover:bg-ink/90">Approve</button>
              <button data-review-reject="${r.id}" class="text-xs font-mono border border-rust/30 text-rust px-3 py-1.5 rounded hover:bg-rust/5 transition">Reject</button>
            </div>
          </div>`).join("")
      : `<p class="text-sm text-charcoal/50">No reviews are waiting for moderation.</p>`;
    listEl.querySelectorAll("[data-review-approve]").forEach((b) =>
      b.addEventListener("click", () => moderateReview(b.dataset.reviewApprove, Api.approveReview))
    );
    listEl.querySelectorAll("[data-review-reject]").forEach((b) =>
      b.addEventListener("click", () => moderateReview(b.dataset.reviewReject, Api.rejectReview))
    );
  } catch (err) {
    listEl.innerHTML = `<p class="text-sm text-rust">${escapeHtml(err.message || "Could not load pending reviews.")}</p>`;
  }
}

async function moderateReview(id, action) {
  try {
    await action(id);
    toast("Review updated.");
    loadPendingReviews();
  } catch (err) {
    toast(err.message || "Could not update the review.");
  }
}

let manualReviewBound = false;
async function initManualReview() {
  const sel = document.getElementById("manualReviewBook");
  if (!sel) return;
  try {
    const { items } = await Api.listBooks({ page_size: 200 });
    sel.innerHTML = `<option value="" disabled selected>Select a book</option>` +
      items.map((b) => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join("");
  } catch {
    // keep existing options; submission fails politely if none was chosen
  }
  if (manualReviewBound) return;
  manualReviewBound = true;
  document.getElementById("submitManualReviewBtn")?.addEventListener("click", async () => {
    const bookId = sel.value;
    const rating = Number(document.getElementById("manualReviewRating").value);
    const comment = document.getElementById("manualReviewComment").value.trim();
    if (!bookId) {
      toast("Choose a book first.");
      return;
    }
    if (!comment) {
      toast("Write the review comment.");
      return;
    }
    try {
      await Api.addReviewManually({ book_id: bookId, rating, comment });
      toast("Review published.");
      document.getElementById("manualReviewComment").value = "";
    } catch (err) {
      toast(err.message || "Could not publish the review.");
    }
  });
}

// Student/teacher review submission from the book detail modal.
document.getElementById("reviewForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const bookId = document.getElementById("reviewBookId").value;
  const payload = {
    rating: Number(document.getElementById("reviewRating").value),
    comment: document.getElementById("reviewComment").value.trim(),
  };
  if (!payload.comment) {
    toast("Please write a short comment with your rating.");
    return;
  }
  try {
    await Api.addBookReview(bookId, payload);
    toast("Review submitted — visible after admin approval.");
    e.target.reset();
    e.target.classList.add("hidden");
  } catch (err) {
    toast(err.message || "Could not submit your review.");
  }
});

if (Auth.isAdmin()) {
  loadAdminPanels();
}

// ===========================================================================
// Profile modal — self-service edit of name / department / session /
// student ID plus an optional password change.
// ===========================================================================
// Administrative library roles an admin account may hold (e.g. librarian).
const ADMIN_ROLES = ["Librarian", "Cataloger", "Circulation", "Acquisitions", "Reference"];

const profileModal = document.getElementById("profileModal");

function fillProfileModal() {
  const u = state.user || {};
  const isAdmin = u.role === "admin";
  document.getElementById("profName").value = u.name || "";
  document.getElementById("profEmail").textContent = u.email || "—";
  const depSel = document.getElementById("profDepartment");
  if (!depSel.dataset.populated) {
    depSel.innerHTML =
      '<option value="">Not set</option>' +
      ALL_DEPARTMENTS.map((d) => `<option value="${d}">${d}</option>`).join("");
    depSel.dataset.populated = "1";
  }
  depSel.value = u.department || "";
  if (![...depSel.options].some((o) => o.value === depSel.value)) depSel.value = "";
  // Admins hold no academic session or student ID — hide those fields for them.
  document.getElementById("profSessionWrap").classList.toggle("hidden", isAdmin);
  document.getElementById("profStudentIdWrap").classList.toggle("hidden", isAdmin);
  document.getElementById("profSession").value = u.session || "";
  document.getElementById("profStudentId").value = u.student_id || "";

  // Admins may set their library role (e.g. "librarian").
  const adminRoleSel = document.getElementById("profAdminRole");
  if (adminRoleSel) {
    if (!adminRoleSel.dataset.populated) {
      adminRoleSel.innerHTML =
        '<option value="">Not set</option>' +
        ADMIN_ROLES.map((r) => `<option value="${r}">${r}</option>`).join("");
      adminRoleSel.dataset.populated = "1";
    }
    adminRoleSel.value = u.admin_role || "";
    document.getElementById("profAdminRoleWrap").classList.toggle("hidden", !isAdmin);
  }

  const cardInfo = document.getElementById("profCardInfo");
  if (u.card_number) {
    cardInfo.textContent = `Library card ${u.card_number} · valid until ${u.card_valid_until || "—"}`;
    cardInfo.classList.remove("hidden");
  } else {
    cardInfo.classList.add("hidden");
  }
  document.getElementById("profPassword").value = "";
  document.getElementById("profileFormError").classList.add("hidden");
}

document.getElementById("profileBtn")?.addEventListener("click", () => {
  fillProfileModal();
  profileModal.classList.remove("hidden");
});
document.getElementById("closeProfileModal")?.addEventListener("click", () => profileModal.classList.add("hidden"));
document.getElementById("cancelProfileModal")?.addEventListener("click", () => profileModal.classList.add("hidden"));

document.getElementById("profileForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("profileFormError");
  errEl.classList.add("hidden");
  const name = document.getElementById("profName").value.trim();
  const pw = document.getElementById("profPassword").value;
  if (!name) {
    errEl.textContent = "Name cannot be empty.";
    errEl.classList.remove("hidden");
    return;
  }
  const pwProblem = pw ? Auth.passwordProblem(pw) : "";
  if (pwProblem) {
    errEl.textContent = pwProblem;
    errEl.classList.remove("hidden");
    return;
  }
  const payload = {
    name,
    department: document.getElementById("profDepartment").value,
    session: document.getElementById("profSession").value.trim(),
    student_id: document.getElementById("profStudentId").value.trim(),
  };
  // Only admins carry a library role — include it so they can edit it.
  if (state.user?.role === "admin") {
    payload.admin_role = document.getElementById("profAdminRole").value;
  }
  if (pw) payload.password = pw;
  try {
    const updated = await Api.updateProfile(payload);
    state.user = updated;
    Auth.setSession(localStorage.getItem("lib_token"), updated); // refresh cached user, keep token
    headerUserName.textContent = updated.name || "Reader";
    headerUserRole.textContent = updated.role === "admin"
      ? (updated.admin_role || "librarian")
      : (updated.role || "student");
    profileModal.classList.add("hidden");
    toast("Profile updated.");
  } catch (err) {
    errEl.textContent = err.message || "Could not update profile.";
    errEl.classList.remove("hidden");
  }
});
    if (!window.LIB_CONFIG) {
      console.warn('LIB_CONFIG not found — applying fallback configuration (demo mode).');
      window.LIB_CONFIG = {
        API_BASE: '',
        DEMO_MODE_FALLBACK: true,
        ENDPOINTS: {
          register: "/auth/register",
          login: "/auth/login",
          me: "/auth/me",
          books: "/books",
          book: (id) => `/books/${id}`,
          borrow: (id) => `/books/${id}/borrow`,
          returnBook: (id) => `/books/${id}/return`,
          recommendations: "/recommendations",
          interests: "/users/interests",
          notifications: "/notifications",
          notificationRead: (id) => `/notifications/${id}/read`,
        },
      };
    }
       function closeMobileSidebar() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      sidebar.classList.add('-translate-x-full');
      overlay.classList.add('hidden');
    }

    function openMobileSidebar() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      sidebar.classList.remove('-translate-x-full');
      overlay.classList.remove('hidden');
    }

    // Toggle Mobile Sidebar
    document.getElementById('sidebarToggle')?.addEventListener('click', function (e) {
      e.stopPropagation();
      openMobileSidebar();
    });

    // Close Mobile Sidebar Button
    document.getElementById('sidebarClose')?.addEventListener('click', closeMobileSidebar);

    // Overlay click close
    document.getElementById('sidebarOverlay')?.addEventListener('click', closeMobileSidebar);

    // Auto-close overlay when navigating on mobile screens
    document.querySelectorAll('#sidebar .nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (window.innerWidth < 640) {
          closeMobileSidebar();
        }
      });
    });

    // Reset layout on window resize
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 640) {
        closeMobileSidebar();
      }
    });