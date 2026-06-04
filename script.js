/* ═══════════════════════════════════════════════════════
   Poznań — Miasto Przygód  |  script.js
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ── CONFIG ─────────────────────────────────────────────── */
const MAP_IMAGE_URL   = 'Gemini_Generated_Image_x9xd3px9xd3px9xd.png';
const MAP_BOUNDS      = [[0, 0], [1000, 1500]];
const DATA_URL        = 'data.json';

/* ── CATEGORY COLOUR MAP ─────────────────────────────────── */
const CATEGORY_COLORS = {
  'Architektura':      '#c8813a',
  'Przestrzeń Miejska':'#7a5c38',
  'Sakralne':          '#c0392b',
  'Zabytki':           '#6d4c41',
  'Kultura':           '#5d6d3a',
  'Muzyka':            '#9b59b6',
  'Teatr & Opera':     '#8e44ad',
  'Przyroda':          '#3a7a5c',
  'Nauka':             '#2980b9',
  'Historia':          '#a07850',
};

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#c8813a';
}

/* ── SVG PIN FACTORY ─────────────────────────────────────── */
function createPinSVG(color = '#c8813a') {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
  <defs>
    <filter id="shadow-${color.slice(1)}" x="-30%" y="-10%" width="160%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(20,12,4,.45)"/>
    </filter>
  </defs>
  <!-- Body -->
  <path class="pin-body"
    d="M18 2C10.27 2 4 8.27 4 16c0 11 14 29.5 14 29.5S32 27 32 16C32 8.27 25.73 2 18 2Z"
    fill="${color}"
    filter="url(#shadow-${color.slice(1)})"
  />
  <!-- Inner circle -->
  <circle cx="18" cy="16" r="7" fill="rgba(255,255,255,0.22)" class="pin-icon"/>
  <circle cx="18" cy="16" r="4.5" fill="rgba(255,255,255,0.75)" class="pin-icon"/>
</svg>`.trim();
}

/* ── MAP INIT ────────────────────────────────────────────── */
const map = L.map('map', {
  crs:              L.CRS.Simple,
  minZoom:         -1.5,
  maxZoom:          3,
  zoom:             0,
  center:           [500, 750],
  maxBounds:        [[-150, -200], [1150, 1700]],
  maxBoundsViscosity: 0.85,
  zoomControl:      true,
  attributionControl: true,
});

/* Position zoom control bottom-right */
map.zoomControl.setPosition('bottomright');

/* Image overlay */
const imageOverlay = L.imageOverlay(MAP_IMAGE_URL, MAP_BOUNDS, {
  attribution: '© Poznań — Miasto Przygód',
}).addTo(map);

map.fitBounds(MAP_BOUNDS, { padding: [20, 20] });

/* ── STATE ───────────────────────────────────────────────── */
let swiperInstance = null;
let currentLocation = null;

/* ── DOM REFS ────────────────────────────────────────────── */
const overlay     = document.getElementById('modal-overlay');
const panel       = document.getElementById('modal-panel');
const closeBtn    = document.getElementById('modal-close');
const titleEl     = document.getElementById('modal-title');
const categoryEl  = document.getElementById('modal-category');
const descEl      = document.getElementById('modal-description');
const coordsEl    = document.getElementById('modal-coords');
const swiperWrap  = document.getElementById('swiper-wrapper');
const galCurrent  = document.getElementById('gallery-current');
const galTotal    = document.getElementById('gallery-total');
const loadScreen  = document.getElementById('loading-screen');

/* ── FETCH DATA ──────────────────────────────────────────── */
async function loadData() {
  try {
    const res  = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderMarkers(data);
    dismissLoadingScreen();
  } catch (err) {
    console.error('Błąd ładowania danych:', err);
    dismissLoadingScreen();
    showDataError();
  }
}

/* ── MARKERS ─────────────────────────────────────────────── */
function renderMarkers(locations) {
  locations.forEach(loc => {
    const color = getCategoryColor(loc.category);

    /* Leaflet coordinate system for imageOverlay:
       image pixel (x, y) → L.latLng(y_inverted, x)
       Since bounds are [[0,0],[1000,1500]], lat = y from top (1000-y), lng = x */
    const lat = 1000 - loc.y;
    const lng = loc.x;

    const icon = L.divIcon({
      html: `<div class="custom-pin" role="button" tabindex="0" aria-label="${loc.title}">${createPinSVG(color)}</div>`,
      iconSize:   [36, 48],
      iconAnchor: [18, 48],
      className:  '',
    });

    const marker = L.marker([lat, lng], { icon, title: loc.title })
      .addTo(map)
      .bindTooltip(loc.title, {
        permanent: false,
        direction: 'top',
        offset:    [0, -44],
        opacity:   1,
      });

    marker.on('click', () => openModal(loc));

    /* Keyboard accessibility */
    marker.on('add', () => {
      const el = marker.getElement();
      if (el) {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openModal(loc);
          }
        });
      }
    });
  });
}

/* ── MODAL ───────────────────────────────────────────────── */
function openModal(loc) {
  currentLocation = loc;

  /* Populate text */
  titleEl.textContent       = loc.title;
  categoryEl.textContent    = loc.category;
  descEl.textContent        = loc.description;
  coordsEl.textContent      = `POZ ${loc.x.toString().padStart(4,'0')} · ${loc.y.toString().padStart(4,'0')}`;

  /* Category accent color */
  const color = getCategoryColor(loc.category);
  categoryEl.style.color       = color;
  categoryEl.style.background  = `${color}18`;
  categoryEl.style.borderColor = `${color}40`;

  /* Build gallery slides */
  swiperWrap.innerHTML = '';
  const images = loc.images || [];
  images.forEach((src, i) => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';
    const img = document.createElement('img');
    img.src   = src;
    img.alt   = `${loc.title} — zdjęcie ${i + 1}`;
    img.loading = 'lazy';
    slide.appendChild(img);
    swiperWrap.appendChild(slide);
  });

  galTotal.textContent = images.length;
  galCurrent.textContent = 1;

  /* Destroy old Swiper before re-init */
  if (swiperInstance) {
    swiperInstance.destroy(true, true);
    swiperInstance = null;
  }

  /* Show modal first so Swiper can calc dimensions */
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  /* Init Swiper after paint */
  requestAnimationFrame(() => {
    swiperInstance = new Swiper('.modal-swiper', {
      loop:           images.length > 1,
      speed:          500,
      effect:         'fade',
      fadeEffect:     { crossFade: true },
      navigation:     {
        prevEl: '.swiper-button-prev',
        nextEl: '.swiper-button-next',
      },
      pagination:     {
        el: '.swiper-pagination',
        clickable: true,
      },
      on: {
        slideChange() {
          galCurrent.textContent = this.realIndex + 1;
        },
      },
    });
  });

  /* Focus close button for a11y */
  requestAnimationFrame(() => closeBtn.focus());
}

function closeModal() {
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  currentLocation = null;
}

/* ── CLOSE TRIGGERS ──────────────────────────────────────── */
closeBtn.addEventListener('click', closeModal);

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
    closeModal();
  }
});

/* Prevent panel click from closing overlay */
panel.addEventListener('click', (e) => e.stopPropagation());

/* ── LOADING SCREEN ──────────────────────────────────────── */
function dismissLoadingScreen() {
  /* Wait for animation (1.4s) to finish before hiding */
  setTimeout(() => {
    loadScreen.classList.add('is-gone');
    loadScreen.addEventListener('transitionend', () => {
      loadScreen.style.display = 'none';
    }, { once: true });
  }, 1500);
}

function showDataError() {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = `
    position:fixed; inset:0; z-index:5000;
    display:flex; align-items:center; justify-content:center;
    background:rgba(26,17,8,.9); color:#f5efe3;
    font-family:'Playfair Display',serif; text-align:center; padding:24px;
  `;
  errDiv.innerHTML = `
    <div>
      <p style="font-size:42px;margin-bottom:8px;">⚠</p>
      <h2 style="font-size:22px;margin-bottom:10px;">Błąd ładowania danych</h2>
      <p style="font-size:14px;color:rgba(245,239,227,.6);max-width:320px;margin:0 auto;">
        Upewnij się, że plik <code>data.json</code> znajduje się obok pliku
        <code>index.html</code> i że strona jest serwowana przez lokalny serwer
        (np. <code>npx serve .</code>).
      </p>
    </div>
  `;
  document.body.appendChild(errDiv);
}

/* ── INIT ────────────────────────────────────────────────── */
loadData();
