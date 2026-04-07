/* ============================================================
   VIEWER.JS – Prezi-Style IIIF Exhibition Viewer
   (Updated for Firebase Firestore)
   ============================================================ */

import { db } from './firebase-config.js';
import { collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// ─── State ────────────────────────────────────────────────────
const State = {
  exhibition: null,
  items: [],
  currentIndex: -1,
  infoPanelVisible: true,
  overviewVisible: false,
  transitioning: false,
  autoHideTimer: null,
  touchStartX: 0,
  touchStartY: 0,
  // Region zoom
  regionZoomed: false,
  regionZoomData: null, // { x, y, w, h, pct, naturalW, naturalH }
};

// Animation sequences (cycles through for variety)
const ANIM_SEQUENCE = [
  'anim-zoom-in',
  'anim-pan-left',
  'anim-zoom-out',
  'anim-pan-right',
  'anim-zoom-in',
  'anim-pan-left',
];

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const slug = getSlugFromUrl();

  if (slug) {
    await loadExhibition(slug);
  } else {
    await loadLanding();
  }

  setupKeyboard();
  setupTouch();
  setupMouseActivity();

  // Handle browser back/forward buttons
  window.addEventListener('popstate', (event) => {
    const slug = getSlugFromUrl();
    if (slug) {
      loadExhibition(slug);
    } else {
      loadLanding();
    }
  });
});

function getSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const querySlug = params.get('exhibition');
  if (querySlug) return querySlug;

  const path = window.location.pathname.substring(1);
  return (path && path !== 'index.html' && path !== '/') ? path : null;
}

// ─── Landing ──────────────────────────────────────────────────
async function loadLanding() {
  const picker = document.getElementById('exhibitionPicker');
  try {
    // Show landing, hide viewer
    document.getElementById('landingOverlay').style.display = 'flex';
    document.getElementById('viewer').classList.add('hidden');
    document.title = 'Virtuelle Ausstellung';

    const q = query(
      collection(db, "exhibitions"), 
      where("is_published", "==", true), 
      orderBy("created_at", "desc"), 
      limit(100)
    );
    const querySnapshot = await getDocs(q);
    const exhibitions = [];
    querySnapshot.forEach((doc) => {
      exhibitions.push({ id: doc.id, ...doc.data() });
    });

    if (exhibitions.length === 0) {
      picker.innerHTML = `<div class="picker-empty">Keine veröffentlichten Ausstellungen vorhanden.</div>`;
      return;
    }

    picker.innerHTML = '';
    for (const exh of exhibitions) {
      picker.appendChild(await buildPickerCard(exh));
    }
  } catch (e) {
    console.error("Error loading landing:", e);
    picker.innerHTML = `<div class="picker-empty">Fehler beim Laden der Ausstellungen.</div>`;
  }
}

async function buildPickerCard(exh) {
  const card = document.createElement('div');
  card.className = 'picker-card';

  let thumbHtml = `<div class="picker-card-thumb"><i class="fa-solid fa-image"></i></div>`;
  if (exh.cover_image_url) {
    const imgUrl = await IIIFHelper.resolveIIIFImageUrl(exh.cover_image_url, 'image', 200).catch(() => null);
    if (imgUrl) {
      thumbHtml = `<div class="picker-card-thumb"><img src="${imgUrl}" alt="${escHtml(exh.title)}" onerror="this.parentElement.innerHTML='<i class=fa-solid fa-image></i>'" /></div>`;
    }
  }

  const meta = [exh.curator, exh.institution, exh.year].filter(Boolean).join(' · ');
  const accentColor = exh.accent_color || '#c8a97e';

  card.innerHTML = `
    ${thumbHtml}
    <div class="picker-card-info">
      <h3>${escHtml(exh.title)}</h3>
      ${meta ? `<div class="meta">${escHtml(meta)}</div>` : ''}
    </div>
    <div class="picker-card-arrow"><i class="fa-solid fa-arrow-right"></i></div>`;

  card.addEventListener('click', (e) => {
    e.preventDefault();
    const slug = exh.slug || exh.id;
    history.pushState({ slug }, '', `/${slug}`);
    loadExhibition(slug);
  });

  card.style.setProperty('--hover-accent', accentColor);
  return card;
}

