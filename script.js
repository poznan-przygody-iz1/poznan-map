/* ═══════════════════════════════════════════════════════════
   POZNAŃ — MIASTO PRZYGÓD
   Interaktywny przewodnik: mapa, kategorie, lista miejsc,
   własna trasa (ulubione), pogoda, ciemny motyw.
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ── KONFIGURACJA ──────────────────────────────────────────── */

const DATA_URL   = 'data.json';
const STORE_KEY  = 'poznan.favorites'; // uporządkowana lista id (kolejność trasy)
const THEME_KEY  = 'poznan.theme';     // 'light' | 'dark'
const HINT_KEY   = 'poznan.hint-shown';

const CATEGORY_COLORS = {
  'Architektura':       '#c8813a',
  'Przestrzeń Miejska': '#7a5c38',
  'Sakralne':           '#c0392b',
  'Zabytki':            '#6d4c41',
  'Kultura':            '#5d6d3a',
  'Muzyka':             '#9b59b6',
  'Teatr & Opera':      '#8e44ad',
  'Przyroda':           '#3a7a5c',
  'Nauka':              '#2980b9',
  'Historia':           '#a07850',
};
const DEFAULT_COLOR = '#c8813a';
const colorOf = (category) => CATEGORY_COLORS[category] || DEFAULT_COLOR;

/* ── STAN GLOBALNY ─────────────────────────────────────────── */

const state = {
  locations: [],
  markers: new Map(),      // id -> L.Marker
  activeCategory: 'all',
  favorites: loadFavorites(),
  userMarker: null,
  routeLayer: null,
  swiper: null,
  currentId: null,
  dataReady: false,
};

/* ── POMOCNICY DOM ─────────────────────────────────────────── */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const dom = {
  sidebar:       $('#sidebar'),
  menuToggle:    $('#menu-toggle'),
  sidebarClose:  $('#sidebar-close'),
  searchInput:   $('#search-input'),
  searchResults: $('#search-results'),
  catChips:      $('#sidebar-categories'),
  placeList:     $('#place-list'),
  listCount:     $('#list-count'),
  routeCard:     $('#route-card'),
  routeCount:    $('#route-count'),
  routeSteps:    $('#route-steps'),
  routeMapBtn:   $('#route-map-btn'),
  routeGmaps:    $('#route-gmaps-link'),
  overlay:       $('#modal-overlay'),
  panel:         $('#modal-panel'),
  modalClose:    $('#modal-close'),
  modalFav:      $('#modal-fav'),
  title:         $('#modal-title'),
  category:      $('#modal-category'),
  address:       $('#modal-address'),
  description:   $('#modal-description'),
  coords:        $('#modal-coords'),
  pdfLink:       $('#modal-pdf'),
  gmapsLink:     $('#modal-gmaps'),
  swiperWrap:    $('#swiper-wrapper'),
  galCurrent:    $('#gallery-current'),
  galTotal:      $('#gallery-total'),
  loadScreen:    $('#loading-screen'),
  toast:         $('#toast'),
  themeToggle:   $('#theme-toggle'),
  weatherIcon:   $('#weather-icon'),
  weatherTemp:   $('#weather-temp'),
  weatherDesc:   $('#weather-desc'),
  weatherWind:   $('#weather-wind'),
};

/* ── UTILS ─────────────────────────────────────────────────── */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function byId(id) {
  return state.locations.find((loc) => loc.id === id);
}

/* ── ULUBIONE (localStorage) ───────────────────────────────── */

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveFavorites() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.favorites)); } catch { /* prywatny tryb */ }
}

function favoriteLocations() {
  return state.favorites.map(byId).filter(Boolean);
}

function toggleFavorite(id) {
  const index = state.favorites.indexOf(id);
  const wasFav = index !== -1;
  if (wasFav) state.favorites.splice(index, 1);
  else state.favorites.push(id);
  saveFavorites();

  const loc = byId(id);
  if (loc) {
    showToast(wasFav ? `«${loc.title}» usunięto z Twojej trasy` : `«${loc.title}» dodano do Twojej trasy`);
  }
  updateRouteCard();
  renderPlaceList();
  if (state.currentId === id) syncModalFav();
}

