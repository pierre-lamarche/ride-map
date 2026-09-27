const BASE_URL = 'https://minio.lab.sspcloud.fr/pierrelamarche/strava';
const METADATA_URL = `${BASE_URL}/metadonnees.parquet`;

const SHOW_ROUTES = true;

const map = L.map('map').setView([48.8566, 2.3522], 6);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19,
  attribution: '&copy; Esri, Maxar, Earthstar Geographics'
}).addTo(map);

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const fromEl = document.getElementById('from');
const toEl = document.getElementById('to');
const overlayBtn = document.getElementById('overlayBtn');
const clearBtn = document.getElementById('clearBtn');
const legendEl = document.getElementById('legend');
const legendBarEl = document.getElementById('legend-bar');
const legendFromEl = document.getElementById('legend-from');
const legendToEl = document.getElementById('legend-to');

let db = null;
let allRows = [];
let busy = false;
const lineCache = new Map();
const activeLines = new Map();

const GRADIENT = ['#3066be', '#42b5c9', '#5fc98e', '#f2c14e', '#e8590c'];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function gradientColor(t) {
  const clamped = Math.min(Math.max(t, 0), 1);
  const n = GRADIENT.length - 1;
  const seg = Math.min(Math.floor(clamped * n), n - 1);
  const local = clamped * n - seg;
  const a = hexToRgb(GRADIENT[seg]);
  const b = hexToRgb(GRADIENT[seg + 1]);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * local));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rangeBounds() {
  const from = fromEl.value || (allRows[0] && allRows[0].day) || '';
  const to = toEl.value || (allRows.length && allRows[allRows.length - 1].day) || '';
  return [from, to];
}

function dateT(day) {
  const [from, to] = rangeBounds();
  if (!from || !to) return 0.5;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (b <= a) return 0.5;
  return (new Date(day).getTime() - a) / (b - a);
}

function lineColor(row) {
  return gradientColor(dateT(row.day));
}

function setStatus(text) {
  statusEl.textContent = text;
}

function formatDistance(meters) {
  const m = Number(meters);
  if (!isFinite(m) || m === 0) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(0)} km` : `${m.toFixed(0)} m`;
}

function formatDuration(micros) {
  const s = Math.round(Number(micros) / 1e6);
  if (!isFinite(s) || s < 0) return '';
  const h = Math.floor(s / 3600);
  const mn = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(mn)}:${p(ss)}`;
}

function fmtDay(day) {
  if (!day) return '';
  return day.split('-').reverse().join('/');
}

function filteredRows() {
  const [from, to] = rangeBounds();
  return allRows.filter(
    (r) => (!from || r.day >= from) && (!to || r.day <= to)
  );
}

function updateLegend() {
  if (!activeLines.size) {
    legendEl.style.display = 'none';
    return;
  }
  legendEl.style.display = 'flex';
  const [from, to] = rangeBounds();
  legendFromEl.textContent = fmtDay(from);
  legendToEl.textContent = fmtDay(to);
}

function renderList() {
  const rows = filteredRows();
  listEl.innerHTML = '';
  for (const row of rows) {
    const li = document.createElement('li');
    li.dataset.id = row.id;

    const dist = formatDistance(row.distance_m);
    const dur = formatDuration(row.duree);
    li.innerHTML = `
      <div class="row">
        <span class="nom"></span>
        <span class="badge">${dist}</span>
      </div>
      <div class="date">${row.date}</div>
      <div class="meta"><span class="badge">${row.type}</span><span>${dur}</span></div>
    `;
    li.querySelector('.nom').textContent = row.nom;

    const entry = activeLines.get(row.id);
    if (entry) {
      li.classList.add('active');
      li.style.borderLeftColor = entry.color;
    }

    li.addEventListener('click', () => onItemClicked(row));
    listEl.appendChild(li);
  }
  overlayBtn.textContent = `Superposer tout (${rows.length})`;
  overlayBtn.disabled = busy || rows.length === 0;
}

