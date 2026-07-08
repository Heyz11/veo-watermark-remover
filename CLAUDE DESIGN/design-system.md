# Claude Design System

Rujukan reka bentuk "Claude-style" untuk projek website lain.
Copy fail dalam folder ni ke projek baru, atau guna sebagai panduan.

---

## 1. Falsafah Reka Bentuk

Gaya ni warm, tenang, premium tapi tak bising. Ciri utama:

- **Latar krim**, bukan putih tajam. Bagi rasa lembut & mahal.
- **Grain texture** halus di atas segala-galanya untuk "depth".
- **Gradient mesh blobs** kabur di belakang hero / section penting.
- **Bento grid** asimetri untuk susun maklumat.
- **Typography campuran**: sans-serif tajam + serif italic untuk accent.
- **Soft shadow berlapis**, bukan satu shadow keras.
- **Sudut bulat besar** (rounded-2xl hingga rounded-[2rem]).

---

## 2. Warna

### Asas (Neutral)
| Guna | Hex | Nota |
|------|-----|------|
| Latar utama | `#FAF9F6` | Krim. Background body & kebanyakan section. |
| Latar section gelap | `#0f172a` -> `#1e3a5f` | Gradient untuk kad feature gelap. |
| Teks utama | `#111827` (gray-900) | Headline. |
| Teks badan | `#6B7280` (gray-500) | Perenggan. |
| Teks lembut | `#9CA3AF` (gray-400) | Caption, label kecil. |
| Garis/border | `#E5E7EB` (gray-200) | Pemisah halus. |

### Brand (tukar ikut projek)
Contoh projek BeONE guna teal. Tukar nilai ni untuk brand lain.
| Token | Hex |
|-------|-----|
| brand-50 | `#f0fdfa` |
| brand-100 | `#ccfbf1` |
| brand-400 | `#2dd4bf` |
| brand-500 | `#14b8a6` (warna utama) |
| brand-600 | `#0d9488` |
| brand-700 | `#0f766e` |
| brand-800 | `#1e3a8a` |
| brand-900 | `#172554` |

### Accent
| Guna | Hex |
|------|-----|
| Highlight kuning | `#FBBF24` / `#FACC15` |
| Hijau jaya | `#22C55E` / `#4ADE80` |
| Merah amaran | `#EF4444` |

---

## 3. Typography

Font dari Google Fonts:
- **Space Grotesk** — headline & display. Tajam, tight letter-spacing.
- **Plus Jakarta Sans** — teks badan. Relaxed, mudah baca.
- **Cormorant Garamond** (italic) — accent serif untuk perkataan tertentu dalam headline.
- **JetBrains Mono** — badge / tag kecil (optional).

### Skala
| Elemen | Saiz | Berat | Tracking |
|--------|------|-------|----------|
| Hero H1 | text-3xl -> lg:text-7xl | 700 | -0.025em |
| Section H2 | text-3xl -> md:text-5xl | 700 | -0.02em |
| Kad H3 | text-xl -> text-2xl | 700 | normal |
| Badan | text-base -> text-lg | 400 | line-height 1.75 |
| Label kecil | text-xs uppercase | 700 | 0.12em |

### Teknik accent serif
Bungkus perkataan dalam headline dengan serif italic + gradient:
```html
<h1 class="hero-title">
  Simkad <em class="heading-serif-accent heading-gradient-accent">Murah</em>
</h1>
```

---

## 4. Spacing & Layout

- Container utama: `max-w-7xl mx-auto px-6` (atau max-w-5xl/6xl ikut section).
- Padding section: `py-20` hingga `py-24`.
- Gap grid: `gap-4` (bento rapat) hingga `gap-8` (langkah-langkah).
- Sudut bulat: kad kecil `rounded-2xl`, kad besar `rounded-[2rem]`, butang `rounded-xl`/`rounded-full`.

---

## 5. Shadow (berlapis, lembut)

Jangan guna satu shadow keras. Guna kombinasi:
```css
box-shadow: 0 4px 6px rgba(0,0,0,0.04),
            0 24px 60px rgba(0,0,0,0.1),
            0 0 0 1px rgba(0,0,0,0.04);
```
Untuk butang brand:
```css
box-shadow: 0 4px 20px rgba(20,184,166,0.35);
```

---

## 6. Motion

- Scroll reveal: fade + naik 40px (`.reveal`).
- Float lembut pada kad hero (5-6s ease-in-out).
- Marquee ticker mendatar.
- Hover: `-translate-y-1` + shadow naik.
- Gradient text shimmer (4s loop).
- Semua transition guna cubic-bezier(0.165, 0.84, 0.44, 1) untuk rasa premium.

---

## 7. Cara Guna Dalam Projek Baru

1. Copy seluruh folder `CLAUDE DESIGN` ke projek baru, atau copy fail yang perlu.
2. Mula dari `starter.html` — dah ada Tailwind CDN, fonts, config warna brand, grain overlay.
3. Link `claude-style.css` untuk utilities (grain, reveal, accent serif, dll).
4. Rujuk `components.md` untuk copy snippet komponen (kad, butang, badge, bento).
5. Tukar nilai warna `brand` dalam config Tailwind ikut brand projek baru.
