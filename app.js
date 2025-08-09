// EVaze preprod – Waze-like styling + improved planner UX

const map = L.map('map').setView([46.6, 2.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

let startMarker = null, endMarker = null, clickedLatLng = null;
let routeLine = null;

const chargerIcon = L.divIcon({className:'', html:'<div style="font-size:18px">🔌</div>', iconSize: [24,24], iconAnchor:[12,12]});
const reportIcons = { police:'👮', radar:'📸', accident:'⚠️', borne_hs:'🔌❌', file_attente:'⏳' };

const chargers = [
  {id:'ionity_aire_bois', name:'Ionity Aire du Bois', lat:47.022, lng:2.668, power:350, operator:'Ionity', price:'0.69€/kWh', status:'OPERATIONAL'},
  {id:'fastned_a7_n', name:'Fastned A7 Nord', lat:45.861, lng:4.736, power:300, operator:'Fastned', price:'0.59€/kWh', status:'OPERATIONAL'},
  {id:'tesla_macon', name:'Supercharger Mâcon', lat:46.296, lng:4.828, power:250, operator:'Tesla', price:'0.40–0.54€/kWh', status:'OPERATIONAL'},
  {id:'total_val', name:'TotalEnergies Val', lat:46.083, lng:4.69, power:180, operator:'TotalEnergies', price:'0.55€/kWh', status:'OPERATIONAL'},
];

const chargerMarkers = {};
chargers.forEach(c=>{
  const m = L.marker([c.lat,c.lng], {icon: chargerIcon}).addTo(map);
  m.bindPopup(`<b>${c.name}</b><br>${c.operator} • ${c.power} kW<br>${c.price}<br>Status: <span id="status_${c.id}">${c.status}</span><br>
    <button onclick="reportCharger('${c.id}', 'borne_hs')">Signaler HS</button>
    <button onclick="reportCharger('${c.id}', 'file_attente')">Signaler file</button>`);
  chargerMarkers[c.id] = m;
});

// Helpers
function toast(msg, ms=2200){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), ms);
}

async function geocode(q){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=fr`;
  const res = await fetch(url, {headers: {'Accept-Language':'fr'}});
  const data = await res.json();
  return data[0] ? {lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name} : null;
}

async function ensureMarkersFromInputs(){
  const sVal = document.getElementById('start').value.trim();
  const eVal = document.getElementById('end').value.trim();
  if(!startMarker && sVal){
    const g = await geocode(sVal);
    if(g){ startMarker = L.marker([g.lat, g.lon]).addTo(map).bindPopup('Départ'); }
  }
  if(!endMarker && eVal){
    const g = await geocode(eVal);
    if(g){ endMarker = L.marker([g.lat, g.lon]).addTo(map).bindPopup('Arrivée'); }
  }
}

async function makeRoute(){
  if(!startMarker || !endMarker) return null;
  const s = startMarker.getLatLng(), e = endMarker.getLatLng();
  const url = `https://router.project-osrm.org/route/v1/driving/${s.lng},${s.lat};${e.lng},${e.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if(!data.routes || !data.routes[0]) return null;
  const route = data.routes[0];
  if(routeLine) map.removeLayer(routeLine);
  routeLine = L.geoJSON(route.geometry, {style:{weight:6, opacity:.9}}).addTo(map);
  map.fitBounds(routeLine.getBounds());
  window.lastRoute = {
    distance_km: route.distance/1000.0,
    geometry: route.geometry.coordinates.map(([lng,lat])=>({lat, lng}))
  };
  document.getElementById('planSummary').innerHTML = `Distance: ${window.lastRoute.distance_km.toFixed(1)} km`;
  listChargersNearRoute(window.lastRoute);
  return window.lastRoute;
}

