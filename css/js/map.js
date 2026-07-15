// ╔══════════════════════════════════════════════╗
// ║  CONFIG — update these two values            ║
// ╚══════════════════════════════════════════════╝
const SHEET_CSV_URL  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRasFFahZ99QPZhYfeAgFIEw5mf5yievDY4JCd55WArORfjk_5NVFKjo50qoyI36PF1e4iUT7kKS0Hr/pub?output=csv';
const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeGCGK3xjOS-F8s1BXwow29UaXNWmXQ3mWYUddt2apAiLO6ug/viewform?usp=preview';

// Google Forms often changes capitalisation and wording in the response sheet.
// These aliases match the headings visible in your form as well as the old names.
const COL_ALIASES = {
  type:      ['Type of Reporting', 'Report Type', 'Type of Report'],
  route:     ['Bus Route Number', 'Route Number', 'Bus route number'],
  stop:      ['Bus stop / Location name', 'Bus Stop / Location Name', 'Bus Stop', 'Location Name'],
  crowding:  ['Crowding Level', 'Crowding level'],
  delay:     ['Delay Duration (minutes)', 'Delay duration (minutes)', 'Delay Duration'],
  desc:      ['Issue Description', 'Description', 'Issue description'],
  time:      ['Time', 'Time of Incident', 'Incident Time'],
  timestamp: ['Timestamp', 'Submission Time'],
  lat:       ['Latitude', 'Lat'],
  lng:       ['Longitude', 'Lng', 'Lon'],
};

// Optional: add two short-answer questions called Latitude and Longitude to the
// Google Form, then put their entry IDs here. Leave blank to use stop-name geocoding.
const FORM_ENTRY_LAT = '';
const FORM_ENTRY_LNG = '';

// Colours per report type
const COLORS = {
  'Overcrowding': '#e94560',
  'Delay':        '#f59e0b',
  'Lost Item':    '#4ecdc4',
  'Misconduct':   '#a855f7',
};
const TYPE_ICONS = {
  'Overcrowding': '🚌',
  'Delay':        '⏱️',
  'Lost Item':    '🎒',
  'Misconduct':   '⚠️',
};

// ── Map init ─────────────────────────────────
const map = L.map('map', { zoomControl: false }).setView([6.9271, 79.8612], 13);
L.control.zoom({ position: 'topleft' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
  maxZoom: 19
}).addTo(map);

// ── GeoJSON layers ────────────────────────────
fetch('data/boundary.geojson').then(r => r.json()).then(data => {
  L.geoJSON(data, {
    style: { color: '#e94560', weight: 2, fillOpacity: 0.04, fillColor: '#e94560', dashArray: '6 4' }
  }).addTo(map);
}).catch(() => {});

fetch('data/road_network.geojson').then(r => r.json()).then(data => {
  L.geoJSON(data, {
    style: { color: '#1e3a5f', weight: 1.2, opacity: 0.8 }
  }).addTo(map);
}).catch(() => {});

let busStopsLayer = null;
fetch('data/bus_stops.geojson').then(r => r.json()).then(data => {
  const busStopIcon = L.divIcon({
    className: '',
    html: `<div style="width:9px;height:9px;background:#06b6d4;border-radius:50%;border:2px solid #fff;box-shadow:0 0 4px rgba(6,182,212,0.6)"></div>`,
    iconSize: [9,9], iconAnchor: [4.5,4.5]
  });
  busStopsLayer = L.geoJSON(data, {
    pointToLayer: (f, ll) => L.marker(ll, { icon: busStopIcon }),
    onEachFeature: (f, layer) => {
      const n = f.properties.name || f.properties.Name || 'Bus Stop';
      layer.bindPopup(`<b style="color:#06b6d4">🚏 ${n}</b>`);
    }
  }).addTo(map);
}).catch(() => {});

// ── User location ─────────────────────────────
let userMarker = null;
let currentLocation = null;