// ─── Load Exhibition ───────────────────────────────────────────
async function loadExhibition(slugOrId) {
  showLoading(true, 'Ausstellung wird geladen…');
  setLoadingProgress(10);

  try {
    // Find exhibition by slug or ID
    const q = query(collection(db, "exhibitions"), limit(100));
    const querySnapshot = await getDocs(q);
    const all = [];
    querySnapshot.forEach((doc) => {
      all.push({ id: doc.id, ...doc.data() });
    });
    const exh = all.find(e => e.slug === slugOrId || e.id === slugOrId);

    if (!exh) {
      showLoading(false);
      showError('Ausstellung nicht gefunden.');
      return;
    }

    State.exhibition = exh;
    setLoadingProgress(30);

    // Load items
    const iq = query(
      collection(db, "exhibit_items"), 
      where("exhibition_id", "==", exh.id), 
      orderBy("sort_order", "asc"), 
      limit(200)
    );
    const itemsSnapshot = await getDocs(iq);
    State.items = [];
    itemsSnapshot.forEach((doc) => {
      State.items.push({ id: doc.id, ...doc.data() });
    });

    setLoadingProgress(50);
    setLoadingText('Bilder werden aufgelöst…');

    // Resolve all image URLs upfront
    const resolvePromises = State.items.map(item =>
      IIIFHelper.resolveIIIFImageUrl(item.iiif_url, item.iiif_type || 'image', 1200)
        .then(url => { item._resolvedUrl = url; })
        .catch(() => { item._resolvedUrl = null; })
    );

    await Promise.allSettled(resolvePromises);
    setLoadingProgress(80);

    // Set accent color
    if (exh.accent_color) {
      document.documentElement.style.setProperty('--accent', exh.accent_color);
    }

    // Apply exhibition title
    document.title = exh.title ? `${exh.title} – Virtuelle Ausstellung` : 'Virtuelle Ausstellung';
    const titleEl = document.getElementById('exhibitionTitleDisplay');
    titleEl.textContent = exh.title || '';
    titleEl.href = `/${exh.slug || exh.id}`;
    titleEl.onclick = (e) => {
      e.preventDefault();
      history.pushState(null, '', '/');
      loadLanding();
    };
    const metaParts = [exh.curator, exh.institution, exh.year].filter(Boolean).join(' · ');
    document.getElementById('exhibitionMetaDisplay').textContent = metaParts;

    setLoadingProgress(95);

    // Build slides
    buildSlides();
    buildOverviewGrid();

    setLoadingProgress(100);
    await delay(400);
    showLoading(false);

    // Hide landing or reset exhibition
    document.getElementById('landingOverlay').style.display = 'none';
    const viewer = document.getElementById('viewer');
    viewer.classList.remove('hidden');

    // Info panel open by default — sync CSS state + button
    viewer.classList.add('panel-open');
    document.getElementById('infoToggleBtn').classList.add('active');

    // Show intro
    showIntro(exh);

  } catch (e) {
    console.error("Error loading exhibition:", e);
    showLoading(false);
    showError('Fehler beim Laden: ' + e.message);
  }
}

// ─── Intro ─────────────────────────────────────────────────────
function showIntro(exh) {
  const overlay = document.getElementById('introOverlay');
  overlay.classList.remove('hidden');

  document.getElementById('introInstitution').textContent = [exh.institution, exh.year].filter(Boolean).join(' · ');
  document.getElementById('introTitle').textContent = exh.title || '';
  document.getElementById('introSubtitle').textContent = exh.subtitle || '';
  const curator = exh.curator ? `Kuratiert von ${exh.curator}` : '';
  document.getElementById('introMeta').textContent = curator;
  document.getElementById('introDescription').textContent = exh.description || '';
}

function startExhibition() {
  document.getElementById('introOverlay').classList.add('hidden');
  goToSlide(0, 'anim-zoom-in');
}