/* ── MAPA ──────────────────────────────────────────────────── */

const map = L.map('map', {
  center: [52.4064, 16.9252],
  zoom: 14,
  minZoom: 12,
  maxZoom: 18,
  zoomControl: false,
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

/* Kafelki OpenStreetMap – działają bez klucza API.
   Ciemny motyw realizowany jest w CSS (filter na .leaflet-tile). */
const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  subdomains: 'abc',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const markerGroup = L.layerGroup().addTo(map);

/* ── GEOLOKACJA ("GDZIE JESTEM?") ─────────────────────────── */

const locateControl = L.control({ position: 'bottomright' });

locateControl.onAdd = function () {
  const btn = L.DomUtil.create('button', 'locate-btn');
  btn.type = 'button';
  btn.innerHTML = '🧭 Gdzie jestem?';
  btn.title = 'Pokaż moją lokalizację';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    btn.textContent = '⏳ Szukam…';
    map.locate({ setView: true, maxZoom: 16 });
  });
  return btn;
};
locateControl.addTo(map);

map.on('locationfound', (e) => {
  const btn = $('.locate-btn');
  if (btn) btn.textContent = '🧭 Gdzie jestem?';

  const icon = L.divIcon({
    html: '<div class="user-dot"></div>',
    className: 'user-marker',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  if (state.userMarker) {
    state.userMarker.setLatLng(e.latlng);
  } else {
    state.userMarker = L.marker(e.latlng, { icon, zIndexOffset: 900 })
      .addTo(map)
      .bindTooltip('Jesteś tutaj', { direction: 'top', offset: [0, -12] });
  }
});

map.on('locationerror', () => {
  const btn = $('.locate-btn');
  if (btn) btn.textContent = '🧭 Gdzie jestem?';
  showToast('Nie udało się ustalić lokalizacji. Sprawdź dostęp do GPS w przeglądarce.', 'error');
});

/* ── TOAST ─────────────────────────────────────────────────── */

let toastTimer = null;

function showToast(message, type = 'info') {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.className = `toast is-visible${type === 'error' ? ' toast-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.className = 'toast'; }, 4200);
}

/* ── ŁADOWANIE DANYCH ──────────────────────────────────────── */

async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()).filter(
      (loc) => loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
    );
    if (!data.length) throw new Error('Pusta lista miejsc');

    state.locations = data;
    state.dataReady = true;

    renderMarkers(data);
    renderFilters(data);
    renderPlaceList();
    updateRouteCard();
    initSearch();
    dismissLoadingScreen();
    maybeShowHint();
  } catch (err) {
    console.error('Błąd ładowania danych:', err);
    dismissLoadingScreen();
    showDataError();
  }
}

/* ── PINY + MARKERy ────────────────────────────────────────── */

let pinUid = 0;

/* Każdy pin dostaje własny id filtra cienia (unikalność w DOM). */
function createPinSVG(color) {
  const uid = `pinShadow${++pinUid}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46" aria-hidden="true">
    <defs>
      <filter id="${uid}" x="-30%" y="-10%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(20,12,4,.45)"/>
      </filter>
    </defs>
    <path class="pin-body" d="M17 2C9.27 2 3 8.27 3 16c0 10.5 14 28.5 14 28.5S31 26.5 31 16C31 8.27 24.73 2 17 2Z"
          fill="${color}" filter="url(#${uid})"/>
    <circle cx="17" cy="16" r="7" fill="rgba(255,255,255,0.22)"/>
    <circle cx="17" cy="16" r="4.5" fill="rgba(255,255,255,0.75)"/>
  </svg>`;
}

function renderMarkers(locations) {
  locations.forEach((loc) => {
    const icon = L.divIcon({
      html: `<div class="custom-pin" role="button" tabindex="0" aria-label="${escapeHtml(loc.title)}">${createPinSVG(colorOf(loc.category))}</div>`,
      iconSize: [34, 46],
      iconAnchor: [17, 46],
      className: '',
    });

    const marker = L.marker([loc.lat, loc.lng], { icon, title: loc.title, riseOnHover: true });
    marker.on('click', () => openModal(loc.id));

    state.markers.set(loc.id, marker);
  });
  applyFilter();
}

function applyFilter() {
  markerGroup.clearLayers();
  state.locations.forEach((loc) => {
    if (state.activeCategory === 'all' || loc.category === state.activeCategory) {
      markerGroup.addLayer(state.markers.get(loc.id));
    }
  });
}

/* ── FILTRY (CHIPY KATEGORII) ──────────────────────────────── */

function renderFilters(locations) {
  if (!dom.catChips) return;

  const counts = new Map();
  locations.forEach((loc) => counts.set(loc.category, (counts.get(loc.category) || 0) + 1));

  let html = `<button type="button" class="chip is-active" data-cat="all" aria-pressed="true">
      <span class="chip-dot" style="background: var(--clr-amber)"></span>
      <span class="chip-name">Wszystkie</span>
      <span class="chip-count">${locations.length}</span>
    </button>`;

  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, n]) => {
      html += `<button type="button" class="chip" data-cat="${escapeHtml(cat)}" aria-pressed="false">
        <span class="chip-dot" style="background: ${colorOf(cat)}"></span>
        <span class="chip-name">${escapeHtml(cat)}</span>
        <span class="chip-count">${n}</span>
      </button>`;
    });

  dom.catChips.innerHTML = html;

  $$('.chip', dom.catChips).forEach((chip) => {
    chip.addEventListener('click', () => {
      state.activeCategory = chip.dataset.cat;
      $$('.chip', dom.catChips).forEach((c) => {
        const active = c === chip;
        c.classList.toggle('is-active', active);
        c.setAttribute('aria-pressed', String(active));
      });
      applyFilter();
      renderPlaceList();
      closeSidebarIfMobile();
    });
  });
}

/* ── LISTA MIEJSC ──────────────────────────────────────────── */

function visibleLocations() {
  return state.locations.filter(
    (loc) => state.activeCategory === 'all' || loc.category === state.activeCategory
  );
}

function placeCountLabel(n) {
  if (n === 1) return '1 miejsce';
  if (n >= 2 && n <= 4) return `${n} miejsca`;
  return `${n} miejsc`;
}

function renderPlaceList() {
  if (!dom.placeList) return;
  const locs = visibleLocations();
  dom.listCount.textContent = placeCountLabel(locs.length);

  dom.placeList.innerHTML = locs.map((loc) => {
    const isFav = state.favorites.includes(loc.id);
    return `<article class="place-card" data-id="${escapeHtml(loc.id)}" role="button" tabindex="0">
      <span class="place-dot" style="background:${colorOf(loc.category)}"></span>
      <div class="place-info">
        <h4 class="place-title">${escapeHtml(loc.title)}</h4>
        <p class="place-sub">${escapeHtml(loc.category)}${loc.address ? ` · ${escapeHtml(loc.address)}` : ''}</p>
      </div>
      <button type="button" class="place-star${isFav ? ' is-on' : ''}"
              aria-pressed="${isFav}" aria-label="${isFav ? 'Usuń z trasy' : 'Dodaj do trasy'}">★</button>
    </article>`;
  }).join('');

  $$('.place-card', dom.placeList).forEach((card) => {
    const loc = byId(card.dataset.id);
    if (!loc) return;

    card.addEventListener('click', () => goToLocation(loc));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') card.click(); });

    const star = $('.place-star', card);
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(loc.id);
    });
  });
}

/* ── MOJA TRASA (KARTA W SIDEBARZE) ────────────────────────── */

function updateRouteCard() {
  if (!dom.routeCard) return;
  const favs = favoriteLocations();

  dom.routeCard.hidden = favs.length === 0;
  dom.routeCount.textContent = favs.length ? placeCountLabel(favs.length) : '0 miejsc';

  dom.routeSteps.innerHTML = favs.length
    ? favs.map((loc, i) => `
        <li class="route-step">
          <span class="route-step-num">${i + 1}</span>
          <span class="route-step-name">${escapeHtml(loc.title)}</span>
        </li>`).join('')
    : '<li class="route-empty">Dodaj miejsca gwiazdką ★, aby zbudować trasę</li>';

  dom.routeGmaps.href = gmapsRouteUrl(favs);
  dom.routeMapBtn.textContent = state.routeLayer ? 'Usuń trasę z mapy' : 'Pokaż trasę na mapie';
}

/* Ścieżka w Google Maps: pierwsze pkt = start, ostatnie = cel. */
function gmapsRouteUrl(favs) {
  if (!favs.length) return '#';
  if (favs.length === 1) {
    const p = favs[0];
    return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  }
  const points = favs.map((p) => `${p.lat},${p.lng}`).join('/');
  return `https://www.google.com/maps/dir/${points}`;
}

function toggleRoute() {
  if (state.routeLayer) {
    map.removeLayer(state.routeLayer);
    state.routeLayer = null;
  } else {
    const points = favoriteLocations().map((loc) => [loc.lat, loc.lng]);
    if (points.length >= 2) {
      state.routeLayer = L.polyline(points, {
        color: '#e8b84b',
        weight: 4,
        opacity: 0.9,
        dashArray: '10 12',
      }).addTo(map);
      map.fitBounds(state.routeLayer.getBounds(), { padding: [80, 80] });
    } else if (points.length === 1) {
      map.flyTo(points[0], 15, { duration: 1 });
    }
  }
  updateRouteCard();
}

/* ── OTWARCIE MENU ─────────────────────────────────────────── */

function openSidebar() {
  dom.sidebar.classList.add('is-open');
  dom.menuToggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  dom.sidebar.classList.remove('is-open');
  dom.menuToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('sidebar-open');
}

function closeSidebarIfMobile() {
  if (window.matchMedia('(max-width: 768px)').matches) closeSidebar();
}

if (dom.menuToggle && dom.sidebarClose) {
  dom.menuToggle.addEventListener('click', openSidebar);
  dom.sidebarClose.addEventListener('click', closeSidebar);
}

if (dom.routeMapBtn) {
  dom.routeMapBtn.addEventListener('click', toggleRoute);
}

/* ── NAWIGACJA DO MIEJSCA ─────────────────────────────────── */

function goToLocation(loc) {
  closeSidebar();
  const target = [loc.lat, loc.lng];

  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    openModal(loc.id);
  };

  if (map.getBounds().contains(target)) {
    open();
    return;
  }

  map.on('moveend', open, { once: true });
  map.flyTo(target, 16, { duration: 1.1 });
  setTimeout(open, 1600); // zapas, gdyby moveend nie wybił
}

/* ── WYSZUKIWARKA ─────────────────────────────────────────── */

let searchTimer = null;

function initSearch() {
  if (!dom.searchInput || !dom.searchResults) return;

  dom.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 120);
  });

  dom.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pickFirstResult();
    if (e.key === 'Escape') clearSearch();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sidebar-search')) {
      dom.searchResults.classList.remove('is-active');
    }
  });
}