async function loadTrace(id) {
  let pts = lineCache.get(id);
  if (!pts) {
    const res = await fetch(`${BASE_URL}/parquet/${id}.parquet`);
    if (!res.ok) throw new Error(`HTTP ${res.status} sur le tracé ${id}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const traceName = `trace_${id}.parquet`;
    await db.registerFileBuffer(traceName, buf);

    const conn = await db.connect();
    const table = await conn.query(
      `SELECT latitude, longitude FROM read_parquet('${traceName}')`
    );
    pts = table.toArray()
      .map((r) => r.toJSON())
      .filter((o) => Number.isFinite(o.latitude) && Number.isFinite(o.longitude))
      .map((o) => [o.latitude, o.longitude]);
    await db.dropFile(traceName);
    await conn.close();
    lineCache.set(id, pts);
  }
  return pts;
}

async function addLine(row, { fit = false } = {}) {
  const pts = await loadTrace(row.id);
  if (!pts.length) return;
  const color = lineColor(row);
  const line = L.polyline(pts, { color, weight: 3, opacity: 0.7 }).addTo(map);
  line.bindTooltip(`${row.nom} — ${row.date}`, { sticky: true, direction: 'top' });
  line.on('mouseover', () => {
    line.setStyle({ weight: 5, opacity: 1 });
    line.bringToFront();
  });
  line.on('mouseout', () => line.setStyle({ weight: 3, opacity: 0.7 }));
  activeLines.set(row.id, { line, color, row });

  const li = listEl.querySelector(`li[data-id="${row.id}"]`);
  if (li) {
    li.classList.add('active');
    li.style.borderLeftColor = color;
  }

  if (fit) map.fitBounds(line.getBounds());
  updateLegend();
}

function removeLine(id) {
  const entry = activeLines.get(id);
  if (!entry) return;
  map.removeLayer(entry.line);
  activeLines.delete(id);
  const li = listEl.querySelector(`li[data-id="${id}"]`);
  if (li) {
    li.classList.remove('active');
    li.style.borderLeftColor = '';
  }
  updateLegend();
}

function clearAll() {
  for (const id of [...activeLines.keys()]) removeLine(id);
}

async function onItemClicked(row) {
  if (busy) return;
  if (activeLines.has(row.id)) {
    removeLine(row.id);
    setStatus(`${activeLines.size} tracés affichés`);
  } else {
    await addLine(row, { fit: activeLines.size === 0 });
    setStatus(`${activeLines.size} tracés affichés`);
  }
}

async function overlayRange() {
  if (busy) return;
  const rows = filteredRows();
  if (!rows.length) return;
  busy = true;
  overlayBtn.disabled = true;
  clearAll();
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setStatus(`Chargement ${i + 1}/${rows.length} : ${row.nom}…`);
      await addLine(row);
    }
    let bounds = null;
    for (const { line } of activeLines.values()) {
      bounds = bounds ? bounds.extend(line.getBounds()) : line.getBounds();
    }
    if (bounds) map.fitBounds(bounds);
    setStatus(`${activeLines.size} tracés superposés`);
  } catch (err) {
    console.error(err);
    setStatus(`Erreur : ${err.message}`);
  } finally {
    busy = false;
    renderList();
  }
}

async function initDuckDB() {
  const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/dist/duckdb-browser.mjs');
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  return db;
}

async function loadMetadata(db) {
  setStatus('Téléchargement des métadonnées…');
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${METADATA_URL}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await db.registerFileBuffer('metadonnees.parquet', buf);

  setStatus('Lecture des métadonnées…');
  const conn = await db.connect();
  const table = await conn.query(
    "SELECT id, nom, type, strftime(date AT TIME ZONE 'Europe/Paris', '%d/%m/%Y %H:%M') AS date, strftime(date AT TIME ZONE 'Europe/Paris', '%Y-%m-%d %H:%M') AS date_raw, distance_m, duree FROM read_parquet('metadonnees.parquet') ORDER BY date_raw ASC"
  );
  const rows = table.toArray().map((r) => r.toJSON());
  await conn.close();
  return rows;
}

async function main() {
  if (!SHOW_ROUTES) {
    document.getElementById('panel').style.display = 'none';
    return;
  }
  legendBarEl.style.background = `linear-gradient(to right, ${GRADIENT.join(',')})`;
  fromEl.addEventListener('change', () => renderList());
  toEl.addEventListener('change', () => renderList());
  overlayBtn.addEventListener('click', overlayRange);
  clearBtn.addEventListener('click', () => {
    if (busy) return;
    clearAll();
    setStatus('Aucun tracé affiché');
  });
  try {
    db = await initDuckDB();
    allRows = await loadMetadata(db);
    for (const r of allRows) r.day = r.date_raw.slice(0, 10);
    if (allRows.length) {
      fromEl.value = allRows[0].day;
      toEl.value = allRows[allRows.length - 1].day;
    }
    setStatus(`${allRows.length} activités chargées`);
    renderList();
  } catch (err) {
    console.error(err);
    setStatus(`Erreur : ${err.message}`);
  }
}

main();
