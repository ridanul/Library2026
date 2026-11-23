/* =========================================================
   KIU LIBRARY HOMEPAGE JS
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    /* =====================================================
       LIBRARY SEARCH
       ===================================================== */

    const searchForm = document.getElementById("landingSearch");
    const searchInput = document.getElementById("landingQuery");

    function performSearch(query) {

        query = String(query || "").trim();

        if (!query) {
            searchInput.focus();
            return;
        }

        /*
         * Your existing dashboard already supports:
         *
         * dashboard.html?q=SEARCH_TERM
         *
         * So we keep that flow instead of creating
         * another search system.
         */

        window.location.href =
            `dashboard.html?q=${encodeURIComponent(query)}`;
    }


    searchForm?.addEventListener("submit", (event) => {

        event.preventDefault();

        performSearch(searchInput.value);

    });


    /* =====================================================
       SEARCH SUGGESTIONS
       ===================================================== */

    document.querySelectorAll("[data-search]").forEach((button) => {

        button.addEventListener("click", () => {

            const query = button.dataset.search || "";

            searchInput.value = query;

            performSearch(query);

        });

    });


    /* =====================================================
       MOBILE NAVIGATION
       ===================================================== */

    const mobileMenuBtn =
        document.getElementById("mobileMenuBtn");

    const mainNav =
        document.getElementById("mainNav");


    mobileMenuBtn?.addEventListener("click", () => {

        mainNav?.classList.toggle("open");

    });


    /*
     * Close mobile navigation after clicking
     * an internal navigation link.
     */

    mainNav?.querySelectorAll("a").forEach((link) => {

        link.addEventListener("click", () => {

            mainNav.classList.remove("open");

        });

    });


    /* =====================================================
       LIBRARY OPEN/CLOSED STATUS
       ===================================================== */

    updateLibraryStatus();

});


/* =========================================================
   LIBRARY STATUS
   ========================================================= */

function updateLibraryStatus() {

    const statusElement =
        document.getElementById("openStatus");

    if (!statusElement) {
        return;
    }


    const now = new Date();

    const day = now.getDay();

    const hours = now.getHours();

    const minutes = now.getMinutes();

    const currentMinutes =
        hours * 60 + minutes;


    /*
     * JavaScript:
     *
     * 0 = Sunday
     * 1 = Monday
     * 2 = Tuesday
     * 3 = Wednesday
     * 4 = Thursday
     * 5 = Friday
     * 6 = Saturday
     *
     * Current library schedule:
     *
     * Saturday-Wednesday
     * 9:00 AM - 5:00 PM
     *
     * Lunch & Prayer Break
     * 1:30 PM - 3:00 PM
     *
     * Thursday-Friday
     * Closed
     */


    const isRegularDay =
        day === 0 ||
        day === 1 ||
        day === 2 ||
        day === 3 ||
        day === 6;


    let isOpen = false;


    if (isRegularDay) {

        const openingTime = 9 * 60;

        const closingTime = 17 * 60;

        const breakStart = 13 * 60 + 30;

        const breakEnd = 15 * 60;


        if (
            currentMinutes >= openingTime &&
            currentMinutes < closingTime &&
            !(
                currentMinutes >= breakStart &&
                currentMinutes < breakEnd
            )
        ) {

            isOpen = true;

        }

    }


    const dot =
        statusElement.querySelector("span");

    const text =
        statusElement.querySelector("strong");


    if (isOpen) {

        if (dot) {
            dot.style.background = "#58c27d";
        }

        if (text) {
            text.textContent = "Open today";
        }

    } else {

        if (dot) {
            dot.style.background = "#d36b5d";
        }

        if (text) {
            text.textContent = "Currently closed";
        }

    }

}
/* =========================================================
   KNOWLEDGE · INFORMATION · UNDERSTANDING
========================================================= */

const brandInfo = {
    knowledge: {
        title: "Knowledge",
        content: `
            <p>
                Knowledge is the foundation of learning and research.
                KIU Library provides students and researchers with access
                to books, journals, and academic resources.
            </p>
        `,
        button: "Search the Catalog →",
        action: () => {
            document.getElementById("catalog")?.scrollIntoView({
                behavior: "smooth"
            });
        }
    },

    information: {
        title: "Information",
        content: `
            <p>
                KIU Library connects students and researchers with
                reliable academic information.
            </p>

            <ul>
                <li>Books and academic texts</li>
                <li>E-journals</li>
                <li>E-books</li>
                <li>Research materials</li>
            </ul>
        `,
        button: "Explore Resources →",
        action: () => {
            document.getElementById("resources")?.scrollIntoView({
                behavior: "smooth"
            });
        }
    },

    understanding: {
        title: "Understanding",
        content: `
            <p>
                The library provides an environment where information
                can become knowledge and support academic learning.
            </p>
        `,
        button: "Explore Library Services →",
        action: () => {
            document.getElementById("services")?.scrollIntoView({
                behavior: "smooth"
            });
        }
    }
};

/* =========================================================
   MODAL ELEMENTS
========================================================= */

const brandModal =
    document.getElementById("brandInfoModal");

const brandModalTitle =
    document.getElementById("brandModalTitle");

const brandModalContent =
    document.getElementById("brandModalContent");

const brandModalAction =
    document.getElementById("brandModalAction");

const closeBrandModal =
    document.getElementById("closeBrandModal");

const brandModalOverlay =
    document.getElementById("brandModalOverlay");


let currentBrandAction = null;


/* =========================================================
   OPEN MODAL
========================================================= */

document
    .querySelectorAll("[data-info]")
    .forEach((button) => {

        button.addEventListener("click", () => {

            const type = button.dataset.info;

            const info = brandInfo[type];

            if (!info) {
                return;
            }


            brandModalTitle.textContent =
                info.title;

            brandModalContent.innerHTML =
                info.content;

            brandModalAction.textContent =
                info.button;

            currentBrandAction =
                info.action;


            brandModal.classList.remove("hidden");

            document.body.style.overflow = "hidden";

        });

    });


/* =========================================================
   CLOSE MODAL
========================================================= */

function closeBrandInformation() {

    brandModal.classList.add("hidden");

    document.body.style.overflow = "";

    currentBrandAction = null;

}


closeBrandModal?.addEventListener(
    "click",
    closeBrandInformation
);


brandModalOverlay?.addEventListener(
    "click",
    closeBrandInformation
);


/* =========================================================
   MODAL ACTION BUTTON
========================================================= */

// brandModalAction?.addEventListener(
//     "click",
//     () => {

//         const action = currentBrandAction;
//         closeBrandInformation();
//         if (action) {
//             action();
//         }

//     }
// );


/* =========================================================
   ESC KEY
========================================================= */

document.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Escape" &&
            !brandModal.classList.contains("hidden")
        ) {

            closeBrandInformation();

        }

    }
);
/* =========================================================
   AUTH NAVIGATION
========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    const authNavLink =
        document.getElementById("authNavLink");

    if (!authNavLink) {
        return;
    }

    if (Auth.isLoggedIn()) {

        authNavLink.textContent = "Dashboard";
        authNavLink.href = "dashboard.html";

    } else {

        authNavLink.textContent = "Sign in";
        authNavLink.href = "login.html";

    }

});