function runSearch() {
  const q = dom.searchInput.value.toLowerCase().trim();

  if (q.length < 2) {
    dom.searchResults.innerHTML = '';
    dom.searchResults.classList.remove('is-active');
    return;
  }

  const matches = state.locations.filter((loc) =>
    loc.title.toLowerCase().includes(q) ||
    loc.category.toLowerCase().includes(q) ||
    String(loc.address || '').toLowerCase().includes(q)
  ).slice(0, 12);

  if (!matches.length) {
    dom.searchResults.innerHTML = `<div class="search-item is-empty">Nic nie znaleziono…</div>`;
    dom.searchResults.classList.add('is-active');
    return;
  }

  dom.searchResults.innerHTML = matches.map((loc) => `
    <div class="search-item" data-id="${escapeHtml(loc.id)}" role="option">
      <strong>${escapeHtml(loc.title)}</strong>
      <span>${escapeHtml(loc.category)}</span>
    </div>`).join('');

  $$('.search-item', dom.searchResults).forEach((item) => {
    item.addEventListener('click', () => {
      const loc = byId(item.dataset.id);
      if (!loc) return;
      clearSearch();
      goToLocation(loc);
    });
  });

  dom.searchResults.classList.add('is-active');
}

function pickFirstResult() {
  const first = $('.search-item:not(.is-empty)', dom.searchResults);
  if (first) first.click();
}

