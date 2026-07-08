// ============================================
//  CLAUDE DESIGN — reveal.js
//  Scroll reveal + scroll progress bar.
//  Cukup link <script src="reveal.js"></script> sebelum </body>.
// ============================================

document.addEventListener('DOMContentLoaded', () => {

    // ---- Scroll progress bar ----
    const scrollProgress = document.getElementById('scroll-progress');
    if (scrollProgress) {
        window.addEventListener('scroll', () => {
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = height > 0 ? (window.scrollY / height) * 100 : 0;
            scrollProgress.style.width = scrolled + '%';
        });
    }

    // ---- Scroll reveal (fade + naik) ----
    const revealEls = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
    if (revealEls.length) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) entry.target.classList.add('active');
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

        revealEls.forEach(el => observer.observe(el));
    }

});