// ─── Slides ────────────────────────────────────────────────────
function buildSlides() {
  const canvas = document.getElementById('canvas');
  canvas.innerHTML = '';

  State.items.forEach((item, index) => {
    const slide = document.createElement('div');
    slide.className = 'slide';
    slide.dataset.index = index;
    slide.id = `slide-${index}`;

    // Background blur layer
    const bg = document.createElement('div');
    bg.className = 'slide-bg';
    if (item._resolvedUrl) bg.style.backgroundImage = `url("${item._resolvedUrl}")`;
    slide.appendChild(bg);

    // Image container
    const imgContainer = document.createElement('div');
    imgContainer.className = 'slide-image-container';

    if (item._resolvedUrl) {
      // Wrap image so transform works independently of object-fit layout
      const wrap = document.createElement('div');
      wrap.className = 'slide-image-wrap';

      const img = document.createElement('img');
      img.className = 'slide-image';
      img.alt = item.title || '';
      img.loading = 'lazy';
      img.src = item._resolvedUrl;
      img.onerror = () => {
        wrap.replaceWith(buildImagePlaceholder(item.title));
      };
      wrap.appendChild(img);
      imgContainer.appendChild(wrap);
    } else {
      imgContainer.appendChild(buildImagePlaceholder(item.title));
    }

    slide.appendChild(imgContainer);
    canvas.appendChild(slide);
  });

  // Transition overlay
  if (!document.getElementById('transOverlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'slide-transition-overlay';
    overlay.id = 'transOverlay';
    document.getElementById('stage').appendChild(overlay);
  }
}

function buildImagePlaceholder(title) {
  const ph = document.createElement('div');
  ph.className = 'slide-image-placeholder';
  ph.innerHTML = `<i class="fa-solid fa-image"></i><span>${escHtml(title || 'Bild nicht verfügbar')}</span>`;
  return ph;
}

// ─── Navigation ────────────────────────────────────────────────
async function navigate(direction) {
  if (State.transitioning) return;
  const newIndex = State.currentIndex + direction;
  if (newIndex < 0 || newIndex >= State.items.length) return;

  const anim = direction > 0 ? ANIM_SEQUENCE[newIndex % ANIM_SEQUENCE.length] : 'anim-zoom-out';
  await goToSlide(newIndex, anim);
}

async function goToSlide(index, animClass = 'anim-zoom-in') {
  if (index < 0 || index >= State.items.length) return;
  if (index === State.currentIndex) return;

  State.transitioning = true;

  const prevIndex = State.currentIndex;
  const prevSlide = prevIndex >= 0 ? document.getElementById(`slide-${prevIndex}`) : null;
  const nextSlide = document.getElementById(`slide-${index}`);

  // Crossfade transition
  const transOverlay = document.getElementById('transOverlay');

  // Reset any active region zoom before transitioning
  if (State.regionZoomed) _resetRegionZoom(false);

  // Fade to black
  transOverlay.classList.add('fade-in');
  await delay(380);

  // Switch active slide
  if (prevSlide) {
    prevSlide.classList.remove('active');
    prevSlide.classList.add('prev');
  }

  // Remove all anim classes from next slide
  ANIM_SEQUENCE.forEach(a => nextSlide.classList.remove(a));
  nextSlide.classList.remove('prev');
  nextSlide.classList.add('active', animClass);

  // Update info panel
  updateInfoPanel(index);
  updateProgress(index);
  updateNavButtons(index);

  State.currentIndex = index;

  // Ensure info panel image container adjusts
  const imgContainers = document.querySelectorAll('.slide-image-container');
  imgContainers.forEach(c => {
    c.classList.toggle('info-hidden', !State.infoPanelVisible);
  });

  // Fade back in
  transOverlay.classList.remove('fade-in');
  await delay(500);

  State.transitioning = false;

  // Update overview active state
  updateOverviewActive(index);
}

// ─── Info Panel ────────────────────────────────────────────────
function updateInfoPanel(index) {
  const item = State.items[index];
  if (!item) return;

  document.getElementById('infoNumber').textContent = `${index + 1} / ${State.items.length}`;
  document.getElementById('infoTitle').textContent = item.title || 'Ohne Titel';
  document.getElementById('infoSubtitle').textContent = item.subtitle || '';

  // Meta lines
  const metaEl = document.getElementById('infoMeta');
  const metaLines = [];
  if (item.artist) metaLines.push(`<span><strong style="color:var(--text);font-weight:500">${escHtml(item.artist)}</strong></span>`);
  if (item.date) metaLines.push(`<span>${escHtml(item.date)}</span>`);
  if (item.medium) metaLines.push(`<span>${escHtml(item.medium)}</span>`);
  if (item.dimensions) metaLines.push(`<span>${escHtml(item.dimensions)}</span>`);
  if (item.collection) metaLines.push(`<span style="color:rgba(245,240,232,0.35);font-size:11px;letter-spacing:0.05em">${escHtml(item.collection)}</span>`);
  metaEl.innerHTML = metaLines.join('');

  document.getElementById('infoDescription').textContent = item.description || '';

  // Custom fields
  const fieldsEl = document.getElementById('infoFields');
  const fields = [];
  if (item.custom_label_1 && item.custom_value_1) {
    fields.push(`<div class="info-field"><span class="info-field-label">${escHtml(item.custom_label_1)}</span><span class="info-field-value">${escHtml(item.custom_value_1)}</span></div>`);
  }
  if (item.custom_label_2 && item.custom_value_2) {
    fields.push(`<div class="info-field"><span class="info-field-label">${escHtml(item.custom_label_2)}</span><span class="info-field-value">${escHtml(item.custom_value_2)}</span></div>`);
  }
  fieldsEl.innerHTML = fields.join('');

  document.getElementById('slideCounter').textContent = `${index + 1} / ${State.items.length}`;

  // ── Region Zoom Button ──────────────────────────────────────
  const hasRegion = item.region_w && item.region_h;
  const regionWrap = document.getElementById('infoRegionWrap');
  const regionBtn  = document.getElementById('regionZoomBtn');
  const regionLabel = document.getElementById('regionZoomLabel');
  const regionHint  = document.getElementById('regionZoomHint');

  regionWrap.classList.toggle('hidden', !hasRegion);
  // Reset button state
  regionBtn.classList.remove('zoomed-in');
  document.getElementById('regionZoomIcon').className = 'fa-solid fa-magnifying-glass-plus';
  State.regionZoomed = false;
  State.regionZoomData = null;

  if (hasRegion) {
    regionLabel.textContent = item.region_label || 'Detail ansehen';
    regionHint.textContent = item.region_pct
      ? `Region: pct:${item.region_x},${item.region_y},${item.region_w},${item.region_h}`
      : `Region: ${item.region_x},${item.region_y},${item.region_w},${item.region_h}`;
    State.regionZoomData = {
      x: Number(item.region_x) || 0,
      y: Number(item.region_y) || 0,
      w: Number(item.region_w),
      h: Number(item.region_h),
      pct: !!item.region_pct,
      originalW: null, // filled async below
      originalH: null,
    };
    // Fetch true original dimensions via info.json so the zoom
    // calculation can map region coords (in original pixel space)
    // correctly onto the downscaled rendered image.
    const baseUrl = (item.iiif_url || '').replace(/\/info\.json$/, '');
    if (baseUrl && !item.region_pct) {
      IIIFHelper.fetchIIIFOriginalDimensions(baseUrl)
        .then(dims => {
          if (dims && State.regionZoomData) {
            State.regionZoomData.originalW = dims.width;
            State.regionZoomData.originalH = dims.height;
          }
        });
    }
  }
}

// ─── Region Zoom ───────────────────────────────────────────────
function toggleRegionZoom() {
  if (State.regionZoomed) {
    _resetRegionZoom();
  } else {
    _applyRegionZoom();
  }
}

function _applyRegionZoom() {
  const slide = document.getElementById(`slide-${State.currentIndex}`);
  if (!slide) return;
  const img  = slide.querySelector('.slide-image');
  const wrap = slide.querySelector('.slide-image-wrap');
  if (!img || !wrap || !State.regionZoomData) return;

  const d       = State.regionZoomData;
  const item    = State.items[State.currentIndex];
  const baseUrl = (item.iiif_url || '').replace(/\/info\.json$/, '');
  if (!baseUrl) return;

  // ── Button state immediately ───────────────────────────────
  const btn  = document.getElementById('regionZoomBtn');
  const icon = document.getElementById('regionZoomIcon');
  btn.classList.add('zoomed-in');
  btn.disabled = true;
  icon.className = 'fa-solid fa-spinner fa-spin';
  document.getElementById('regionZoomLabel').textContent = 'Wird geladen…';

  // ── Build the IIIF region URL ──────────────────────────────
  // Request at double the container width for crisp rendering on retina
  const containerRect = slide.querySelector('.slide-image-container').getBoundingClientRect();
  const tileSize = Math.round(Math.max(containerRect.width, containerRect.height) * 2);
  const regionUrl = IIIFHelper.buildIIIFRegionUrl(baseUrl, d, tileSize);

  // ── Load the region image, then cross-fade ─────────────────
  const regionImg = new Image();
  regionImg.onload = () => {
    // Save original src for reset
    if (!img.dataset.originalSrc) img.dataset.originalSrc = img.src;

    // Cross-fade: fade out current, swap src, fade in
    img.style.transition = 'opacity 0.35s ease';
    img.style.opacity    = '0';

    setTimeout(() => {
      img.src = regionUrl;
      // Also update blurred background
      const bg = slide.querySelector('.slide-bg');
      if (bg) bg.style.backgroundImage = `url("${regionUrl}")`;

      img.style.opacity = '1';

      // Reset any leftover CSS transform from previous attempts
      wrap.style.transition    = 'none';
      wrap.style.transform     = 'scale(1)';
      wrap.style.transformOrigin = 'center center';

      State.regionZoomed = true;

      // Update button
      btn.disabled = false;
      icon.className = 'fa-solid fa-magnifying-glass-minus';
      document.getElementById('regionZoomLabel').textContent = 'Zurück zur Gesamtansicht';
    }, 320);

    // Add vignette
    let vig = slide.querySelector('.region-vignette');
    if (!vig) {
      vig = document.createElement('div');
      vig.className = 'region-vignette';
      slide.querySelector('.slide-image-container').appendChild(vig);
    }
    requestAnimationFrame(() => vig.classList.add('active'));
  };

  regionImg.onerror = () => {
    // Server error – fall back gracefully
    btn.disabled = false;
    btn.classList.remove('zoomed-in');
    icon.className = 'fa-solid fa-magnifying-glass-plus';
    document.getElementById('regionZoomLabel').textContent = item.region_label || 'Detail ansehen';
    console.warn('IIIF region request failed:', regionUrl);
  };

  regionImg.src = regionUrl;
}

function _resetRegionZoom(animated = true) {
  const slide = document.getElementById(`slide-${State.currentIndex}`);
  if (!slide) return;
  const img  = slide.querySelector('.slide-image');
  const wrap = slide.querySelector('.slide-image-wrap');
  if (!img || !wrap) return;

  // Restore original full-image src with cross-fade
  const originalSrc = img.dataset.originalSrc;
  if (originalSrc && img.src !== originalSrc) {
    img.style.transition = animated ? 'opacity 0.35s ease' : 'none';
    img.style.opacity    = '0';
    setTimeout(() => {
      img.src = originalSrc;
      // Restore background blur
      const bg = slide.querySelector('.slide-bg');
      if (bg) bg.style.backgroundImage = `url("${originalSrc}")`;
      img.style.opacity = '1';
    }, animated ? 320 : 0);
  }

  // Ensure no leftover CSS transform
  wrap.style.transition    = 'none';
  wrap.style.transform     = 'scale(1)';
  wrap.style.transformOrigin = 'center center';
  wrap.classList.remove('region-zoomed');

  // Remove vignette
  const vig = slide.querySelector('.region-vignette');
  if (vig) {
    vig.classList.remove('active');
    setTimeout(() => vig.remove(), animated ? 500 : 0);
  }

  State.regionZoomed = false;

  // Restore button
  if (animated) {
    const btn  = document.getElementById('regionZoomBtn');
    const icon = document.getElementById('regionZoomIcon');
    const item = State.items[State.currentIndex];
    btn.disabled = false;
    btn.classList.remove('zoomed-in');
    icon.className = 'fa-solid fa-magnifying-glass-plus';
    document.getElementById('regionZoomLabel').textContent =
      (item && item.region_label) ? item.region_label : 'Detail ansehen';
  }
}

function toggleInfoPanel() {
  State.infoPanelVisible = !State.infoPanelVisible;
  const panel  = document.getElementById('infoPanel');
  const btn    = document.getElementById('infoToggleBtn');
  const viewer = document.getElementById('viewer');

  panel.classList.toggle('panel-hidden', !State.infoPanelVisible);
  btn.classList.toggle('active', State.infoPanelVisible);
  viewer.classList.toggle('panel-open', State.infoPanelVisible);

  // Adjust image container
  document.querySelectorAll('.slide-image-container').forEach(c => {
    c.classList.toggle('info-hidden', !State.infoPanelVisible);
  });
}

// ─── Progress ──────────────────────────────────────────────────
function updateProgress(index) {
  const pct = State.items.length > 1
    ? (index / (State.items.length - 1)) * 100
    : 100;
  document.getElementById('progressFill').style.width = pct + '%';
}

function updateNavButtons(index) {
  const left = document.getElementById('navLeft');
  const right = document.getElementById('navRight');
  left.disabled = index === 0;
  right.disabled = index === State.items.length - 1;
}

// ─── Overview ──────────────────────────────────────────────────
async function buildOverviewGrid() {
  const grid = document.getElementById('overviewGrid');
  grid.innerHTML = '';

  for (let i = 0; i < State.items.length; i++) {
    const item = State.items[i];
    const thumb = document.createElement('div');
    thumb.className = 'overview-thumb';
    thumb.dataset.index = i;
    thumb.id = `overview-${i}`;
    thumb.onclick = (e) => {
      e.preventDefault();
      toggleOverview();
      const slug = State.exhibition.slug || State.exhibition.id;
      // We don't pushState here as we are just moving within the exhibition
      goToSlide(i, ANIM_SEQUENCE[i % ANIM_SEQUENCE.length]);
    };

    if (item._resolvedUrl) {
      thumb.innerHTML = `<img src="${item._resolvedUrl}" alt="${escHtml(item.title)}" loading="lazy" onerror="this.style.display='none'" />`;
    } else {
      thumb.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.2);font-size:24px;"><i class="fa-solid fa-image"></i></div>`;
    }

    thumb.innerHTML += `
      <div class="overview-thumb-info">
        <div class="overview-thumb-num">${i + 1}</div>
        ${item.title ? `<div>${escHtml(item.title)}</div>` : ''}
      </div>`;

    grid.appendChild(thumb);
  }
}