function clearSearch() {
  dom.searchInput.value = '';
  dom.searchResults.innerHTML = '';
  dom.searchResults.classList.remove('is-active');
}

/* ── MODAL: SZCZEGÓŁY MIEJSCA ─────────────────────────────── */

function openModal(id) {
  const loc = byId(id);
  if (!loc) return;
  state.currentId = id;

  dom.title.textContent = loc.title;
  dom.description.textContent = loc.description;
  dom.address.textContent = loc.address || '';
  dom.coords.textContent = `${loc.lat.toFixed(5)}° N · ${loc.lng.toFixed(5)}° E`;

  const color = colorOf(loc.category);
  dom.category.textContent = loc.category;
  dom.category.style.color = color;
  dom.category.style.background = hexToRgba(color, 0.12);
  dom.category.style.borderColor = hexToRgba(color, 0.35);

  /* akcje */
  const hasPdf = Boolean(loc.pdf);
  dom.pdfLink.hidden = !hasPdf;
  dom.pdfLink.href = hasPdf ? loc.pdf : '#';
  dom.gmapsLink.href = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
  /* gdy brak PDF, przycisk trasy zajmuje cały rząd */
  dom.gmapsLink.classList.toggle('modal-btn-wide', !hasPdf);

  buildGallery(loc);
  syncModalFav();

  dom.overlay.classList.add('is-open');
  dom.overlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => dom.modalClose.focus());
}

