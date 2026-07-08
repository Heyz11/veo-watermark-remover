# Claude Design — Komponen (Copy & Paste)

Snippet komponen biasa dalam gaya Claude-style.
Semua guna Tailwind + utilities dari `claude-style.css`.

---

## Badge Status (live dot)
```html
<div class="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-green-200 bg-green-50 text-green-700 text-sm font-semibold">
    <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse block"></span>
    Teks badge di sini
</div>
```

---

## Headline dengan accent serif italic
```html
<h1 class="hero-title text-3xl lg:text-7xl text-gray-900">
    Tajuk <em class="heading-serif-accent heading-gradient-accent">Menarik</em> Di Sini
</h1>
```
Untuk underline gradient pada satu perkataan:
```html
<span class="relative inline-block">Laju<span class="absolute left-0 -bottom-1 w-full h-1.5 rounded-full" style="background:linear-gradient(90deg,#14B8A6,#FBBF24);"></span></span>
```

---

## Butang utama (gradient + lift)
```html
<a href="#" class="inline-flex items-center gap-2 px-7 py-4 rounded-xl font-bold text-white text-base transition-all duration-300 hover:-translate-y-1" style="background:#14B8A6;box-shadow:0 4px 20px rgba(20,184,166,0.35);">
    Butang Utama
</a>
```

## Butang sekunder (outline)
```html
<a href="#" class="inline-flex items-center gap-2 px-7 py-4 rounded-xl font-semibold text-gray-800 text-base border-2 border-gray-200 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-all duration-300">
    Butang Kedua
</a>
```

---

## Kad melayang (floating card)
```html
<div class="relative animate-float-hero">
    <div class="absolute inset-0 rounded-3xl" style="background:radial-gradient(circle at 50% 50%,rgba(20,184,166,0.15),transparent 70%);transform:scale(1.3);"></div>
    <div class="relative bg-white rounded-3xl p-8 w-full max-w-sm shadow-soft">
        <div class="text-xs font-bold text-brand-500 tracking-widest uppercase mb-1">Label</div>
        <div class="font-display font-bold text-2xl text-gray-900 mb-4">Tajuk Kad</div>
        <p class="body-premium text-sm text-gray-500 mb-6">Kandungan kad.</p>
        <a href="#" class="block w-full text-center py-4 rounded-xl font-bold text-white" style="background:linear-gradient(135deg,#14B8A6,#0D9488);box-shadow:0 4px 16px rgba(20,184,166,0.3);">CTA</a>
    </div>
</div>
```

---

## Bento grid (3 kolum)
```html
<div class="grid grid-cols-1 md:grid-cols-3 gap-4 reveal">
    <div class="bg-white rounded-2xl p-7 shadow-soft-sm">
        <div class="text-3xl mb-3">✨</div>
        <h3 class="font-display font-bold text-gray-900 mb-1">Tajuk</h3>
        <p class="body-premium text-slate-500 text-sm">Penerangan.</p>
    </div>
    <!-- ulang untuk kad lain -->
</div>
```

---

## Kad testimoni (dengan quote besar)
```html
<div class="relative bg-white rounded-3xl p-8 overflow-hidden shadow-soft-sm">
    <span class="absolute select-none pointer-events-none" style="top:-0.15em;left:0.1em;font-family:'Cormorant Garamond',Georgia,serif;font-size:7rem;line-height:1;color:#99f6e4;opacity:0.5;">&ldquo;</span>
    <div class="relative z-10">
        <div class="text-yellow-400 text-sm mb-4">★★★★★</div>
        <p class="text-gray-800 font-semibold leading-relaxed mb-6">Petikan testimoni di sini.</p>
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-sm">AB</div>
            <div>
                <p class="font-bold text-gray-900 text-sm">Nama Orang</p>
                <p class="text-gray-400 text-xs">Jawatan / Lokasi</p>
            </div>
        </div>
    </div>
</div>
```

---

## Tajuk section (label + heading)
```html
<div class="text-center mb-14 reveal">
    <span class="inline-block text-xs font-bold text-brand-500 tracking-widest uppercase mb-3 section-heading">Label Section</span>
    <h2 class="section-heading text-3xl md:text-5xl text-gray-900">Tajuk <em class="heading-serif-accent">Section</em></h2>
    <p class="body-premium text-slate-500 text-lg max-w-xl mx-auto mt-2">Ayat sokongan.</p>
</div>
```

---

## Marquee ticker
```html
<div class="w-full bg-brand-500 overflow-hidden py-3 border-y border-brand-600">
    <div class="animate-marquee-container flex items-center">
        <div class="flex items-center justify-around w-1/2 min-w-max shrink-0 text-white font-display font-bold uppercase tracking-widest text-sm px-4">
            <span>🚀 Item Satu</span><span class="text-yellow-300 mx-4">•</span>
            <span>✅ Item Dua</span><span class="text-yellow-300 mx-4">•</span>
        </div>
        <!-- Duplicate blok sama sekali lagi untuk loop seamless -->
        <div class="flex items-center justify-around w-1/2 min-w-max shrink-0 text-white font-display font-bold uppercase tracking-widest text-sm px-4">
            <span>🚀 Item Satu</span><span class="text-yellow-300 mx-4">•</span>
            <span>✅ Item Dua</span><span class="text-yellow-300 mx-4">•</span>
        </div>
    </div>
</div>
```

---

## Section gelap (gradient + dot pattern)
```html
<section class="py-24 text-white px-4 relative overflow-hidden" style="background-color:#172554;">
    <div class="absolute inset-0 opacity-10" style="background-image:radial-gradient(#14b8a6 2px,transparent 2px);background-size:30px 30px;"></div>
    <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-600 rounded-full mix-blend-screen filter blur-[100px] opacity-50"></div>
    <div class="max-w-6xl mx-auto relative z-10">
        <!-- kandungan -->
    </div>
</section>
```

---

## FAQ accordion (perlu sedikit JS)
```html
<div class="faq-item bg-white border border-gray-200 rounded-2xl overflow-hidden">
    <button class="faq-btn w-full text-left px-6 py-5 flex items-center justify-between font-bold text-lg hover:bg-slate-50">
        <span>Soalan di sini?</span>
        <svg class="w-6 h-6 text-brand-600 transition-transform icon-plus pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
    </button>
    <div class="faq-content max-h-0 overflow-hidden transition-all duration-300 px-6">
        <p class="pb-5 pt-2 text-gray-600">Jawapan di sini.</p>
    </div>
</div>
```
JS:
```js
document.querySelectorAll('.faq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const content = btn.nextElementSibling;
        const icon = btn.querySelector('.icon-plus');
        if (content.style.maxHeight) {
            content.style.maxHeight = null;
            icon.style.transform = 'rotate(0deg)';
        } else {
            content.style.maxHeight = content.scrollHeight + 'px';
            icon.style.transform = 'rotate(45deg)';
        }
    });
});
```
