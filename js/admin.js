/* ============================================================
   ADMIN.JS – Virtuelle Ausstellung
   (Updated for Firebase Firestore)
   ============================================================ */

import { db } from './firebase-config.js';
import { 
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc, 
  query, where, orderBy, limit, writeBatch, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// ─── State ────────────────────────────────────────────────────
let itemCounter = 0;
let currentExhibitionId = null;
let currentItems = []; // items while editing

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Color picker sync
  const colorInput = document.getElementById('exhAccentColor');
  const colorHex   = document.getElementById('exhAccentColorHex');
  if (colorInput && colorHex) {
    colorInput.addEventListener('input', () => { colorHex.textContent = colorInput.value; });
  }

  // Auto-generate slug from title
  const titleInput = document.getElementById('exhTitle');
  if (titleInput) {
    titleInput.addEventListener('input', (e) => {
      const slug = document.getElementById('exhSlug');
      if (!currentExhibitionId) { // Only auto-fill for new exhibitions
        slug.value = slugify(e.target.value);
      }
    });
  }

  // loadExhibitions is called by the auth observer in admin.html
});

// ─── Navigation ───────────────────────────────────────────────
function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`view-${view}`)?.classList.remove('hidden');
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

  const titles = {
    'exhibitions': 'Ausstellungen',
    'new-exhibition': currentExhibitionId ? 'Ausstellung bearbeiten' : 'Neue Ausstellung',
    'detail': 'Ausstellung Details'
  };
  document.getElementById('viewTitle').textContent = titles[view] || view;

  if (view === 'exhibitions') loadExhibitions();
  if (view === 'new-exhibition' && !currentExhibitionId) resetExhibitionForm();
}

