const BASE_URL = 'https://minio.lab.sspcloud.fr/pierrelamarche/strava';
const METADATA_URL = `${BASE_URL}/metadonnees.parquet`;

const SHOW_ROUTES = true;

const map = L.map('map').setView([48.8566, 2.3522], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');

let db = null;
let currentLine = null;
const lineCache = new Map();

function drawLine(pts) {
  if (currentLine) map.removeLayer(currentLine);
  currentLine = L.polyline(pts, { color: '#ff5722', weight: 4 }).addTo(map);
  map.fitBounds(currentLine.getBounds());
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

function renderList(rows) {
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
      <div class="meta"><span>${dur}</span></div>
    `;
    li.querySelector('.nom').textContent = row.id;
    li.addEventListener('click', () => {
      listEl.querySelectorAll('li').forEach((el) => el.classList.remove('selected'));
      li.classList.add('selected');
      onActivitySelected(row);
    });
    listEl.appendChild(li);
  }
}

async function onActivitySelected(row) {
  try {
    let pts = lineCache.get(row.id);
    if (!pts) {
      setStatus(`Chargement du tracé ${row.id}…`);
      const res = await fetch(`${BASE_URL}/parquet/${row.id}.parquet`);
      if (!res.ok) throw new Error(`HTTP ${res.status} sur le tracé ${row.id}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const traceName = `trace_${row.id}.parquet`;
      await db.registerFileBuffer(traceName, buf);

      const conn = await db.connect();
      const table = await conn.query(
        `SELECT latitude, longitude FROM read_parquet('${traceName}')`
      );
      pts = table.toArray().map((r) => {
        const o = r.toJSON();
        return [o.latitude, o.longitude];
      });
      await db.dropFile(traceName);
      await conn.close();

      lineCache.set(row.id, pts);
    }
    drawLine(pts);
    setStatus(`Tracé ${row.id} : ${pts.length} points`);
  } catch (err) {
    console.error(err);
    setStatus(`Erreur tracé : ${err.message}`);
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
    "SELECT id, strftime(date AT TIME ZONE 'Europe/Paris', '%d/%m/%Y %H:%M') AS date, distance_m, duree FROM read_parquet('metadonnees.parquet') ORDER BY date DESC"
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
  try {
    db = await initDuckDB();
    const rows = await loadMetadata(db);
    setStatus(`${rows.length} activités chargées`);
    renderList(rows);
  } catch (err) {
    console.error(err);
    setStatus(`Erreur : ${err.message}`);
  }
}

main();