function closeModal() {
  dom.overlay.classList.remove('is-open');
  dom.overlay.setAttribute('aria-hidden', 'true');
  state.currentId = null;
  dom.panel.style.transform = '';
}

/* Estetyczny fallback, gdy zdjęcie nie istnieje / jest offline. */
function fallbackImageSrc(title, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${color}"/>
        <stop offset="1" stop-color="#1a1108"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="#241a10"/>
    <rect width="100%" height="100%" fill="url(#g)" opacity="0.25"/>
    <text x="50%" y="50%" font-family="Georgia, serif" font-size="34" fill="#f5efe3" text-anchor="middle">${escapeHtml(title)}</text>
    <text x="50%" y="60%" font-family="sans-serif" font-size="13" fill="#b59c7a" letter-spacing="4" text-anchor="middle">POZNAŃ · MIASTO PRZYGÓD</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function buildGallery(loc) {
  const images = Array.isArray(loc.images) ? loc.images : [];

  dom.swiperWrap.innerHTML = images.map((src, i) => `
    <div class="swiper-slide">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(loc.title)} — zdjęcie ${i + 1}"
           loading="lazy" decoding="async"/>
    </div>`).join('');

  $$('.swiper-slide img', dom.swiperWrap).forEach((img) => {
    img.addEventListener('error', () => {
      img.src = fallbackImageSrc(loc.title, colorOf(loc.category));
    }, { once: true });
  });

  dom.galTotal.textContent = String(images.length);
  dom.galCurrent.textContent = '1';

  if (state.swiper) {
    state.swiper.destroy(true, true);
    state.swiper = null;
  }

  requestAnimationFrame(() => {
    state.swiper = new Swiper('.modal-swiper', {
      loop: images.length > 1,
      speed: 480,
      effect: 'fade',
      fadeEffect: { crossFade: true },
      navigation: {
        prevEl: '.swiper-button-prev',
        nextEl: '.swiper-button-next',
      },
      pagination: { el: '.swiper-pagination', clickable: true },
      on: {
        slideChange() {
          dom.galCurrent.textContent = String(this.realIndex + 1);
        },
      },
    });
  });
}

/* guzik ★ w modalu */
function syncModalFav() {
  const on = state.favorites.includes(state.currentId);
  dom.modalFav.classList.toggle('is-on', on);
  dom.modalFav.setAttribute('aria-pressed', String(on));
  dom.modalFav.setAttribute('aria-label', on ? 'Usuń z trasy' : 'Dodaj do trasy');
}

dom.modalFav.addEventListener('click', () => {
  if (state.currentId) toggleFavorite(state.currentId);
});

dom.modalClose.addEventListener('click', closeModal);
dom.overlay.addEventListener('click', (e) => {
  if (e.target === dom.overlay) closeModal();
});

/* fokus nie ucieka poza modal */
dom.overlay.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const focusables = $$('button, a[href]', dom.panel).filter((el) => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

/* ── SWIPE-DOLE, ABY ZAMKNĄĆ (MObil) ───────────────────────── */

(function initSwipeClose() {
  const panel = dom.panel;
  const content = $('.modal-content', panel);
  let startY = null;
  let startX = null;

  panel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    panel.classList.add('swiping');
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    const dx = Math.abs(e.touches[0].clientX - startX);

    /* tylko wiraż w dół, wyraźnie pionowy */
    if (dy <= 0 || dx > dy * 0.6) return;
    /* jeśli treść jest przewinięta w dół — nie zakrywamy scrolla */
    if (content && content.scrollTop > 8 && !e.target.closest('.modal-gallery')) return;

    panel.style.transform = `translateY(${dy * 0.85}px)`;
  }, { passive: true });

  const finish = (e) => {
    if (startY === null) return;
    const endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : startY;
    const dy = endY - startY;
    startY = null;
    startX = null;
    panel.classList.remove('swiping');

    if (dy > 90) {
      panel.style.transform = 'translateY(100%)';
      setTimeout(closeModal, 240);
    } else {
      panel.style.transform = '';
    }
  };

  panel.addEventListener('touchend', finish, { passive: true });
  panel.addEventListener('touchcancel', finish, { passive: true });
})();

