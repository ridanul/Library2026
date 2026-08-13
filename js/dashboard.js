Auth.requireAuth();

const state = {
  user: Auth.getUser(),
  books: [],
  view: "browse",
};

// ---------------------------------------------------------------------------
// Header / nav setup
// ---------------------------------------------------------------------------
document.getElementById("headerUserName").textContent = state.user?.name || "Reader";
document.getElementById("headerUserRole").textContent = state.user?.role || "student";
document.getElementById("logoutBtn").addEventListener("click", () => Auth.logout());

if (Auth.isAdmin()) {
  document.getElementById("manageNavBtn").classList.remove("hidden");
  document.getElementById("manageNavBtnMobile").classList.remove("hidden");
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle("bg-parchment", active);
    b.classList.toggle("text-ink", active);
    b.classList.toggle("text-parchment/70", !active);
  });
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

// ---------------------------------------------------------------------------
// Book card renderer (shared by browse + recommendations)
// ---------------------------------------------------------------------------
function bookCard(book, { showBorrow = true } = {}) {
  const stampClass = book.available > 0 ? "stamp-available" : "stamp-out";
  const stampText = book.available > 0 ? `${book.available} available` : "checked out";
  return `
    <div data-detail="${book.id}" class="relative bg-white border border-ink/10 rounded-lg p-5 pt-6 shadow-sm hover:shadow-md transition">
      <span class="card-tab">${escapeHtml(book.genre || "Unsorted")}</span>
      <h3 class="font-display text-lg text-ink leading-snug mb-0.5">${escapeHtml(book.title)}</h3>
      <p class="text-sm text-charcoal/60 mb-3">${escapeHtml(book.author)}</p>
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

// ---------------------------------------------------------------------------
// Browse / search
// ---------------------------------------------------------------------------
const bookGrid = document.getElementById("bookGrid");
const bookEmpty = document.getElementById("bookEmpty");
const searchInput = document.getElementById("searchInput");
const genreFilter = document.getElementById("genreFilter");
let searchDebounce;

async function loadBooks() {
  try {
    const { items } = await Api.listBooks({
      search: searchInput.value.trim(),
      genre: genreFilter.value,
    });
    state.books = items;
    renderBookGrid(items);
    populateGenreFilter(items);
    if (window.__LIB_DEMO_ACTIVE__) document.getElementById("demoBadge").classList.remove("hidden");
  } catch (err) {
    toast(err.message || "Could not load books.");
  }
}

function renderBookGrid(items) {
  bookGrid.innerHTML = items.map((b) => bookCard(b)).join("");
  bookEmpty.classList.toggle("hidden", items.length > 0);
  bookGrid.querySelectorAll("[data-borrow]").forEach((btn) => {
    btn.addEventListener("click", () => borrowBook(btn.dataset.borrow));
  });
  // Attach detail handlers
  bookGrid.querySelectorAll("[data-detail]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest('[data-borrow]')) return;
      openBookDetail(el.dataset.detail);
    });
  });
}

let genreFilterPopulated = false;
function populateGenreFilter(items) {
  if (genreFilterPopulated) return;
  const genres = [...new Set(items.map((b) => b.genre).filter(Boolean))].sort();
  genreFilter.innerHTML = `<option value="">All genres</option>` + genres.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  genreFilterPopulated = true;
}

async function borrowBook(id) {
  try {
    await Api.borrowBook(id);
    toast("Borrowed — enjoy the read.");
    loadBooks();
  } catch (err) {
    toast(err.message || "Could not borrow that book.");
  }
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadBooks, 300);
});
genreFilter.addEventListener("change", loadBooks);
// If a search query is present on the landing page, pick it up before first load
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('q')) {
  searchInput.value = urlParams.get('q');
}
loadBooks();

// ---------------------------------------------------------------------------
// Book detail modal
// ---------------------------------------------------------------------------
const bookDetailModal = document.getElementById('bookDetailModal');
if (bookDetailModal) {
  const closeDetail = document.getElementById('closeDetailModal');
  const detailCover = document.getElementById('detailCover');
  const detailTitle = document.getElementById('detailTitle');
  const detailAuthor = document.getElementById('detailAuthor');
  const detailIsbn = document.getElementById('detailIsbn');
  const detailDescription = document.getElementById('detailDescription');
  const detailAvailable = document.getElementById('detailAvailable');
  const detailBorrowBtn = document.getElementById('detailBorrowBtn');
  closeDetail && closeDetail.addEventListener('click', () => bookDetailModal.classList.add('hidden'));

  async function openBookDetail(id) {
    try {
      const book = await Api.getBook(id);
      detailCover.src = book.cover_url || 'https://via.placeholder.com/160x220?text=Cover';
      detailTitle.textContent = book.title;
      detailAuthor.textContent = book.author;
      detailIsbn.textContent = `ISBN: ${book.isbn}`;
      detailDescription.textContent = book.description || '';
      detailAvailable.textContent = book.available > 0 ? `${book.available} available` : 'checked out';
      detailBorrowBtn.disabled = book.available < 1;
      detailBorrowBtn.onclick = async () => {
        try {
          await Api.borrowBook(book.id);
          toast('Borrowed — enjoy the read.');
          bookDetailModal.classList.add('hidden');
          loadBooks();
        } catch (err) {
          toast(err.message || 'Could not borrow that book.');
        }
      };
      bookDetailModal.classList.remove('hidden');
    } catch (err) {
      toast(err.message || 'Could not load book details.');
    }
  }
  window.openBookDetail = openBookDetail;
}

// ---------------------------------------------------------------------------
// Settings modal (admin)
// ---------------------------------------------------------------------------
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
if (openSettingsBtn && settingsModal) {
  openSettingsBtn.addEventListener('click', async () => {
    try {
      const s = await Api.getAdminSettings();
      document.getElementById('settingFine').value = (s.fine_per_day ?? 0).toFixed ? (s.fine_per_day).toFixed(2) : s.fine_per_day;
      document.getElementById('settingGrace').value = s.grace_days ?? 14;
      settingsModal.classList.remove('hidden');
    } catch (err) {
      toast(err.message || 'Could not load settings.');
    }
  });
  document.getElementById('closeSettingsModal').addEventListener('click', () => settingsModal.classList.add('hidden'));
  document.getElementById('cancelSettingsBtn').addEventListener('click', () => settingsModal.classList.add('hidden'));
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    try {
      const fine = parseFloat(document.getElementById('settingFine').value || 0);
      const grace = parseInt(document.getElementById('settingGrace').value || 0, 10);
      await Api.putAdminSettings({ fine_per_day: fine, grace_days: grace });
      settingsModal.classList.add('hidden');
      toast('Settings saved.');
      loadAdminPanels();
    } catch (err) {
      toast(err.message || 'Could not save settings.');
    }
  });
}

// Fine modal handlers
const fineModal = document.getElementById('fineModal');
if (fineModal) {
  document.getElementById('closeFineModal').addEventListener('click', () => fineModal.classList.add('hidden'));
  document.getElementById('cancelFineBtn').addEventListener('click', () => fineModal.classList.add('hidden'));
  document.getElementById('saveFineBtn').addEventListener('click', async () => {
    try {
      const userId = document.getElementById('fineUserId').value;
      const amount = parseFloat(document.getElementById('fineAmount').value || 0);
      const reason = document.getElementById('fineReason').value || 'Overdue fine';
      await Api.createFine(userId, { amount, reason });
      fineModal.classList.add('hidden');
      toast('Fine applied.');
      loadAdminPanels();
    } catch (err) {
      toast(err.message || 'Could not apply fine.');
    }
  });
}

// ---------------------------------------------------------------------------
// Recommendations + interests
// ---------------------------------------------------------------------------
const ALL_GENRES = ["Sci-Fi", "Fantasy", "Mystery", "Non-Fiction", "Romance", "History", "Poetry", "Biography"];

async function loadRecommendations() {
  try {
    const [{ items }, { genres }] = await Promise.all([Api.getRecommendations(), Api.getInterests()]);
    document.getElementById("interestChips").innerHTML = genres.length
      ? genres.map((g) => `<span class="stamp stamp-new border-brass text-brass">${escapeHtml(g)}</span>`).join("")
      : `<span class="text-sm text-charcoal/50">No interests set yet.</span>`;
    document.getElementById("recGrid").innerHTML = items.map((b) => bookCard(b)).join("");
    document.getElementById("recEmpty").classList.toggle("hidden", items.length > 0);
    document.getElementById("recGrid").querySelectorAll("[data-borrow]").forEach((btn) => {
      btn.addEventListener("click", () => borrowBook(btn.dataset.borrow));
    });
  } catch (err) {
    toast(err.message || "Could not load recommendations.");
  }
}

document.getElementById("editInterestsBtn").addEventListener("click", openInterestsModal);
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
document.getElementById("closeInterestsModal").addEventListener("click", () =>
  document.getElementById("interestsModal").classList.add("hidden")
);
document.getElementById("saveInterestsBtn").addEventListener("click", async () => {
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

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
async function loadNotifications() {
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
function refreshNotifDotFrom(items) {
  const hasUnread = items.some((n) => !n.read);
  document.getElementById("notifDot").classList.toggle("hidden", !hasUnread);
}
async function refreshNotifDot() {
  try {
    const { items } = await Api.getNotifications();
    refreshNotifDotFrom(items);
  } catch { /* non-critical */ }
}
refreshNotifDot();

// ---------------------------------------------------------------------------
// Admin: manage collection (add / edit / delete)
// ---------------------------------------------------------------------------
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
  document.getElementById("bookFormError").classList.add("hidden");
  document.getElementById("genreList").innerHTML = ALL_GENRES.map((g) => `<option value="${g}">`).join("");
  bookModal.classList.remove("hidden");
}
document.getElementById("openAddBookBtn").addEventListener("click", () => openBookModal());
document.getElementById("closeBookModal").addEventListener("click", () => bookModal.classList.add("hidden"));
document.getElementById("cancelBookModal").addEventListener("click", () => bookModal.classList.add("hidden"));

bookForm.addEventListener("submit", async (e) => {
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
  };
  try {
    if (id) await Api.updateBook(id, payload);
    else await Api.addBook(payload);
    bookModal.classList.add("hidden");
    toast(id ? "Book updated." : "Book added to the catalog.");
    genreFilterPopulated = false;
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
    const { items } = await Api.listBooks({});
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
      btn.addEventListener("click", () => openBookModal(state.books.concat(items).find((b) => b.id === btn.dataset.edit)))
    );
    document.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this book from the catalog?")) return;
        await Api.deleteBook(btn.dataset.delete);
        toast("Book removed.");
        loadManageTable();
        genreFilterPopulated = false;
        loadBooks();
      })
    );
    loadAdminPanels();
  } catch (err) {
    toast(err.message || "Could not load the collection.");
  }
}

async function loadAdminPanels() {
  try {
    const [{ items: pendingUsers }, { items: overdueLoans }] = await Promise.all([
      Api.listPendingUsers(),
      Api.getOverdueLoans(),
    ]);

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
    const overdueElHtml = overdueLoans.length
      ? overdueLoans.map((loan) => `
        <div class="rounded border border-rust/20 bg-rust/5 p-3">
          <p class="font-medium text-ink">${escapeHtml(loan.userName)} — ${escapeHtml(loan.bookTitle)}</p>
          <p class="text-xs font-mono text-charcoal/50">Due ${escapeHtml(loan.due_date)} · not returned</p>
          <div class="mt-2 flex items-center justify-between">
            <div class="text-xs text-charcoal/60">Overdue days: ${escapeHtml(String(loan.days_overdue || '—'))} · Fine: ${loan.fine ? ('$' + Number(loan.fine).toFixed(2)) : '—'}</div>
            <button data-charge="${loan.userId}" data-amount="${loan.fine || ''}" class="text-xs font-mono bg-ink text-parchment px-3 py-1.5 rounded hover:bg-ink/90">Charge fine</button>
          </div>
        </div>`).join("")
      : `<p class="text-sm text-charcoal/50">No overdue loans right now.</p>`;
    overdueList.innerHTML = overdueElHtml;
    overdueList.querySelectorAll('[data-charge]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = btn.dataset.charge;
        const amount = btn.dataset.amount || '';
        document.getElementById('fineUserId').value = userId;
        document.getElementById('fineAmount').value = amount;
        document.getElementById('fineReason').value = 'Overdue fine';
        document.getElementById('fineModal').classList.remove('hidden');
      });
    });
  } catch (err) {
    document.getElementById("pendingUsersList").innerHTML = `<p class="text-sm text-rust">${escapeHtml(err.message || "Could not load admin panels.")}</p>`;
    document.getElementById("overdueList").innerHTML = "";
  }
}