function updateOverviewActive(index) {
  document.querySelectorAll('.overview-thumb').forEach(t => t.classList.remove('active-thumb'));
  const active = document.getElementById(`overview-${index}`);
  if (active) {
    active.classList.add('active-thumb');
    active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function toggleOverview() {
  State.overviewVisible = !State.overviewVisible;
  document.getElementById('overviewPanel').classList.toggle('hidden', !State.overviewVisible);
  document.getElementById('overviewBtn').classList.toggle('active', State.overviewVisible);
  if (State.overviewVisible) updateOverviewActive(State.currentIndex);
}

// ─── Keyboard ──────────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
      case 'PageDown':
        e.preventDefault();
        if (State.overviewVisible) return;
        navigate(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        if (State.overviewVisible) return;
        navigate(-1);
        break;
      case 'Escape':
        if (State.overviewVisible) toggleOverview();
        if (document.getElementById('introOverlay').classList.contains('hidden') === false) startExhibition();
        break;
      case 'i':
      case 'I':
        if (!document.getElementById('introOverlay').classList.contains('hidden')) return;
        toggleInfoPanel();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'g':
      case 'G':
        toggleOverview();
        break;
    }
  });
}

// ─── Touch ─────────────────────────────────────────────────────
function setupTouch() {
  const stage = document.getElementById('stage');

  stage.addEventListener('touchstart', (e) => {
    State.touchStartX = e.touches[0].clientX;
    State.touchStartY = e.touches[0].clientY;
  }, { passive: true });

  stage.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - State.touchStartX;
    const dy = e.changedTouches[0].clientY - State.touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      navigate(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  // Double tap for fullscreen
  let lastTap = 0;
  stage.addEventListener('touchend', () => {
    const now = Date.now();
    if (now - lastTap < 300) toggleFullscreen();
    lastTap = now;
  });
}

// ─── Mouse activity / auto-hide UI ────────────────────────────
function setupMouseActivity() {
  let uiVisible = true;

  const showUI = () => {
    if (!uiVisible) {
      document.getElementById('topBar').classList.remove('hidden-ui');
      document.getElementById('navLeft').classList.remove('hidden-ui');
      document.getElementById('navRight').classList.remove('hidden-ui');
      uiVisible = true;
    }
    clearTimeout(State.autoHideTimer);
    State.autoHideTimer = setTimeout(() => {
      if (State.currentIndex >= 0) {
        document.getElementById('topBar').classList.add('hidden-ui');
        document.getElementById('navLeft').classList.add('hidden-ui');
        document.getElementById('navRight').classList.add('hidden-ui');
        uiVisible = false;
      }
    }, 4000);
  };

  document.addEventListener('mousemove', showUI);
  document.addEventListener('click', showUI);
  document.addEventListener('touchstart', showUI, { passive: true });
}

// ─── Fullscreen ────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    document.getElementById('fullscreenIcon').className = 'fa-solid fa-compress';
  } else {
    document.exitFullscreen().catch(() => {});
    document.getElementById('fullscreenIcon').className = 'fa-solid fa-expand';
  }
}