// UI handlers
document.getElementById('geocodeStart').onclick = async ()=>{
  const q = document.getElementById('start').value.trim();
  if(!q) return;
  const g = await geocode(q);
  if(g){
    if(startMarker) map.removeLayer(startMarker);
    startMarker = L.marker([g.lat, g.lon]).addTo(map).bindPopup('Départ').openPopup();
    map.setView([g.lat, g.lon], 12);
  }
};
document.getElementById('geocodeEnd').onclick = async ()=>{
  const q = document.getElementById('end').value.trim();
  if(!q) return;
  const g = await geocode(q);
  if(g){
    if(endMarker) map.removeLayer(endMarker);
    endMarker = L.marker([g.lat, g.lon]).addTo(map).bindPopup('Arrivée').openPopup();
    map.setView([g.lat, g.lon], 12);
  }
};

document.getElementById('routeBtn').onclick = async ()=>{
  await ensureMarkersFromInputs();
  if(!startMarker || !endMarker){ toast('Renseigne départ et arrivée.'); return; }
  document.getElementById('planSummary').textContent = 'Calcul de l’itinéraire…';
  const r = await makeRoute();
  if(!r){ toast('Pas de route trouvée.'); }
};

document.getElementById('clearBtn').onclick = ()=>{
  if(startMarker) { map.removeLayer(startMarker); startMarker=null; }
  if(endMarker) { map.removeLayer(endMarker); endMarker=null; }
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  window.lastRoute = null;
  document.getElementById('planSummary').textContent='';
  document.getElementById('chargersList').innerHTML='';
  toast('Itinéraire effacé');
};

document.getElementById('planBtn').onclick = async ()=>{
  document.getElementById('planSummary').textContent = 'Analyse autonomie en cours…';
  if(!window.lastRoute){
    await ensureMarkersFromInputs();
    if(!startMarker || !endMarker){ toast('Trace d’abord un itinéraire.'); document.getElementById('planSummary').textContent=''; return; }
    await makeRoute();
  }
  const cap = parseFloat(document.getElementById('capacity').value || '50');
  const soc = parseFloat(document.getElementById('soc').value || '80');
  const cons = parseFloat(document.getElementById('consumption').value || '15');
  const reserve = parseFloat(document.getElementById('reserve').value || '10');

  const usable = cap * (soc/100 - reserve/100); // kWh utilisables
  const range_km = (usable / cons) * 100.0;
  const dist = window.lastRoute.distance_km;

  let text = `Autonomie estimée: <b>${range_km.toFixed(0)} km</b> • Trajet: <b>${dist.toFixed(1)} km</b>. `;
  if(range_km >= dist) {
    text += '✅ Pas d’arrêt requis (marge incluse).';
  } else {
    const mid = window.lastRoute.geometry[Math.floor(window.lastRoute.geometry.length/2)];
    const near = chargers.map(c=>({...c, dist: haversine(mid.lat, mid.lng, c.lat, c.lng)}))
                         .sort((a,b)=>a.dist-b.dist)[0];
    text += `⚡ Recommandé: arrêt à <b>${near.name}</b> (${near.operator}, ${near.power} kW). Cliquez “Ajouter comme arrêt”.`;
  }
  document.getElementById('planSummary').innerHTML = text;
};

// Chargers near route
function listChargersNearRoute(r){
  const list = document.getElementById('chargersList');
  list.innerHTML = '';
  if(!r){ list.textContent = '—'; return; }
  const mid = r.geometry[Math.floor(r.geometry.length/2)];
  const entries = chargers.map(c=>({
    ...c,
    dist: haversine(mid.lat, mid.lng, c.lat, c.lng)
  })).sort((a,b)=>a.dist-b.dist).slice(0,6);

  entries.forEach(c=>{
    const card = document.createElement('div');
    card.className='card';
    card.innerHTML = `<b>${c.name}</b> <span class="badge">${c.dist.toFixed(1)} km</span><br>
    ${c.operator} • ${c.power} kW • ${c.price}<br>
    <button onclick="centerOn(${c.lat}, ${c.lng})">Voir</button>
    <button onclick="addStop('${c.id}')" class="accent">Ajouter comme arrêt</button>`;
    list.appendChild(card);
  });
}

