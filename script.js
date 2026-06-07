/* ═══════════════════════════════════════════════════════
   Poznań — Miasto Przygód  |  script.js (Map + Sidebar + Geo)
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ── CONFIG ─────────────────────────────────────────────── */
const DATA_URL = 'data.json?v=' + Date.now();

/* ── CATEGORY COLOUR MAP ─────────────────────────────────── */
const CATEGORY_COLORS = {
  'Architektura':      '#c8813a',
  'Przestrzeń Miejska':'#7a5c38',
  'Sakralne':          '#c0392b',
  'Zabytki':           '#6d4c41',
  'Kultura':           '#5d6d3a',
  'Muzyka':            '#9b59b6',
  'Teatr & Opera':     '#8e44ad',
  'Przyroda':          '#3a7a5c',
  'Nauka':             '#2980b9',
  'Historia':          '#a07850',
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
  <path class="pin-body" d="M18 2C10.27 2 4 8.27 4 16c0 11 14 29.5 14 29.5S32 27 32 16C32 8.27 25.73 2 18 2Z" fill="${color}" filter="url(#shadow-${color.slice(1)})"/>
  <circle cx="18" cy="16" r="7" fill="rgba(255,255,255,0.22)" class="pin-icon"/>
  <circle cx="18" cy="16" r="4.5" fill="rgba(255,255,255,0.75)" class="pin-icon"/>
</svg>`.trim();
}

/* ── MAP INIT ────────────────────────────────────────────── */
const map = L.map('map', {
  center:           [52.4064, 16.9252],
  zoom:             14,
  minZoom:          12,
  maxZoom:          18,
  zoomControl:      false,
  attributionControl: false,
});

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

/* ── GEOLOCATION (ГДЕ Я?) ────────────────────────────────── */
const locateControl = L.control({ position: 'bottomright' });

locateControl.onAdd = function() {
  const btn = L.DomUtil.create('button', 'locate-btn');
  btn.innerHTML = '🧭 Gdzie jestem?';
  btn.title = 'Pokaż moją lokalizację';
  
  // Добавим немного стилей прямо сюда для красивой кнопки
  btn.style.cssText = `
    background: #fdf7ee; border: 2px solid rgba(122,92,56,.25); border-radius: 8px;
    padding: 8px 12px; font-family: 'DM Sans', sans-serif; font-weight: 500;
    color: #7a5c38; cursor: pointer; box-shadow: 0 4px 16px rgba(20,12,4,.18);
    margin-bottom: 10px; margin-right: 10px; transition: all 0.2s;
  `;
  btn.onmouseover = () => { btn.style.background = '#f5efe3'; btn.style.color = '#c8813a'; };
  btn.onmouseout  = () => { btn.style.background = '#fdf7ee'; btn.style.color = '#7a5c38'; };

  btn.onclick = function(e) {
    e.stopPropagation();
    btn.innerHTML = '⏳ Szukam...';
    map.locate({ setView: true, maxZoom: 16 });
  };
  return btn;
};
locateControl.addTo(map);

let userMarker = null;

map.on('locationfound', function(e) {
  const btn = document.querySelector('.locate-btn');
  if (btn) btn.innerHTML = '🧭 Gdzie jestem?';

  if (userMarker) {
    userMarker.setLatLng(e.latlng);
  } else {
    // Красивый синий кружочек для геолокации
    const userIcon = L.divIcon({
      html: `<div style="width:16px;height:16px;background:#2980b9;border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>`,
      className: '',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    userMarker = L.marker(e.latlng, { icon: userIcon })
      .addTo(map)
      .bindTooltip('Jesteś tutaj', { direction: 'top', offset: [0, -10] });
  }
});

map.on('locationerror', function(e) {
  const btn = document.querySelector('.locate-btn');
  if (btn) btn.innerHTML = '🧭 Gdzie jestem?';
  alert('Nie udało się pobrać lokalizacji. Sprawdź, czy masz włączony GPS i czy zezwoliłeś przeglądarce na dostęp do lokalizacji.');
});

/* ── STATE ───────────────────────────────────────────────── */
let swiperInstance = null;
let currentLocation = null;
let allMarkers = []; // Хранилище маркеров для фильтрации

/* ── DOM REFS ────────────────────────────────────────────── */
const overlay     = document.getElementById('modal-overlay');
const panel       = document.getElementById('modal-panel');
const closeBtn    = document.getElementById('modal-close');
const titleEl     = document.getElementById('modal-title');
const categoryEl  = document.getElementById('modal-category');
const descEl      = document.getElementById('modal-description');
const swiperWrap  = document.getElementById('swiper-wrapper');
const galCurrent  = document.getElementById('gallery-current');
const galTotal    = document.getElementById('gallery-total');
const loadScreen  = document.getElementById('loading-screen');
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