// ─── Load Exhibitions ──────────────────────────────────────────
async function loadExhibitions() {
  const list = document.getElementById('exhibitionsList');
  if (!list) return;
  list.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Lade Ausstellungen…</div>';

  try {
    const q = query(collection(db, "exhibitions"), orderBy("created_at", "desc"), limit(100));
    const querySnapshot = await getDocs(q);
    const exhibitions = [];
    querySnapshot.forEach((doc) => {
      exhibitions.push({ id: doc.id, ...doc.data() });
    });

    if (exhibitions.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-images"></i>
          <h3>Noch keine Ausstellungen</h3>
          <p>Erstellen Sie Ihre erste virtuelle Ausstellung.</p>
          <br/>
          <button class="btn btn-primary" onclick="showView('new-exhibition')">
            <i class="fa-solid fa-plus"></i> Neue Ausstellung
          </button>
        </div>`;
      return;
    }

    list.innerHTML = '';
    for (const exh of exhibitions) {
      list.appendChild(await buildExhibitionCard(exh));
    }
  } catch (e) {
    console.error("Error loading exhibitions:", e);
    list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Fehler beim Laden</h3><p>${e.message}</p></div>`;
  }
}

async function buildExhibitionCard(exh) {
  const card = document.createElement('div');
  card.className = 'exhibition-card';

  let coverHtml = '<div class="cover-placeholder"><i class="fa-solid fa-image"></i></div>';
  if (exh.cover_image_url) {
    const imgUrl = await IIIFHelper.resolveIIIFImageUrl(exh.cover_image_url, 'image', 400).catch(() => null);
    if (imgUrl) coverHtml = `<img src="${imgUrl}" alt="${escHtml(exh.title)}" loading="lazy" onerror="this.style.display='none'" />`;
  }

  const badge = exh.is_published
    ? '<span class="exhibition-badge badge-published">Publiziert</span>'
    : '<span class="exhibition-badge badge-draft">Entwurf</span>';

  const meta = [exh.curator, exh.institution, exh.year].filter(Boolean).join(' · ');

  card.innerHTML = `
    <div class="exhibition-card-cover">
      ${coverHtml}
      ${badge}
    </div>
    <div class="exhibition-card-body">
      <h3>${escHtml(exh.title || 'Unbenannt')}</h3>
      ${meta ? `<div class="meta">${escHtml(meta)}</div>` : ''}
      <p>${escHtml(exh.description || '')}</p>
    </div>
    <div class="exhibition-card-footer">
      <button class="btn btn-outline btn-sm" onclick="openDetail('${exh.id}')">
        <i class="fa-solid fa-list"></i> Exponate
      </button>
      <button class="btn btn-outline btn-sm" onclick="editExhibition('${exh.id}')">
        <i class="fa-solid fa-pen"></i> Bearbeiten
      </button>
      <button class="btn btn-danger btn-sm" onclick="deleteExhibition('${exh.id}', event)">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`;

  return card;
}

// ─── Exhibition Form ───────────────────────────────────────────
function resetExhibitionForm() {
  currentExhibitionId = null;
  currentItems = [];
  itemCounter = 0;

  document.getElementById('editExhibitionId').value = '';
  document.getElementById('exhTitle').value = '';
  document.getElementById('exhSubtitle').value = '';
  document.getElementById('exhCurator').value = '';
  document.getElementById('exhInstitution').value = '';
  document.getElementById('exhYear').value = '';
  document.getElementById('exhAccentColor').value = '#c8a97e';
  document.getElementById('exhAccentColorHex').textContent = '#c8a97e';
  document.getElementById('exhCoverUrl').value = '';
  document.getElementById('exhDescription').value = '';
  document.getElementById('exhSlug').value = '';
  document.getElementById('exhPublished').checked = false;
  document.getElementById('coverPreview').classList.add('hidden');
  document.getElementById('itemsContainer').innerHTML = '';
  document.getElementById('saveBtn').innerHTML = '<i class="fa-solid fa-save"></i> Ausstellung speichern';
}

async function editExhibition(id) {
  currentExhibitionId = id;
  showView('new-exhibition');
  document.getElementById('viewTitle').textContent = 'Ausstellung bearbeiten';
  document.getElementById('saveBtn').innerHTML = '<i class="fa-solid fa-save"></i> Änderungen speichern';

  try {
    const docRef = doc(db, "exhibitions", id);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      showToast('Ausstellung nicht gefunden.', 'error');
      return;
    }
    const exh = docSnap.data();

    document.getElementById('editExhibitionId').value = id;
    document.getElementById('exhTitle').value = exh.title || '';
    document.getElementById('exhSubtitle').value = exh.subtitle || '';
    document.getElementById('exhCurator').value = exh.curator || '';
    document.getElementById('exhInstitution').value = exh.institution || '';
    document.getElementById('exhYear').value = exh.year || '';
    document.getElementById('exhAccentColor').value = exh.accent_color || '#c8a97e';
    document.getElementById('exhAccentColorHex').textContent = exh.accent_color || '#c8a97e';
    document.getElementById('exhCoverUrl').value = exh.cover_image_url || '';
    document.getElementById('exhDescription').value = exh.description || '';
    document.getElementById('exhSlug').value = exh.slug || '';
    document.getElementById('exhPublished').checked = !!exh.is_published;

    if (exh.cover_image_url) previewCover();

    // Load items
    const iq = query(collection(db, "exhibit_items"), where("exhibition_id", "==", id), orderBy("sort_order", "asc"), limit(200));
    const itemsSnapshot = await getDocs(iq);
    const items = [];
    itemsSnapshot.forEach((doc) => {
      items.push({ id: doc.id, ...doc.data() });
    });

    document.getElementById('itemsContainer').innerHTML = '';
    itemCounter = 0;
    for (const item of items) {
      addItemRow(item);
    }
  } catch (e) {
    console.error("Error editing exhibition:", e);
    showToast('Fehler beim Laden: ' + e.message, 'error');
  }
}