function locateMe() {
  const btn = document.getElementById('locate-hdr-btn');
  if (!navigator.geolocation) { showToast('❌ Geolocation not supported'); return; }

  btn.textContent = '⏳ Locating…';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      currentLocation = { lat, lng };

      if (userMarker) map.removeLayer(userMarker);

      const icon = L.divIcon({
        className: '',
        html: `<div class="user-location-marker"><div class="pulse"></div><div class="dot"></div></div>`,
        iconSize: [18,18], iconAnchor: [9,9]
      });

      userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
        .bindPopup(`<b style="color:#2563eb">📍 You are here</b><br><small style="color:#94a3b8">±${Math.round(pos.coords.accuracy)} m accuracy</small>`)
        .addTo(map);

      map.flyTo([lat, lng], 15, { duration: 1.4 });
      userMarker.openPopup();

      btn.textContent = '📍 My Location';
      btn.disabled = false;
      showToast('📍 Location found');
    },
    (err) => {
      const msgs = { 1: '❌ Permission denied', 2: '❌ Position unavailable', 3: '❌ Request timed out' };
      showToast(msgs[err.code] || '❌ Location error');
      btn.textContent = '📍 My Location';
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

// ── Report layers (plain LayerGroups, no clustering icons) ──
// Using LayerGroup instead of MarkerClusterGroup so plain coloured
// circle markers render directly with no cluster icon overlays.
const reportLayers = {
  'Overcrowding': L.layerGroup(),
  'Delay':        L.layerGroup(),
  'Lost Item':    L.layerGroup(),
  'Misconduct':   L.layerGroup(),
};
Object.values(reportLayers).forEach(l => l.addTo(map));

let activeFilter = 'all';

// ── Geocode cache ──────────────────────────────
const geocodeCache = {};
async function geocodeStop(name) {
  if (geocodeCache[name] !== undefined) return geocodeCache[name];
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name + ', Colombo, Sri Lanka')}&format=json&limit=1`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.length) {
      const ll = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      geocodeCache[name] = ll;
      return ll;
    }
  } catch(e) {}
  geocodeCache[name] = null;
  return null;
}

// ── Load + render reports ─────────────────────
// Header matching is normalised so differences such as "Type of Reporting"
// versus "Report Type" do not make every count stay at zero.
let counts = { total: 0, Overcrowding: 0, Delay: 0, Misconduct: 0, 'Lost Item': 0 };

function normaliseText(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseKey(value) {
  return normaliseText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCell(row, field) {
  const wanted = new Set(COL_ALIASES[field].map(normaliseKey));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normaliseKey(key))) return normaliseText(value);
  }
  return '';
}

function normaliseType(value) {
  const key = normaliseKey(value);
  const aliases = {
    overcrowding: 'Overcrowding',
    overcrowded: 'Overcrowding',
    crowding: 'Overcrowding',
    delay: 'Delay',
    delayed: 'Delay',
    lostitem: 'Lost Item',
    lostitems: 'Lost Item',
    misconduct: 'Misconduct',
  };
  return aliases[key] || normaliseText(value);
}

async function loadReports() {
  setRefreshState('loading');

  try {
    // Fetch ourselves with no-store. The timestamp also bypasses intermediary caches.
    const separator = SHEET_CSV_URL.includes('?') ? '&' : '?';
    const response = await fetch(`${SHEET_CSV_URL}${separator}cachebust=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!response.ok) throw new Error(`CSV request failed: ${response.status}`);

    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: 'greedy' });
    if (parsed.errors?.length && !parsed.data?.length) throw new Error(parsed.errors[0].message);

    const rows = parsed.data.filter(row => getCell(row, 'type'));

    Object.values(reportLayers).forEach(layer => layer.clearLayers());
    counts = { total: 0, Overcrowding: 0, Delay: 0, Misconduct: 0, 'Lost Item': 0 };

    for (const row of rows) {
      const type = normaliseType(getCell(row, 'type'));
      if (!COLORS[type]) continue;

      counts.total++;
      counts[type]++;

      let latlng = null;
      const rawLat = Number.parseFloat(getCell(row, 'lat'));
      const rawLng = Number.parseFloat(getCell(row, 'lng'));
      const stopName = getCell(row, 'stop');

      if (Number.isFinite(rawLat) && Number.isFinite(rawLng) && rawLat !== 0 && rawLng !== 0) {
        latlng = [rawLat, rawLng];
      } else if (stopName) {
        latlng = await geocodeStop(stopName);
      }

      // The report still contributes to the counters even when it has no mappable location.
      if (!latlng) continue;

      const color = COLORS[type];
      const marker = L.circleMarker(latlng, {
        radius: 9,
        fillColor: color,
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.9,
        opacity: 1,
      });

      const crowding = getCell(row, 'crowding');
      const delay = getCell(row, 'delay');
      const description = getCell(row, 'desc');
      const route = getCell(row, 'route');
      const timeStr = getCell(row, 'time') || getCell(row, 'timestamp');

      const crowdRow = crowding ? `<div class="popup-row"><span class="lbl">Crowding: </span>${escapeHtml(crowding)}</div>` : '';
      const delayRow = delay ? `<div class="popup-row"><span class="lbl">Delay: </span>${escapeHtml(delay)} min</div>` : '';
      const descRow = description ? `<div class="popup-row"><span class="lbl">Details: </span>${escapeHtml(description)}</div>` : '';

      marker.bindPopup(`
        <div class="popup-type" style="color:${color}">${TYPE_ICONS[type] || ''} ${type}</div>
        <div class="popup-row"><span class="lbl">Route: </span>${escapeHtml(route || '—')}</div>
        <div class="popup-row"><span class="lbl">Stop: </span>${escapeHtml(stopName || '—')}</div>
        ${crowdRow}${delayRow}${descRow}
        <div class="popup-row" style="margin-top:5px;color:#64748b;font-size:0.75rem">${escapeHtml(timeStr)}</div>
      `);

      reportLayers[type].addLayer(marker);
    }

    updateStats();
    applyFilter(activeFilter);
    hideLoading();
    setRefreshState('live');
  } catch (error) {
    console.error(error);
    showToast('⚠️ Could not read the live Google Sheet');
    setRefreshState('live');
    hideLoading();
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

// ── Stats display ─────────────────────────────
function updateStats() {
  document.getElementById('stat-total').textContent = counts.total;
  document.getElementById('stat-crowd').textContent = counts['Overcrowding'];
  document.getElementById('stat-delay').textContent = counts['Delay'];
  document.getElementById('stat-misc').textContent  = counts['Misconduct'];
  document.getElementById('stat-lost').textContent  = counts['Lost Item'];
}

// ── Filter by type ────────────────────────────
function filterByType(type) {
  activeFilter = type;
  applyFilter(type);

  document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
  document.querySelector(`.stat-card[data-type="${type}"]`).classList.add('active');
}

function applyFilter(type) {
  Object.keys(reportLayers).forEach(t => {
    if (type === 'all' || type === t) {
      if (!map.hasLayer(reportLayers[t])) map.addLayer(reportLayers[t]);
    } else {
      if (map.hasLayer(reportLayers[t])) map.removeLayer(reportLayers[t]);
    }
  });

  const banner = document.getElementById('filter-banner');
  if (type === 'all') {
    banner.classList.remove('visible');
  } else {
    banner.classList.add('visible');
    document.getElementById('filter-banner-text').textContent =
      `Showing: ${TYPE_ICONS[type]} ${type} (${counts[type] || 0})`;
  }

  syncCheckboxes();
}

function clearFilter() { filterByType('all'); }

// ── Layer checkbox sync ───────────────────────
function syncCheckboxes() {
  Object.keys(reportLayers).forEach(type => {
    const id = `cb-${type.replace(' ', '-')}`;
    const cb = document.getElementById(id);
    if (cb) cb.checked = map.hasLayer(reportLayers[type]);
  });
}

function toggleLayer(type, show) {
  if (show) {
    map.addLayer(reportLayers[type]);
  } else {
    map.removeLayer(reportLayers[type]);
    if (activeFilter === type) {
      activeFilter = 'all';
      document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
      document.querySelector('.stat-card[data-type="all"]').classList.add('active');
      document.getElementById('filter-banner').classList.remove('visible');
    }
  }
}

function toggleBusStops(show) {
  if (!busStopsLayer) return;
  if (show) map.addLayer(busStopsLayer);
  else map.removeLayer(busStopsLayer);
}

// ── Legend ────────────────────────────────────
const legend = L.control({ position: 'bottomright' });
legend.onAdd = () => {
  const div = L.DomUtil.create('div', 'legend');
  div.innerHTML = `
    <h4>Report Types</h4>
    ${Object.entries(COLORS).map(([t, c]) =>
      `<div class="legend-row"><span class="legend-dot" style="background:${c}"></span>${TYPE_ICONS[t]} ${t}</div>`
    ).join('')}
    <hr style="border:none;border-top:1px solid #1e3a5f;margin:7px 0">
    <div class="legend-row"><span class="legend-dot stop"></span>🚏 Bus Stop</div>
    <div class="legend-row"><span class="legend-dot user"></span>📍 Your Location</div>
  `;
  return div;
};
legend.addTo(map);

// ── Filter panel ──────────────────────────────
const filterCtrl = L.control({ position: 'topright' });
filterCtrl.onAdd = () => {
  const div = L.DomUtil.create('div', 'filter-panel');
  div.innerHTML = `
    <h4>Layers</h4>
    ${Object.keys(reportLayers).map(type => {
      const id = `cb-${type.replace(' ','-')}`;
      return `<label><input type="checkbox" id="${id}" checked onchange="toggleLayer('${type}', this.checked)">${TYPE_ICONS[type]} ${type}</label>`;
    }).join('')}
    <hr class="sep">
    <label><input type="checkbox" checked onchange="toggleBusStops(this.checked)">🚏 Bus Stops</label>
  `;
  L.DomEvent.disableClickPropagation(div);
  return div;
};
filterCtrl.addTo(map);

// ── Refresh countdown ─────────────────────────
const REFRESH_INTERVAL = 15;
let countdown = REFRESH_INTERVAL;
let refreshTimer = null;

function startCountdown() {
  clearInterval(refreshTimer);
  countdown = REFRESH_INTERVAL;
  document.getElementById('refresh-countdown').textContent = countdown + 's';

  refreshTimer = setInterval(() => {
    countdown--;
    document.getElementById('refresh-countdown').textContent = countdown + 's';
    if (countdown <= 0) {
      clearInterval(refreshTimer);
      loadReports().then(() => startCountdown());
    }
  }, 1000);
}

// Manual refresh on pill click
async function manualRefresh() {
  clearInterval(refreshTimer);
  showToast('🔄 Refreshing…');
  await loadReports();
  startCountdown();
}

function setRefreshState(state) {
  const dot   = document.getElementById('refresh-dot');
  const label = document.getElementById('refresh-label');
  if (state === 'loading') {
    dot.classList.add('loading');
    label.textContent = 'Updating';
  } else {
    dot.classList.remove('loading');
    label.textContent = 'Live';
  }
}

// ── Loading overlay ───────────────────────────
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  setTimeout(() => { el.style.display = 'none'; }, 400);
}