// Sidebar Refs
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const sidebarCategories = document.getElementById('sidebar-categories');

/* ── FETCH DATA ──────────────────────────────────────────── */
async function loadData() {
  try {
    const res  = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderMarkers(data);
    renderSidebarFilters(data); // Генерируем фильтры
    initSearch(data);
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
    if (typeof loc.lat === 'undefined' || typeof loc.lng === 'undefined') return;

    const color = getCategoryColor(loc.category);
    const icon = L.divIcon({
      html: `<div class="custom-pin" role="button" tabindex="0" aria-label="${loc.title}">${createPinSVG(color)}</div>`,
      iconSize:   [36, 48],
      iconAnchor: [18, 48],
      className:  '',
    });

    const marker = L.marker([loc.lat, loc.lng], { icon, title: loc.title })
      .addTo(map)
      .bindTooltip(loc.title, { permanent: false, direction: 'top', offset: [0, -44], opacity: 1 });

    marker.on('click', () => openModal(loc));

    // Сохраняем маркер для бокового меню
    allMarkers.push({ category: loc.category, marker: marker });
  });
}

/* ── SIDEBAR & FILTERING ─────────────────────────────────── */
if(menuToggle && sidebarClose) {
  menuToggle.addEventListener('click', () => sidebar.classList.add('is-open'));
  sidebarClose.addEventListener('click', () => sidebar.classList.remove('is-open'));
}

function renderSidebarFilters(locations) {
  if(!sidebarCategories) return;
  const categories = [...new Set(locations.map(l => l.category))].sort();

  // Обернули текст в <span class="filter-name">
  let html = `<button class="filter-btn is-active" data-cat="all">
                <span class="filter-color-dot" style="background: #999"></span>
                <span class="filter-name">Wszystkie miejsca</span>
              </button>`;

  categories.forEach(cat => {
    const color = getCategoryColor(cat);
    // И здесь тоже обернули текст
    html += `<button class="filter-btn" data-cat="${cat}">
               <span class="filter-color-dot" style="background: ${color}"></span>
               <span class="filter-name">${cat}</span>
             </button>`;
  });

  sidebarCategories.innerHTML = html;

  const filterBtns = sidebarCategories.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      filterMap(btn.getAttribute('data-cat'));
      if (window.innerWidth <= 768) sidebar.classList.remove('is-open');
    });
  });
}

function filterMap(category) {
  allMarkers.forEach(item => {
    if (category === 'all' || item.category === category) {
      if (!map.hasLayer(item.marker)) map.addLayer(item.marker);
    } else {
      if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
    }
  });
}

/* ── MODAL ───────────────────────────────────────────────── */
function openModal(loc) {
  currentLocation = loc;
  titleEl.textContent    = loc.title;
  categoryEl.textContent = loc.category;

  /* Описание + Твои крутые кнопки PDF и маршрута */
  descEl.innerHTML = `
    <p style="margin-bottom: 20px; line-height: 1.6; color: #333;">${loc.description}</p>
    
    <div style="
      display: flex; 
      gap: 12px; 
      margin-top: 25px; 
      padding-top: 20px; 
      border-top: 1px solid rgba(122, 92, 56, 0.15); 
      justify-content: stretch;
      flex-wrap: wrap;
    ">
      ${loc.pdf ? `
        <a href="${loc.pdf}" target="_blank" style="
          flex: 1; min-width: 140px; text-align: center; 
          background-color: #53694f; color: #f5efe3;
          padding: 12px 16px; text-decoration: none; font-family: 'Playfair Display', serif;
          font-weight: bold; font-size: 0.95rem; border-radius: 8px;
          box-shadow: 0 4px 12px rgba(83, 105, 79, 0.2); transition: all 0.25s ease;
        " onmouseover="this.style.backgroundColor='#3e523b'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(83, 105, 79, 0.3)';" 
           onmouseout="this.style.backgroundColor='#53694f'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(83, 105, 79, 0.2)';">
          📖 Przewodnik (PDF)
        </a>
      ` : ''}
      
      <a href="https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}" target="_blank" style="
        flex: 1; min-width: 140px; text-align: center; 
        background-color: #2980b9; color: #f5efe3;
        padding: 12px 16px; text-decoration: none; font-family: 'Playfair Display', serif;
        font-weight: bold; font-size: 0.95rem; border-radius: 8px;
        box-shadow: 0 4px 12px rgba(41, 128, 185, 0.2); transition: all 0.25s ease;
      " onmouseover="this.style.backgroundColor='#1c6ea4'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(41, 128, 185, 0.3)';" 
         onmouseout="this.style.backgroundColor='#2980b9'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(41, 128, 185, 0.2)';">
        🗺️ Jak dojechać?
      </a>
    </div>
  `;

  const color = getCategoryColor(loc.category);
  categoryEl.style.color       = color;
  categoryEl.style.background  = `${color}18`;
  categoryEl.style.borderColor = `${color}40`;

  swiperWrap.innerHTML = '';
  const images = loc.images || [];
  images.forEach((src, i) => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';
    const img = document.createElement('img');
    img.src = src; img.alt = `${loc.title} — zdjęcie ${i + 1}`; img.loading = 'lazy';
    slide.appendChild(img); swiperWrap.appendChild(slide);
  });

  galTotal.textContent = images.length;
  galCurrent.textContent = 1;

  if (swiperInstance) { swiperInstance.destroy(true, true); swiperInstance = null; }

  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    swiperInstance = new Swiper('.modal-swiper', {
      loop: images.length > 1, speed: 500, effect: 'fade', fadeEffect: { crossFade: true },
      navigation: { prevEl: '.swiper-button-prev', nextEl: '.swiper-button-next' },
      pagination: { el: '.swiper-pagination', clickable: true },
      on: { slideChange() { galCurrent.textContent = this.realIndex + 1; } },
    });
  });
  requestAnimationFrame(() => closeBtn.focus());
}