async function saveExhibition(event) {
  event.preventDefault();
  const btn = document.getElementById('saveBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Speichere…';
  btn.disabled = true;

  const exhData = {
    title: document.getElementById('exhTitle').value.trim(),
    subtitle: document.getElementById('exhSubtitle').value.trim(),
    curator: document.getElementById('exhCurator').value.trim(),
    institution: document.getElementById('exhInstitution').value.trim(),
    year: document.getElementById('exhYear').value.trim(),
    accent_color: document.getElementById('exhAccentColor').value,
    cover_image_url: document.getElementById('exhCoverUrl').value.trim(),
    description: document.getElementById('exhDescription').value.trim(),
    slug: document.getElementById('exhSlug').value.trim(),
    is_published: document.getElementById('exhPublished').checked,
    updated_at: serverTimestamp()
  };

  try {
    let exhId = currentExhibitionId;

    if (exhId) {
      await updateDoc(doc(db, "exhibitions", exhId), exhData);
    } else {
      exhData.created_at = serverTimestamp();
      const docRef = await addDoc(collection(db, "exhibitions"), exhData);
      exhId = docRef.id;
      currentExhibitionId = exhId;
      document.getElementById('editExhibitionId').value = exhId;
    }

    // Collect items from DOM
    const itemRows = document.querySelectorAll('#itemsContainer .item-row');
    const existingItemsQuery = query(collection(db, "exhibit_items"), where("exhibition_id", "==", exhId));
    const existingSnapshot = await getDocs(existingItemsQuery);
    const existingIds = new Set();
    existingSnapshot.forEach(doc => existingIds.add(doc.id));

    const processedIds = new Set();
    const batch = writeBatch(db);

    for (let i = 0; i < itemRows.length; i++) {
        const row = itemRows[i];
        const itemData = collectItemData(row, exhId, i + 1);
        const itemId = row.dataset.itemId;

        if (itemId && existingIds.has(itemId)) {
            batch.update(doc(db, "exhibit_items", itemId), { ...itemData, updated_at: serverTimestamp() });
            processedIds.add(itemId);
        } else {
            const newItemRef = doc(collection(db, "exhibit_items"));
            batch.set(newItemRef, { ...itemData, created_at: serverTimestamp(), updated_at: serverTimestamp() });
            row.dataset.itemId = newItemRef.id;
            processedIds.add(newItemRef.id);
        }
    }

    // Delete removed items
    existingSnapshot.forEach(doc => {
      if (!processedIds.has(doc.id)) {
        batch.delete(doc.ref);
      }
    });

    await batch.commit();

    showToast('Ausstellung gespeichert!', 'success');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Gespeichert';
    setTimeout(() => {
      btn.innerHTML = '<i class="fa-solid fa-save"></i> Änderungen speichern';
      btn.disabled = false;
    }, 2000);

  } catch (e) {
    console.error("Error saving exhibition:", e);
    showToast('Fehler: ' + e.message, 'error');
    btn.innerHTML = '<i class="fa-solid fa-save"></i> Ausstellung speichern';
    btn.disabled = false;
  }
}

function collectItemData(row, exhibitionId, order) {
  const get = (name) => {
    const el = row.querySelector(`[name="${name}"]`);
    return el ? (el.tagName === 'SELECT' ? el.value : el.value.trim()) : '';
  };
  return {
    exhibition_id: exhibitionId,
    sort_order: order,
    iiif_url: get('iiif_url'),
    iiif_type: get('iiif_type'),
    title: get('title'),
    subtitle: get('subtitle'),
    artist: get('artist'),
    date: get('date'),
    medium: get('medium'),
    dimensions: get('dimensions'),
    collection: get('collection'),
    description: get('description'),
    region_x: parseFloat(get('region_x')) || null,
    region_y: parseFloat(get('region_y')) || null,
    region_w: parseFloat(get('region_w')) || null,
    region_h: parseFloat(get('region_h')) || null,
    region_pct: !!(row.querySelector('[name="region_pct"]')?.checked),
    region_label: get('region_label'),
    custom_label_1: get('custom_label_1'),
    custom_value_1: get('custom_value_1'),
    custom_label_2: get('custom_label_2'),
    custom_value_2: get('custom_value_2'),
  };
}

async function deleteExhibition(id, event) {
  if (event) event.stopPropagation();
  if (!confirm('Ausstellung wirklich löschen? Alle Exponate werden ebenfalls gelöscht.')) return;

  try {
    const batch = writeBatch(db);
    
    // Delete all items first
    const iq = query(collection(db, "exhibit_items"), where("exhibition_id", "==", id));
    const itemsSnapshot = await getDocs(iq);
    itemsSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Delete exhibition
    batch.delete(doc(db, "exhibitions", id));
    
    await batch.commit();
    showToast('Ausstellung gelöscht.', 'success');
    loadExhibitions();
  } catch (e) {
    console.error("Error deleting exhibition:", e);
    showToast('Fehler: ' + e.message, 'error');
  }
}

// ─── Item Rows ─────────────────────────────────────────────────
function addItemRow(data = null) {
  const template = document.getElementById('itemRowTemplate');
  if (!template) return;
  const clone = template.content.cloneNode(true);
  const row = clone.querySelector('.item-row');

  itemCounter++;
  row.dataset.index = itemCounter;
  if (data?.id) row.dataset.itemId = data.id;

  row.querySelector('.item-num-label').textContent = document.querySelectorAll('#itemsContainer .item-row').length + 1;

  if (data) {
    const setVal = (name, val) => {
      const el = row.querySelector(`[name="${name}"]`);
      if (el) {
        if (el.tagName === 'SELECT') el.value = val || 'image';
        else el.value = val || '';
      }
    };
    setVal('iiif_url', data.iiif_url);
    setVal('iiif_type', data.iiif_type);
    setVal('title', data.title);
    setVal('subtitle', data.subtitle);
    setVal('artist', data.artist);
    setVal('date', data.date);
    setVal('medium', data.medium);
    setVal('dimensions', data.dimensions);
    setVal('collection', data.collection);
    setVal('description', data.description);
    setVal('custom_label_1', data.custom_label_1);
    setVal('custom_value_1', data.custom_value_1);
    setVal('custom_label_2', data.custom_label_2);
    setVal('custom_value_2', data.custom_value_2);
    // Region fields
    if (data.region_x != null) setVal('region_x', data.region_x);
    if (data.region_y != null) setVal('region_y', data.region_y);
    if (data.region_w != null) setVal('region_w', data.region_w);
    if (data.region_h != null) setVal('region_h', data.region_h);
    setVal('region_label', data.region_label);
    const regionPctEl = row.querySelector('[name="region_pct"]');
    if (regionPctEl) regionPctEl.checked = !!data.region_pct;
    // Auto-open region section if region is set
    if (data.region_w || data.region_h) {
      const regionDetails = row.querySelector('.region-fields');
      if (regionDetails) regionDetails.open = true;
    }
  }

  document.getElementById('itemsContainer').appendChild(row);
  renumberItems();
}

function removeItem(btn) {
  const row = btn.closest('.item-row');
  if (confirm('Exponat entfernen?')) {
    row.remove();
    renumberItems();
  }
}

function moveItem(btn, direction) {
  const row = btn.closest('.item-row');
  const container = document.getElementById('itemsContainer');
  const rows = [...container.querySelectorAll('.item-row')];
  const idx = rows.indexOf(row);
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= rows.length) return;
  if (direction === -1) container.insertBefore(row, rows[newIdx]);
  else container.insertBefore(rows[newIdx], row);
  renumberItems();
}