/* ── KLAWIATURA: ESC ZAMYKA MODAL, POTEM MENU ─────────────── */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (dom.overlay.classList.contains('is-open')) closeModal();
  else if (dom.sidebar.classList.contains('is-open')) closeSidebar();
});

/* ── POGODA (OPEN-METEO) ─────────────────────────────────── */

/* Nowoczesne ikonki SVG – cienka linia, stroke = currentColor (złoto). */
const weatherSvg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const WEATHER_ICONS = {
  clear:   weatherSvg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
  partly:  weatherSvg('<circle cx="17.5" cy="6.5" r="2.5"/><path d="M17.5 2.2v1M21.8 6.5h-1M20.7 3.4l-.9.9"/><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'),
  cloud:   weatherSvg('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'),
  fog:     weatherSvg('<path d="M18 8h-1.26A8 8 0 1 0 9 18h9a5 5 0 0 0 0-10z"/><path d="M4 21h12M7 18h9"/>'),
  rain:    weatherSvg('<path d="M16 13v2M8 13v2M12 15v2"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>'),
  snow:    weatherSvg('<path d="M20 15.58A5 5 0 0 0 18 6h-1.26A8 8 0 1 0 4 14.25"/><path d="M8 19h.01M12 21h.01M16 19h.01M10 17h.01M14 17h.01"/>'),
  thunder: weatherSvg('<path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/><path d="m13 11-3 5h4l-3 5"/>'),
  wind:    weatherSvg('<path d="M9.59 4.59A2 2 0 1 1 11 8H2"/><path d="M17.73 7.73A2.5 2.5 0 1 1 19.5 12H2"/><path d="M12.59 19.41A2 2 0 1 0 14 16H2"/>'),
};

function weatherIconFor(code) {
  if (code === 0)  return 'clear';
  if (code === 1)  return 'partly';
  if (code <= 3)   return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code <= 77)  return 'snow'; /* 71–77: śnieg */
  if (code <= 94)  return 'rain'; /* 51–67, 80–82, 85–94: deszcz */
  return 'thunder';              /* 95+: burza */
}