document.addEventListener('fullscreenchange', () => {
  const icon = document.getElementById('fullscreenIcon');
  if (icon) {
    icon.className = document.fullscreenElement ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
  }
});

// ─── Loading ───────────────────────────────────────────────────
function showLoading(visible, text = '') {
  document.getElementById('loadingScreen').classList.toggle('hidden', !visible);
  if (text) document.getElementById('loadingText').textContent = text;
}

function setLoadingProgress(pct) {
  document.getElementById('loadingBar').style.width = pct + '%';
}

function setLoadingText(text) {
  document.getElementById('loadingText').textContent = text;
}

// ─── Error ─────────────────────────────────────────────────────
function showError(msg) {
  document.getElementById('landingOverlay').style.display = 'flex';
  document.getElementById('exhibitionPicker').innerHTML = `<div class="picker-empty" style="color:#e05555"><i class="fa-solid fa-triangle-exclamation"></i> ${escHtml(msg)}</div>`;
}

// ─── Utilities ─────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Impressum Panel ───────────────────────────────────────────
function openImpressum() {
  const panel = document.getElementById('impressumPanel');
  if (!panel) return;
  panel.classList.remove('hidden');
  // Close with Escape key
  document.addEventListener('keydown', _impressumEscHandler);
  // Click on backdrop closes panel
  panel.addEventListener('click', _impressumBackdropClick);
}