function renumberItems() {
  const rows = document.querySelectorAll('#itemsContainer .item-row');
  rows.forEach((row, i) => {
    const label = row.querySelector('.item-num-label');
    if (label) label.textContent = i + 1;
  });
}

// ─── Region Preview ───────────────────────────────────────────
async function previewRegion(btn) {
  const row = btn.closest('.item-row');
  if (!row) {
    showToast('Fehler: Exponat-Zeile nicht gefunden.', 'error');
    return;
  }

  const urlInput   = row.querySelector('[name="iiif_url"]');
  const typeSelect = row.querySelector('[name="iiif_type"]');
  const rxEl  = row.querySelector('[name="region_x"]');
  const ryEl  = row.querySelector('[name="region_y"]');
  const rwEl  = row.querySelector('[name="region_w"]');
  const rhEl  = row.querySelector('[name="region_h"]');
  const pctEl = row.querySelector('[name="region_pct"]');
  const previewEl = row.querySelector('.region-preview');
  const fullEl    = row.querySelector('.region-preview-full');
  const cropEl    = row.querySelector('.region-preview-crop');
  const urlEl     = row.querySelector('.region-preview-url');

  const url  = urlInput?.value?.trim() || '';
  const type = typeSelect?.value || 'image';

  // Read values
  const xRaw = rxEl?.value ?? '';
  const yRaw = ryEl?.value ?? '';
  const wRaw = rwEl?.value ?? '';
  const hRaw = rhEl?.value ?? '';

  const x  = xRaw !== '' ? parseFloat(xRaw) : 0;
  const y  = yRaw !== '' ? parseFloat(yRaw) : 0;
  const w  = wRaw !== '' ? parseFloat(wRaw) : NaN;
  const h  = hRaw !== '' ? parseFloat(hRaw) : NaN;
  const pct = pctEl?.checked ?? false;

  // Validate
  if (!url) {
    showToast('Bitte zuerst eine IIIF URL eingeben.', 'error');
    return;
  }
  if (isNaN(w) || w <= 0) {
    showToast('Bitte eine Breite (W) grösser als 0 eingeben.', 'error');
    return;
  }
  if (isNaN(h) || h <= 0) {
    showToast('Bitte eine Höhe (H) grösser als 0 eingeben.', 'error');
    return;
  }

  // Show loading state
  previewEl.classList.remove('hidden');
  fullEl.innerHTML  = '<div style="padding:16px;color:var(--text-muted);font-size:12px"><i class="fa-solid fa-spinner fa-spin"></i> Laden…</div>';
  cropEl.innerHTML  = '<div style="padding:16px;color:var(--text-muted);font-size:12px"><i class="fa-solid fa-spinner fa-spin"></i> Laden…</div>';
  urlEl.textContent = '';

  // Resolve base URL from info.json or manifest
  let baseUrl = url.replace(/\/info\.json$/, '').replace(/\/$/, '');

  if (type === 'manifest' || url.toLowerCase().includes('manifest')) {
    try {
      const resp = await fetch(url);
      const manifest = await resp.json();
      // IIIF v2
      if (manifest.sequences) {
        const imgRes = manifest.sequences?.[0]?.canvases?.[0]?.images?.[0]?.resource;
        const sid = imgRes?.service?.['@id'] || imgRes?.['@id'];
        if (sid) baseUrl = sid.replace(/\/$/, '');
      }
      // IIIF v3
      else if (manifest.items) {
        const body = manifest.items?.[0]?.items?.[0]?.items?.[0]?.body;
        const service = Array.isArray(body?.service) ? body.service[0] : body?.service;
        const sid = service?.id || service?.['@id'];
        if (sid) baseUrl = sid.replace(/\/$/, '');
      }
    } catch(e) {
      console.warn('Manifest fetch failed:', e);
    }
  }

  // Build IIIF URLs
  const regionStr = pct
    ? `pct:${x},${y},${w},${h}`
    : `${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`;

  const fullUrl   = `${baseUrl}/full/!800,600/0/default.jpg`;
  const regionUrl = `${baseUrl}/${regionStr}/!800,600/0/default.jpg`;

  fullEl.innerHTML  = `<img src="${fullUrl}" alt="Vollbild"
    style="max-width:100%;max-height:160px;object-fit:contain;"
    onerror="this.outerHTML='<span style=color:#e05555;font-size:12px;padding:8px>Bild konnte nicht geladen werden</span>'" />`;

  cropEl.innerHTML  = `<img src="${regionUrl}" alt="Ausschnitt"
    style="max-width:100%;max-height:160px;object-fit:contain;"
    onerror="this.outerHTML='<span style=color:#e05555;font-size:12px;padding:8px>Region-URL ungültig – Koordinaten prüfen</span>'" />`;

  urlEl.innerHTML = `<span style="color:var(--accent)">Vollbild:</span> ${escHtml(fullUrl)}<br/><span style="color:var(--accent)">Region:</span> ${escHtml(regionUrl)}`;
}