function describeWeather(code) {
  if (code === 0)  return 'Bezchmurnie';
  if (code === 1)  return 'Częściowe zachmurzenie';
  if (code <= 3)   return 'Zachmurzenie';
  if (code === 45 || code === 48) return 'Mgła';
  if (code <= 67)  return 'Deszcz';
  if (code <= 77)  return 'Śnieg';
  if (code <= 94)  return 'Przelotne opady';
  return 'Burza';
}

function setWeatherIcon(key) {
  dom.weatherIcon.classList.remove('is-loading');
  dom.weatherIcon.innerHTML = WEATHER_ICONS[key] || WEATHER_ICONS.cloud;
}

function showWeatherFallback() {
  setWeatherIcon('cloud');
  dom.weatherTemp.textContent = 'Poznań';
  dom.weatherDesc.textContent = 'pogoda niedostępna';
  dom.weatherWind.innerHTML = WEATHER_ICONS.wind + ' –';
}

async function fetchWeather() {
  if (!dom.weatherTemp) return;
  if (!navigator.onLine) {
    showWeatherFallback();
    return;
  }
  try {
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=52.4064&longitude=16.9252&current_weather=true');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const w = data.current_weather;

    dom.weatherTemp.textContent = `${Math.round(w.temperature)}°C`;
    dom.weatherWind.innerHTML = WEATHER_ICONS.wind + ` ${Math.round(w.windspeed)} km/h`;
    setWeatherIcon(weatherIconFor(w.weathercode));
    dom.weatherDesc.textContent = describeWeather(w.weathercode);
  } catch (err) {
    console.error('Błąd pogody:', err);
    showWeatherFallback();
  }
}

fetchWeather();
setInterval(fetchWeather, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fetchWeather();
});

/* ── CIEMNY MOTYW ────────────────────────────────────────── */

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark-theme', dark);
  dom.themeToggle.textContent = dark ? '☀️' : '🌙';
  dom.themeToggle.setAttribute('aria-label', dark ? 'Włącz jasny motyw' : 'Włącz ciemny motyw');
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* prywatny tryb */ }
}

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* prywatny tryb */ }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light'));
})();

dom.themeToggle.addEventListener('click', () => {
  applyTheme(document.body.classList.contains('dark-theme') ? 'light' : 'dark');
});

/* ── EKRAN ŁADOWANIA ─────────────────────────────────────── */

const LOAD_MIN_MS = 1100;
const loadStart = Date.now();
let loadDone = false;

function dismissLoadingScreen() {
  loadDone = true;
  const wait = Math.max(0, LOAD_MIN_MS - (Date.now() - loadStart));
  setTimeout(() => {
    if (!dom.loadScreen) return;
    dom.loadScreen.classList.add('is-gone');
    dom.loadScreen.addEventListener('transitionend', () => dom.loadScreen.remove(), { once: true });
  }, wait);
}

function showDataError() {
  showToast('Błąd ładowania danych', 'error');
  const wrap = document.createElement('div');
  wrap.className = 'data-error';
  wrap.innerHTML = `
    <div class="data-error-card">
      <p class="data-error-icon" aria-hidden="true">⚠️</p>
      <h2>Błąd ładowania danych</h2>
      <p>Nie udało się pobrać listy miejsc. Sprawdź połączenie z internetem i odśwież stronę.</p>
      <button type="button" class="modal-btn modal-btn-gmaps" id="data-error-retry">Odśwież stronę</button>
    </div>`;
  document.body.appendChild(wrap);
  $('#data-error-retry').addEventListener('click', () => window.location.reload());
}

/* ── WSKAZÓWKA PRZY PIERWSZYM ODWIEDZINIE ───────────────── */

function maybeShowHint() {
  if (state.favorites.length > 0) return;
  try {
    if (localStorage.getItem(HINT_KEY)) return;
    localStorage.setItem(HINT_KEY, '1');
  } catch { return; }
  setTimeout(() => {
    showToast('Wskazówka: kliknij ★ przy miejscu, aby dodać je do Twojej trasy');
  }, 2500);
}

/* ── START ─────────────────────────────────────────────────── */

loadData();
