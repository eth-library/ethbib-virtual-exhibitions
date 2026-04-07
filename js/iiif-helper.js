/* ============================================================
   IIIF Helper Utilities
   ============================================================ */

/**
 * Given a IIIF URL (info.json or manifest.json), return an image URL
 * suitable for embedding (thumbnail or full image).
 */
async function resolveIIIFImageUrl(iiifUrl, type = 'image', size = 400) {
  if (!iiifUrl) return null;

  try {
    if (type === 'manifest' || iiifUrl.includes('manifest')) {
      // Fetch manifest and extract first canvas image
      const resp = await fetch(iiifUrl);
      const manifest = await resp.json();

      // IIIF v2
      if (manifest['@type'] === 'sc:Manifest' || manifest.sequences) {
        const canvas = manifest.sequences?.[0]?.canvases?.[0];
        const imgResource = canvas?.images?.[0]?.resource;
        if (imgResource) {
          const serviceId = imgResource.service?.['@id'] || imgResource['@id'];
          if (serviceId) return `${serviceId.replace(/\/$/, '')}/full/${size},/0/default.jpg`;
          if (imgResource['@id']) return imgResource['@id'];
        }
      }

      // IIIF v3
      if (manifest.type === 'Manifest' || manifest.items) {
        const canvas = manifest.items?.[0];
        const annoPage = canvas?.items?.[0];
        const anno = annoPage?.items?.[0];
        const body = anno?.body;
        if (body) {
          const service = Array.isArray(body.service) ? body.service[0] : body.service;
          const serviceId = service?.id || service?.['@id'];
          if (serviceId) return `${serviceId.replace(/\/$/, '')}/full/${size},/0/default.jpg`;
          if (body.id) return body.id;
        }
      }
    }

    // Direct info.json
    if (iiifUrl.endsWith('info.json') || type === 'image') {
      const baseUrl = iiifUrl.replace(/\/info\.json$/, '');
      return `${baseUrl}/full/${size},/0/default.jpg`;
    }

    return iiifUrl;
  } catch (e) {
    console.warn('IIIF resolve error:', e);
    // Fallback: try to use URL as-is
    if (iiifUrl.endsWith('info.json')) {
      return iiifUrl.replace('/info.json', `/full/${size},/0/default.jpg`);
    }
    return null;
  }
}

/**
 * Resolve full-resolution IIIF image URL for the viewer
 */
async function resolveIIIFFullImageUrl(iiifUrl, type = 'image') {
  if (!iiifUrl) return null;

  try {
    if (type === 'manifest' || iiifUrl.includes('manifest')) {
      const resp = await fetch(iiifUrl);
      const manifest = await resp.json();

      // IIIF v2
      if (manifest.sequences) {
        const canvas = manifest.sequences?.[0]?.canvases?.[0];
        const imgResource = canvas?.images?.[0]?.resource;
        if (imgResource) {
          const serviceId = imgResource.service?.['@id'] || imgResource['@id'];
          if (serviceId) return `${serviceId.replace(/\/$/, '')}/full/full/0/default.jpg`;
          if (imgResource['@id']) return imgResource['@id'];
        }
      }

      // IIIF v3
      if (manifest.items) {
        const canvas = manifest.items?.[0];
        const anno = canvas?.items?.[0]?.items?.[0];
        const body = anno?.body;
        if (body) {
          const service = Array.isArray(body.service) ? body.service[0] : body.service;
          const serviceId = service?.id || service?.['@id'];
          if (serviceId) return `${serviceId.replace(/\/$/, '')}/full/full/0/default.jpg`;
          if (body.id) return body.id;
        }
      }
    }

    if (iiifUrl.endsWith('info.json') || type === 'image') {
      const baseUrl = iiifUrl.replace(/\/info\.json$/, '');
      return `${baseUrl}/full/full/0/default.jpg`;
    }

    return iiifUrl;
  } catch (e) {
    if (iiifUrl.endsWith('info.json')) {
      return iiifUrl.replace('/info.json', '/full/full/0/default.jpg');
    }
    return null;
  }
}

/**
 * Extract IIIF info.json base URL from any IIIF URL
 */
function extractIIIFBaseUrl(iiifUrl, type = 'image') {
  if (!iiifUrl) return null;
  if (iiifUrl.endsWith('info.json')) return iiifUrl.replace('/info.json', '');
  return iiifUrl;
}

/**
 * Fetch the original full image dimensions (width × height) from a IIIF
 * image base URL via info.json.  Returns { width, height } or null on error.
 *
 * The result is cached per base-URL so each image is only fetched once.
 */
const _iiifDimCache = {};
async function fetchIIIFOriginalDimensions(iiifBaseUrl) {
  if (!iiifBaseUrl) return null;
  // Normalise: strip any trailing path segments that aren't the identifier
  // (e.g. if someone passes a full image URL instead of the base)
  const base = iiifBaseUrl
    .replace(/\/info\.json$/, '')
    .replace(/\/(full|square|\d[^/]*)\/[^/]+\/[^/]+\/[^/]+$/, '');  // strip /region/size/rotation/quality.ext

  if (_iiifDimCache[base]) return _iiifDimCache[base];

  try {
    const resp = await fetch(`${base}/info.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const info = await resp.json();
    // IIIF Image API v2 and v3 both expose width/height at the top level
    const w = info.width  || info.sizes?.[info.sizes.length - 1]?.width;
    const h = info.height || info.sizes?.[info.sizes.length - 1]?.height;
    if (w && h) {
      const dims = { width: w, height: h };
      _iiifDimCache[base] = dims;
      return dims;
    }
  } catch (e) {
    console.warn('IIIF info.json fetch failed:', base, e);
  }
  return null;
}

/**
 * Build a IIIF Image API URL for a specific region.
 *
 * @param {string} iiifBaseUrl  – IIIF image base URL (without /info.json)
 * @param {object} region       – { x, y, w, h, pct }  (original-pixel or percent)
 * @param {number} maxSize      – max dimension for the requested tile (default 1600)
 * @returns {string}  Full IIIF URL for the region
 */
function buildIIIFRegionUrl(iiifBaseUrl, region, maxSize = 1600) {
  const base = iiifBaseUrl.replace(/\/info\.json$/, '');
  const regionStr = region.pct
    ? `pct:${region.x},${region.y},${region.w},${region.h}`
    : `${region.x},${region.y},${region.w},${region.h}`;
  return `${base}/${regionStr}/!${maxSize},${maxSize}/0/default.jpg`;
}

window.IIIFHelper = {
  resolveIIIFImageUrl,
  resolveIIIFFullImageUrl,
  extractIIIFBaseUrl,
  fetchIIIFOriginalDimensions,
  buildIIIFRegionUrl,
};