// ─── Image Preview ─────────────────────────────────────────────
async function previewCover() {
  const url = document.getElementById('exhCoverUrl').value.trim();
  const preview = document.getElementById('coverPreview');
  if (!url) { preview.classList.add('hidden'); return; }

  const imgUrl = await IIIFHelper.resolveIIIFImageUrl(url, 'image', 600).catch(() => null);
  if (imgUrl) {
    preview.innerHTML = `<img src="${imgUrl}" alt="Cover Vorschau" onerror="this.parentElement.innerHTML='<p style=padding:12px;color:#e05555>Bild konnte nicht geladen werden.</p>'" />`;
    preview.classList.remove('hidden');
  } else {
    preview.innerHTML = '<p style="padding:12px;color:#e05555">URL konnte nicht aufgelöst werden.</p>';
    preview.classList.remove('hidden');
  }
}

async function previewItemImage(btn) {
  const row = btn.closest('.item-row');
  const urlInput = row.querySelector('[name="iiif_url"]');
  const typeSelect = row.querySelector('[name="iiif_type"]');
  const preview = row.querySelector('.img-preview');

  const url = urlInput?.value?.trim();
  const type = typeSelect?.value || 'image';
  if (!url) return;

  const imgUrl = await IIIFHelper.resolveIIIFImageUrl(url, type, 400).catch(() => null);
  if (imgUrl) {
    preview.innerHTML = `<img src="${imgUrl}" alt="Vorschau" style="max-height:200px" onerror="this.parentElement.innerHTML='<p style=padding:12px;color:#e05555>Bild nicht ladbar.</p>'" />`;
    preview.classList.remove('hidden');
  } else {
    preview.innerHTML = '<p style="padding:12px;color:#e05555">URL konnte nicht aufgelöst werden.</p>';
    preview.classList.remove('hidden');
  }
}