function closeModal() {
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  currentLocation = null;
}

closeBtn.addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeModal(); });
if(panel) panel.addEventListener('click', (e) => e.stopPropagation());

/* ── LOADING SCREEN ──────────────────────────────────────── */
function dismissLoadingScreen() {
  setTimeout(() => {
    loadScreen.classList.add('is-gone');
    loadScreen.addEventListener('transitionend', () => { loadScreen.style.display = 'none'; }, { once: true });
  }, 1500);
}

function showDataError() {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = `position:fixed; inset:0; z-index:5000; display:flex; align-items:center; justify-content:center; background:rgba(26,17,8,.9); color:#f5efe3; font-family:'Playfair Display',serif; text-align:center; padding:24px;`;
  errDiv.innerHTML = `<div><p style="font-size:42px;margin-bottom:8px;">⚠</p><h2 style="font-size:22px;margin-bottom:10px;">Błąd ładowania danych</h2></div>`;
  document.body.appendChild(errDiv);
}

/* ── LIVE SEARCH ─────────────────────────────────────────── */
function initSearch(locations) {
  if (!searchInput || !searchResults) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    searchResults.innerHTML = '';

    // Начинаем искать только если введено больше 1 буквы
    if (query.length < 2) {
      searchResults.classList.remove('is-active');
      return;
    }

    // Ищем совпадения в названиях и категориях
    const matches = locations.filter(loc => 
      loc.title.toLowerCase().includes(query) || 
      loc.category.toLowerCase().includes(query)
    );

    if (matches.length > 0) {
      matches.forEach(loc => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerHTML = `<strong>${loc.title}</strong> <span style="font-size:11px; color:#7a5c38; display:block;">${loc.category}</span>`;
        
        div.addEventListener('click', () => {
          // 1. Очищаем поиск и закрываем меню
          searchInput.value = '';
          searchResults.classList.remove('is-active');
          sidebar.classList.remove('is-open');

          // 2. Убеждаемся, что маркер не скрыт фильтром (показываем всё)
          filterMap('all');
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('is-active')); // Выключаем все
          document.querySelector('[data-cat="all"]').classList.add('is-active'); // Включаем нужную

          // 3. Кинематографично летим к точке!
          map.flyTo([loc.lat, loc.lng], 16, { animate: true, duration: 1.5 });

          // 4. Открываем модальное окно после завершения полета
          setTimeout(() => {
            openModal(loc);
          }, 1500);
        });
        
        searchResults.appendChild(div);
      });
      searchResults.classList.add('is-active');
    } else {
      // Если ничего не найдено
      const div = document.createElement('div');
      div.className = 'search-item';
      div.textContent = 'Nic nie znaleziono...';
      div.style.cursor = 'default';
      searchResults.appendChild(div);
      searchResults.classList.add('is-active');
    }
  });

  // Прячем результаты, если кликнули куда-то мимо поиска
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('is-active');
    }
  });
}

/* ── INIT ────────────────────────────────────────────────── */
loadData();