// ── Toast ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Report form ───────────────────────────────
function openReportForm() {
  const url = new URL(GOOGLE_FORM_URL);

  // Google Forms can only receive the current coordinates when Latitude and
  // Longitude questions exist and their entry IDs are configured above.
  if (currentLocation && FORM_ENTRY_LAT && FORM_ENTRY_LNG) {
    url.searchParams.set(FORM_ENTRY_LAT, currentLocation.lat.toFixed(7));
    url.searchParams.set(FORM_ENTRY_LNG, currentLocation.lng.toFixed(7));
  }

  window.open(url.toString(), '_blank');
}

// Refresh immediately when the user returns from the Google Form tab.
window.addEventListener('focus', () => {
  manualRefresh();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') manualRefresh();
});


// ── Live Sri Lanka date and time ──────────────
function updateDateTime() {
  const now = new Date();
  const dateEl = document.getElementById('current-date');
  const timeEl = document.getElementById('current-time');
  if (!dateEl || !timeEl) return;

  dateEl.textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(now);

  timeEl.textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(now);
}

updateDateTime();
setInterval(updateDateTime, 1000);

// Refresh immediately when the user returns from the Google Form tab.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') manualRefresh();
});

// ── Boot ──────────────────────────────────────
loadReports().then(() => startCountdown());