// ─── Detail View ───────────────────────────────────────────────
async function openDetail(id) {
  showView('detail');
  document.getElementById('viewTitle').textContent = 'Exponat-Übersicht';
  const content = document.getElementById('detailContent');
  if (!content) return;
  content.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Lade…</div>';

  try {
    const docRef = doc(db, "exhibitions", id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      content.innerHTML = '<div class="empty-state">Ausstellung nicht gefunden.</div>';
      return;
    }
    const exh = docSnap.data();

    const iq = query(collection(db, "exhibit_items"), where("exhibition_id", "==", id), orderBy("sort_order", "asc"), limit(200));
    const itemsSnapshot = await getDocs(iq);
    const items = [];
    itemsSnapshot.forEach((doc) => {
      items.push({ id: doc.id, ...doc.data() });
    });

    let coverHtml = '<div class="detail-cover-placeholder"><i class="fa-solid fa-image"></i></div>';
    if (exh.cover_image_url) {
      const imgUrl = await IIIFHelper.resolveIIIFImageUrl(exh.cover_image_url, 'image', 300).catch(() => null);
      if (imgUrl) coverHtml = `<img src="${imgUrl}" alt="${escHtml(exh.title)}" onerror="this.style.display='none'" />`;
    }

    const viewUrl = `index.html?exhibition=${exh.slug || id}`;
    const meta = [exh.curator, exh.institution, exh.year].filter(Boolean).join(' · ');

    let itemsHtml = '';
    for (const item of items) {
      let thumbHtml = '<div style="width:90px;height:70px;background:var(--surface-2);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:22px;"><i class="fa-solid fa-image"></i></div>';
      if (item.iiif_url) {
        const imgUrl = await IIIFHelper.resolveIIIFImageUrl(item.iiif_url, item.iiif_type || 'image', 120).catch(() => null);
        if (imgUrl) thumbHtml = `<div class="item-list-thumb"><img src="${imgUrl}" alt="${escHtml(item.title)}" onerror="this.style.display='none'" /></div>`;
      }
      const itemMeta = [item.artist, item.date, item.medium].filter(Boolean).join(' · ');
      itemsHtml += `
        <div class="item-list-card">
          ${thumbHtml}
          <div class="item-list-info">
            <h4>${escHtml(item.title || 'Ohne Titel')}</h4>
            ${itemMeta ? `<div class="meta">${escHtml(itemMeta)}</div>` : ''}
            <p>${escHtml(item.description || '')}</p>
          </div>
          <div style="font-size:12px;color:var(--text-dim);padding-top:2px;">#${item.sort_order}</div>
        </div>`;
    }

    content.innerHTML = `
      <div class="detail-header">
        <div class="detail-cover">${coverHtml}</div>
        <div class="detail-info">
          <h2>${escHtml(exh.title)}</h2>
          ${meta ? `<div class="meta">${escHtml(meta)}</div>` : ''}
          <p>${escHtml(exh.description || '')}</p>
        </div>
        <div class="detail-actions">
          <a href="${viewUrl}" target="_blank" class="btn btn-primary btn-sm">
            <i class="fa-solid fa-eye"></i> Ansehen
          </a>
          <button class="btn btn-outline btn-sm" onclick="editExhibition('${id}')">
            <i class="fa-solid fa-pen"></i> Bearbeiten
          </button>
        </div>
      </div>
      <div class="items-list">
        ${items.length === 0 ? '<div class="empty-state"><i class="fa-solid fa-image"></i><h3>Noch keine Exponate</h3><p>Bearbeiten Sie die Ausstellung um Exponate hinzuzufügen.</p></div>' : itemsHtml}
      </div>`;

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  } catch (e) {
    console.error("Error opening detail:", e);
    content.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>Fehler</h3><p>${e.message}</p></div>`;
  }
}

// ─── Utilities ─────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// Global functions for HTML onclick handlers
window.loadExhibitions = loadExhibitions;
window.showView = showView;
window.editExhibition = editExhibition;
window.saveExhibition = saveExhibition;
window.deleteExhibition = deleteExhibition;
window.addItemRow = addItemRow;
window.removeItem = removeItem;
window.moveItem = moveItem;
window.previewCover = previewCover;
window.previewItemImage = previewItemImage;
window.previewRegion = previewRegion;
window.openDetail = openDetail;
window.showToast = showToast;