function closeImpressum() {
  const panel = document.getElementById('impressumPanel');
  if (!panel) return;
  // Animate out
  const inner = panel.querySelector('.impressum-inner');
  if (inner) {
    inner.style.animation = 'impPanelOut 0.28s cubic-bezier(0.4,0,0.2,1) forwards';
  }
  panel.style.animation = 'impBackdropOut 0.28s ease forwards';
  setTimeout(() => {
    panel.classList.add('hidden');
    panel.style.animation = '';
    if (inner) inner.style.animation = '';
  }, 290);
  document.removeEventListener('keydown', _impressumEscHandler);
  panel.removeEventListener('click', _impressumBackdropClick);
}

function _impressumEscHandler(e) {
  if (e.key === 'Escape') closeImpressum();
}

function _impressumBackdropClick(e) {
  // Only close when clicking the backdrop (not the panel inner)
  if (!e.target.closest('.impressum-inner')) closeImpressum();
}

// Global functions for HTML onclick handlers
window.toggleOverview = toggleOverview;
window.toggleInfoPanel = toggleInfoPanel;
window.toggleFullscreen = toggleFullscreen;
window.navigate = navigate;
window.toggleRegionZoom = toggleRegionZoom;
window.openImpressum = openImpressum;
window.closeImpressum = closeImpressum;
window.startExhibition = startExhibition;
