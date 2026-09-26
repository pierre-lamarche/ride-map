import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/dist/duckdb-browser.mjs';

const BASE_URL = 'https://minio.lab.sspcloud.fr/pierrelamarche/strava';
const METADATA_URL = `${BASE_URL}/metadonnees.parquet`;

const map = L.map('map').setView([48.8566, 2.3522], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');

function setStatus(text) {
  statusEl.textContent = text;
}

function formatDistance(d) {
  const n = Number(String(d).replace(',', '.'));
  if (!isFinite(n) || n === 0) return '';
  return n >= 1 ? `${n.toFixed(0)} km` : `${(n * 1000).toFixed(0)} m`;
}

function renderList(rows) {
  listEl.innerHTML = '';
  for (const row of rows) {
    const li = document.createElement('li');
    li.dataset.id = row.id;

    const dist = formatDistance(row.distance);
    li.innerHTML = `
      <div class="row">
        <span class="nom"></span>
        <span class="badge">${dist}</span>
      </div>
      <div class="date">${row.date}</div>
      <div class="meta"><span>${row.type}</span></div>
    `;
    li.querySelector('.nom').textContent = row.nom;
    li.addEventListener('click', () => {
      listEl.querySelectorAll('li').forEach((el) => el.classList.remove('selected'));
      li.classList.add('selected');
      onActivitySelected(row);
    });
    listEl.appendChild(li);
  }
}

function onActivitySelected(row) {
  // Etape suivante : charger le tracé depuis `${BASE_URL}/${row.id}.parquet`
  console.log('Activité sélectionnée', row.id, row.nom);
}

async function initDuckDB() {
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
    "SELECT id, date, nom, type, distance FROM read_parquet('metadonnees.parquet') ORDER BY CAST(id AS BIGINT) DESC"
  );
  const rows = table.toArray().map((r) => r.toJSON());
  await conn.close();
  return rows;
}

async function main() {
  try {
    const db = await initDuckDB();
    const rows = await loadMetadata(db);
    setStatus(`${rows.length} activités chargées`);
    renderList(rows);
  } catch (err) {
    console.error(err);
    setStatus(`Erreur : ${err.message}`);
  }
}

main();
