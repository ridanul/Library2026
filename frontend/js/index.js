		const UserNav = document.getElementById("userNav");
		const GuestNav = document.getElementById("guestNav");
		const headerContent = document.getElementById("headerContent");
		const token = localStorage.getItem('lib_token');
		if (token) {
			GuestNav.classList.add("hidden");
			UserNav.classList.remove("hidden");
			headerContent.classList.remove("flex-col");
		} else {
			GuestNav.classList.remove("hidden");
			UserNav.classList.add("hidden");
			headerContent.classList.add("flex-col");
		}
		let currentSlide = 0;
		const slides = document.querySelectorAll('.carousel-slide');

		function showSlide(n) {
			slides.forEach(slide => slide.classList.remove('active'));
			currentSlide = (n + slides.length) % slides.length;
			slides[currentSlide].classList.add('active');
		}

		function changeSlide(direction) {
			showSlide(currentSlide + direction);
		}

		document.getElementById('landingSearch').addEventListener('submit', (e) => {
			e.preventDefault();
			const q = document.getElementById('landingQuery').value.trim();
			if (!q) return;
			window.location.href = `dashboard.html?q=${encodeURIComponent(q)}`;
		});