function centerOn(lat,lng){ map.setView([lat,lng], 14); }
function addStop(id){
  const c = chargers.find(x=>x.id===id);
  if(!c) return;
  L.circleMarker([c.lat, c.lng], {radius:7}).addTo(map).bindPopup(`Arrêt: ${c.name}`).openPopup();
  toast(`Arrêt ajouté: ${c.name}`);
}

// Reports
map.on('click', (e)=>{ clickedLatLng = e.latlng; toast('Position sélectionnée'); });
document.querySelectorAll('.report').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(!clickedLatLng){ toast('Clique d’abord sur la carte.'); return; }
    createReport(btn.dataset.type, clickedLatLng.lat, clickedLatLng.lng);
  });
});

function loadReports(){
  const arr = JSON.parse(localStorage.getItem('evaze_reports')||'[]');
  arr.forEach(drawReport);
  renderReportsList(arr);
}
function saveReports(arr){ localStorage.setItem('evaze_reports', JSON.stringify(arr)); }
function createReport(type, lat, lng, chargerId=null){
  const arr = JSON.parse(localStorage.getItem('evaze_reports')||'[]');
  const r = { id: 'r_'+Date.now(), type, lat, lng, chargerId, ts: new Date().toISOString(), up: 0 };
  arr.push(r); saveReports(arr); drawReport(r); renderReportsList(arr);
  toast(`${labelForType(type)} ajouté`);
}
function drawReport(r){
  const icon = L.divIcon({className:'', html:`<div style="font-size:18px">${reportIcons[r.type]||'📍'}</div>`, iconSize:[24,24], iconAnchor:[12,12]});
  const m = L.marker([r.lat, r.lng], {icon}).addTo(map);
  m.bindPopup(`<b>${labelForType(r.type)}</b><br>${new Date(r.ts).toLocaleString()}<br>
    <button onclick="upvote('${r.id}')">+1 utile</button>`);
}
function renderReportsList(arr){
  const box = document.getElementById('reportsList');
  box.innerHTML = '';
  arr.sort((a,b)=> (b.up||0) - (a.up||0));
  arr.forEach(r=>{
    const div = document.createElement('div');
    div.className='card';
    div.innerHTML = `${reportIcons[r.type]} <b>${labelForType(r.type)}</b> 
      <span class="badge">${new Date(r.ts).toLocaleTimeString()}</span>
      <br><small>${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</small><br>
      <button onclick="upvote('${r.id}')">+1 utile (${r.up||0})</button>`;
    box.appendChild(div);
  });
}
function upvote(id){
  const arr = JSON.parse(localStorage.getItem('evaze_reports')||'[]');
  const r = arr.find(x=>x.id===id);
  if(r){ r.up = (r.up||0)+1; saveReports(arr); renderReportsList(arr); toast('Merci pour le vote'); }
}

window.reportCharger = function(chargerId, type){
  const c = chargers.find(x=>x.id===chargerId);
  if(!c) return;
  createReport(type, c.lat, c.lng, chargerId);
  const el = document.getElementById('status_'+chargerId);
  if(type==='borne_hs' && el){ el.innerText = 'POSSIBLE ISSUE (signalée)'; }
}

function labelForType(t){
  return {
    police:'Police signalée',
    radar:'Radar',
    accident:'Accident',
    borne_hs:'Borne potentiellement HS',
    file_attente:'File d’attente'
  }[t] || t;
}

function haversine(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2)+
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
            Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  return R*c;
}

// Online/offline
function updateStatus(){
  document.getElementById('onlineStatus').textContent = navigator.onLine ? 'En ligne' : 'Hors ligne';
}
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
updateStatus();

// Recenter
document.getElementById('recenter').onclick = ()=>{
  if(routeLine){ map.fitBounds(routeLine.getBounds()); }
  else { map.setView([46.6,2.5], 6); }
};

// Init
loadReports();
document.getElementById('start').value = 'Paris';
document.getElementById('end').value = 'Lyon';

// Ensure Leaflet resizes correctly on orientation/resize
window.addEventListener('resize', ()=> { setTimeout(()=> map.invalidateSize(), 150); });
setTimeout(()=> map.invalidateSize(), 300);
