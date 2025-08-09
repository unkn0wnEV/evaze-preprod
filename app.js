// EVaze preprod – Waze-like styling + improved planner UX

const map = L.map('map').setView([46.6, 2.5], 6);

let startMarker = null, endMarker = null, clickedLatLng = null;
let routeLine = null;

const chargerIcon = L.divIcon({className:'', html:'<div style="font-size:18px">🔌</div>', iconSize: [24,24], iconAnchor:[12,12]});
const reportIcons = { police:'👮', radar:'📸', accident:'⚠️', borne_hs:'🔌❌', file_attente:'⏳' };

const chargers = [
  {id:'ionity_aire_bois', name:'Ionity Aire du Bois', lat:47.022, lng:2.668, power:350, operator:'Ionity', price:'0.69€/kWh', status:'OPERATIONAL'},
  {id:'fastned_a7_n', name:'Fastned A7 Nord', lat:45.861, lng:4.736, power:300, operator:'Fastned', price:'0.59€/kWh', status:'OPERATIONAL'},
  {id:'tesla_macon', name:'Supercharger Mâcon', lat:46.296, lng:4.828, power:250, operator:'Tesla', price:'0.40–0.54€/kWh', status:'OPERATIONAL'},
  {id:'total_val', name:'TotalEnergies Val', lat:46.083, lng:4.690, power:180, operator:'TotalEnergies', price:'0.55€/kWh', status:'OPERATIONAL'},
  {id:'ionity_orleans', name:'Ionity Orléans Saran', lat:47.950, lng:1.884, power:350, operator:'Ionity', price:'0.69€/kWh', status:'OPERATIONAL'},
  {id:'fastned_a10', name:'Fastned A10 Touraine', lat:47.167, lng:0.642, power:300, operator:'Fastned', price:'0.59€/kWh', status:'OPERATIONAL'},
  {id:'tesla_bourg', name:'Supercharger Bourg-en-Bresse', lat:46.199, lng:5.228, power:250, operator:'Tesla', price:'0.40–0.54€/kWh', status:'OPERATIONAL'},
  {id:'ionity_lyon', name:'Ionity Lyon Dardilly', lat:45.810, lng:4.760, power:350, operator:'Ionity', price:'0.69€/kWh', status:'OPERATIONAL'},
  {id:'total_chartres', name:'TotalEnergies Chartres', lat:48.467, lng:1.482, power:180, operator:'TotalEnergies', price:'0.55€/kWh', status:'OPERATIONAL'},
  {id:'allego_a6', name:'Allego A6 Auxerre', lat:47.800, lng:3.574, power:300, operator:'Allego', price:'0.65€/kWh', status:'OPERATIONAL'},
  {id:'fastned_a71', name:'Fastned A71 Bourges', lat:47.080, lng:2.390, power:300, operator:'Fastned', price:'0.59€/kWh', status:'OPERATIONAL'},
  {id:'tesla_chalon', name:'Supercharger Chalon-sur-Saône', lat:46.790, lng:4.852, power:250, operator:'Tesla', price:'0.40–0.54€/kWh', status:'OPERATIONAL'}
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
  const stops = (typeof selectedStops!=='undefined' ? selectedStops : []).map(id=>{
    const c = chargers.find(x=>x.id===id); return `${c.lng},${c.lat}`;
  }).join(';');
  const coords = `${s.lng},${s.lat}` + (stops?`;${stops}`:'') + `;${e.lng},${e.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=false`;

  // skeleton while loading
  const list = document.getElementById('chargersList');
  list.innerHTML = '<div class="card skeleton" style="height:48px"></div><div class="card skeleton" style="height:48px"></div><div class="card skeleton" style="height:48px"></div>';

  try{
    const data = await fetchJSONWithRetry(url, {retries:3, timeoutMs:8000});
    if(!data.routes || !data.routes[0]) throw new Error('no route');
    const route = data.routes[0];
    if(routeLine) map.removeLayer(routeLine);
    routeLine = L.geoJSON(route.geometry, {style:{weight:6, opacity:.9}}).addTo(map);
    map.fitBounds(routeLine.getBounds());
    window.lastRoute = {
      distance_km: route.distance/1000.0,
      geometry: route.geometry.coordinates.map(([lng,lat])=>({lat, lng}))
    };
    // Steps
    const steps = [];
    try{
      route.legs.forEach(leg=> leg.steps.forEach(st=> steps.push({name: st.name, distance: st.distance, maneuver: st.maneuver?.type})));
    }catch(e){}
    showSteps(steps);
    listChargersNearRoute(window.lastRoute);
    document.getElementById('map').style.display='block';
    setTimeout(()=> map.invalidateSize(), 100);
    return window.lastRoute;
  }catch(e){
    document.getElementById('map').style.display='none';
    list.innerHTML = '<div class="card">❌ Itinéraire indisponible (réseau saturé). <button id="retryRoute">Réessayer</button></div>';
    const btn = document.getElementById('retryRoute');
    if(btn) btn.onclick = ()=> { document.getElementById('planSummary').textContent='Nouvelle tentative…'; makeRoute(); };
    toast('Erreur de calcul itinéraire (réessaie)');
    return null;
  }
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
  document.getElementById('planSummary').textContent = 'Calcul de l’itinéraire…';
  await ensureMarkersFromInputs();
  if(!startMarker || !endMarker){ toast('Renseigne départ et arrivée.'); return; }
  document.getElementById('planSummary').textContent = 'Calcul de l’itinéraire…';
  selectedStops=[]; renderStopsPills(); const r = selectedStops=[]; renderStopsPills(); await makeRoute();
  document.getElementById('map').style.display='block';
  setTimeout(()=> map.invalidateSize(), 100);
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
  document.getElementById('planSummary').textContent = 'Analyse en cours…';
  document.getElementById('planSummary').textContent = 'Analyse autonomie en cours…';
  if(!window.lastRoute){
    await ensureMarkersFromInputs();
    if(!startMarker || !endMarker){ toast('Trace d’abord un itinéraire.'); document.getElementById('planSummary').textContent=''; return; }
    selectedStops=[]; renderStopsPills(); await makeRoute();
  document.getElementById('map').style.display='block';
  setTimeout(()=> map.invalidateSize(), 100);
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

// --- Vehicle lookup by license plate (mock) ---
// In production, plug a real API endpoint here (e.g., car vertical, VIN decode, or national registry via a provider)
const MOCK_VEHICLES = {
  "AB-123-CD": { make:"Peugeot", model:"e-208 GT", year:2022, battery_kwh:50, usable_kwh:46.3, typical_cons_kwh_100:15.5, fast_charge_kw:100 },
  "CD-456-EF": { make:"Renault", model:"Megane E-Tech EV60", year:2023, battery_kwh:60, usable_kwh:60, typical_cons_kwh_100:16.8, fast_charge_kw:130 },
  "ZZ-999-AA": { make:"Tesla", model:"Model 3 RWD LFP", year:2024, battery_kwh:57.5, usable_kwh:57.5, typical_cons_kwh_100:14.5, fast_charge_kw:170 }
};

async function lookupVehicleByPlate(plate){
  // Normalize plate (very naive)
  const key = plate.trim().toUpperCase();
  // Demo: local mock
  if(MOCK_VEHICLES[key]) return { source:'mock', ...MOCK_VEHICLES[key] };

  // Hook for future API:
  // const resp = await fetch('https://your-api/lookup?plate='+encodeURIComponent(key));
  // if(resp.ok) return await resp.json();

  return null;
}

document.getElementById('fetchVehicle').onclick = async ()=>{
  const plate = document.getElementById('plate').value;
  if(!plate){ toast("Entre une immatriculation (ex: AB-123-CD)"); return; }
  document.getElementById('planSummary').textContent = 'Recherche véhicule…';
  const info = await lookupVehicleByPlate(plate);
  if(!info){ toast("Véhicule introuvable (demo)."); document.getElementById('planSummary').textContent=''; return; }
  // Prefill fields
  document.getElementById('capacity').value = info.usable_kwh ?? info.battery_kwh ?? 50;
  document.getElementById('consumption').value = info.typical_cons_kwh_100 ?? 15.0;
  // Small summary
  document.getElementById('planSummary').innerHTML = `Véhicule détecté: <b>${info.make} ${info.model}</b> ${info.year || ''} • Batterie utilisable ~ <b>${(info.usable_kwh||info.battery_kwh)} kWh</b>`;
  toast(`Profil chargé: ${info.make} ${info.model}`);
};

// --- Bottom sheet drag/controls ---
(function(){
  const sheet = document.getElementById('bottomSheet');
  const handle = document.getElementById('sheetHandle');
  const btnDown = document.getElementById('collapseSheet');
  const btnUp = document.getElementById('expandSheet');
  const states = {collapsed:64, half: window.innerHeight*0.40, full: window.innerHeight*0.85};
  let current = 'half', startY=0, startH=states.half, dragging=false;

  function setState(s){
    current = s;
    sheet.classList.remove('collapsed','full');
    if(s==='collapsed'){ sheet.classList.add('collapsed'); sheet.style.height = states.collapsed+'px'; }
    else if(s==='full'){ sheet.classList.add('full'); sheet.style.height = states.full+'px'; }
    else { sheet.style.height = states.half+'px'; }
    setTimeout(()=> map.invalidateSize(), 150);
  }
  setState('half');

  function onStart(y){ dragging=true; startY=y; startH=parseFloat(getComputedStyle(sheet).height); }
  function onMove(y){
    if(!dragging) return;
    const dy = startY - y;
    const nh = Math.max(64, Math.min(window.innerHeight*0.9, startH + dy));
    sheet.style.height = nh+'px';
  }
  function onEnd(){
    if(!dragging) return;
    dragging=false;
    const h = parseFloat(getComputedStyle(sheet).height);
    const mid = window.innerHeight*0.40;
    const top = window.innerHeight*0.70;
    if(h < 100) setState('collapsed');
    else if(h < top) setState('half');
    else setState('full');
  }

  handle.addEventListener('mousedown', (e)=>onStart(e.clientY));
  window.addEventListener('mousemove', (e)=> onMove(e.clientY));
  window.addEventListener('mouseup', onEnd);
  handle.addEventListener('touchstart', (e)=> onStart(e.touches[0].clientY), {passive:true});
  window.addEventListener('touchmove', (e)=> onMove(e.touches[0].clientY), {passive:true});
  window.addEventListener('touchend', onEnd);
  btnDown.onclick = ()=> setState('collapsed');
  btnUp.onclick = ()=> setState('full');
  window.addEventListener('resize', ()=>{
    states.half = window.innerHeight*0.40;
    states.full = window.innerHeight*0.85;
    if(current==='half') sheet.style.height = states.half+'px';
    if(current==='full') sheet.style.height = states.full+'px';
  });
})();

// --- Smart charger selection + charge time estimate ---
let selectedChargerId = null;
function selectCharger(id){
  selectedChargerId = id;
  const c = chargers.find(x=>x.id===id);
  if(!c) return;
  toast(`Borne sélectionnée: ${c.name}`);
  estimateChargeTime(c);
}

function vehicleSpec(){
  const cap = parseFloat(document.getElementById('capacity').value || '50'); // usable kWh assumed
  const soc = parseFloat(document.getElementById('soc').value || '80');
  const cons = parseFloat(document.getElementById('consumption').value || '15');
  const reserve = parseFloat(document.getElementById('reserve').value || '10');
  // fast charge capability from mock profile if present
  let carKw = 100;
  try{
    // if we have a note in planSummary from lookup, try to infer model; fallback 100kW
    const txt = document.getElementById('planSummary').textContent || '';
    if(txt.includes('Model 3')) carKw = 170;
    if(txt.includes('e-208')) carKw = 100;
    if(txt.includes('Megane')) carKw = 130;
  }catch(e){}
  return {cap, soc, cons, reserve, carKw};
}

function estimateChargeTime(charger){
  if(!window.lastRoute){ document.getElementById('planSummary').textContent = 'Trace d’abord un itinéraire.'; return; }
  const {cap, soc, cons, reserve, carKw} = vehicleSpec();
  const usable = cap * (soc/100 - reserve/100); // kWh utilisables avant réserve
  const range_km = (usable / cons) * 100.0;
  const dist = window.lastRoute.distance_km;
  const missing_km = Math.max(0, dist - range_km);

  if(missing_km <= 1){
    document.getElementById('planSummary').innerHTML = `Autonomie OK sans recharge. Borne sélectionnée: <b>${charger.name}</b> (facultatif).`;
    return;
  }

  // Energy needed to finish trip (10% overhead)
  const energy_needed_kWh = (missing_km * cons / 100) * 1.10;

  // Charging power limited by car & station; average power ~60% to account for taper
  const stationKw = charger.power || 100;
  const peakKw = Math.min(stationKw, carKw);
  const avgKw = peakKw * 0.60;
  const time_h = energy_needed_kWh / Math.max(20, avgKw); // avoid unrealistically low
  const minutes = Math.max(7, Math.round(time_h * 60));

  // Where to stop? naive: charger nearest to mid-point of route (already in list)
  document.getElementById('planSummary').innerHTML =
    `Trajet: <b>${dist.toFixed(1)} km</b> • Manque ~<b>${missing_km.toFixed(0)} km</b>.<br>` +
    `Arrêt recommandé: <b>${charger.name}</b> (${charger.operator}, ${charger.power} kW).<br>` +
    `⏱️ Temps de recharge estimé: <b>${minutes} min</b> (moy. ~${Math.round(avgKw)} kW).`;
}

// override addStop to also select & estimate
const _oldAddStop = window.addStop;
window.addStop = function(id){
  if(typeof _oldAddStop === 'function'){ _oldAddStop(id); }
  selectCharger(id);
};

// --- Platform-native emojis on labels ---
(function(){
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  // We rely on native emoji rendering (auto-adapts). Here we just choose relevant symbols.
  const icon = (ios, android)=> ios; // same codepoints, but left hook kept if we later diverge
  const labelMap = {
    "Départ": "🧭",
    "Arrivée": "📍",
    "Capacité (kWh)": "🔋",
    "SoC actuel (%)": "⚡",
    "Conso (kWh/100km)": "📊",
    "Réserve (%)": "🛟",
    "% min à l’arrivée BORNE": "⛽",
    "% min à l’arrivée TRAJET": "🎯",
    "Immatriculation (ex: AB-123-CD)": "🚗"
  };
  document.querySelectorAll('label').forEach(l=>{
    const t = l.textContent.trim();
    if(labelMap[t]) l.innerHTML = `${t} <span aria-hidden="true">${labelMap[t]}</span>`;
  });
})();

// --- Auto-optimal stop selection ---
// Compute minimal total time (simple model): detour distance penalty + charging time.
// Detour penalty approximated by nearest point distance to route * 2 (in/out), with avg speed 90 km/h.
function nearestDistanceToRoute(charger, route){
  let min = Infinity;
  for(const p of route.geometry){
    const d = haversine(p.lat, p.lng, charger.lat, charger.lng);
    if(d < min) min = d;
  }
  return min; // km
}

function avgSpeedKmh(){ return 90; } // crude default for highway mix

async function chooseOptimalStop(){
  if(!window.lastRoute){ toast('Trace un itinéraire d’abord.'); return; }
  const minAtCharger = parseFloat(document.getElementById('minAtCharger').value||'10');
  const minAtArrival = parseFloat(document.getElementById('minAtArrival').value||'10');
  const {cap, soc, cons, reserve, carKw} = vehicleSpec();
  const dist = window.lastRoute.distance_km;

  // Energy needed for whole trip with arrival buffer
  const totalArrivalLimitPct = Math.max(reserve, minAtArrival);
  const totalUsable_kWh = cap * Math.max(0, (soc - totalArrivalLimitPct)/100);
  const energyTrip_kWh = dist * cons / 100;

  // If you can already make it, pick fastest/highest power close to route as optional (0 min)
  if(totalUsable_kWh >= energyTrip_kWh){
    const near = chargers.map(c=>({...c, off: nearestDistanceToRoute(c, window.lastRoute)}))
                         .sort((a,b)=> (a.off - b.off) || (b.power - a.power))[0];
    selectCharger(near.id);
    return;
  }

  // Otherwise evaluate candidates within 10 km of route
  const candidates = chargers.map(c=>{
    const off = nearestDistanceToRoute(c, window.lastRoute);
    if(off > 10) return null;
    // Estimate charging time if stopping here
    const stationKw = c.power || 100;
    const peakKw = Math.min(stationKw, carKw);
    const avgKw = Math.max(20, peakKw * (settings?.taper || 0.60));

    // Energy available before reaching charger (up to minAtCharger)
    // Assume we reach it while staying above minAtCharger constraint -> if not possible, penalize heavily
    // Distance to charger along route unknown; using mid-route proxy is ok for demo
    const mid = window.lastRoute.geometry[Math.floor(window.lastRoute.geometry.length/2)];
    const distToCharger_km = haversine(mid.lat, mid.lng, c.lat, c.lng) + dist*0.25; // rough proxy
    const energyBeforeStop_kWh = cap * Math.max(0,(soc - Math.max(reserve, minAtCharger))/100);
    const reachable_km = (energyBeforeStop_kWh / cons) * 100;
    const reachPenaltyMin = (reachable_km + 1 < distToCharger_km) ? 9999 : 0;

    // Energy missing after stop to finish with arrival buffer
    const missing_kWh = Math.max(0, energyTrip_kWh - totalUsable_kWh) * 1.08;
    const chargeMin = Math.round((missing_kWh / avgKw) * 60);

    const detourKm = off * 2; // in+out
    const detourMin = (detourKm / avgSpeedKmh()) * 60;

    const totalMin = reachPenaltyMin + detourMin + chargeMin;
    return {...c, off, detourKm, chargeMin, totalMin};
  }).filter(Boolean).sort((a,b)=> a.totalMin - b.totalMin);

  if(!candidates.length){ toast('Aucune borne proche de la route.'); return; }
  const best = candidates[0];
  // Center, add stop, estimate
  centerOn(best.lat, best.lng);
  addStop(best.id); // this will also select + estimate
}

(function addAutoStopUI(){
  // Add an "Arrêt auto optimal" button at top of chargers panel
  const head = document.getElementById('chargersHeader');
  if(!head) return;
  const btn = document.createElement('button');
  btn.className = 'accent';
  btn.textContent = '✨ Arrêt auto optimal';
  btn.onclick = chooseOptimalStop;
  const right = document.createElement('div');
  right.style.display='flex'; right.style.gap='8px'; right.appendChild(btn);
  head.appendChild(right);
})();

let selectedStops = [];

function renderStopsPills(){
  const box = document.getElementById('stopsPills');
  box.innerHTML='';
  selectedStops.forEach((id, idx)=>{
    const c = chargers.find(x=>x.id===id);
    if(!c) return;
    const d = document.createElement('div');
    d.className='pill';
    d.innerHTML = `${idx+1}. ${c.operator} ${c.power}kW <button onclick="removeStop('${id}')">✕</button>`;
    box.appendChild(d);
  });
}

window.removeStop = function(id){
  selectedStops = selectedStops.filter(s=>s!==id);
  renderStopsPills();
  recomputeRouteWithStops();
};

const _oldAddStop_multi = window.addStop;
window.addStop = function(id){
  if(!_oldAddStop_multi) { console.warn('addStop base missing'); }
  if(!selectedStops.includes(id)) selectedStops.push(id);
  renderStopsPills();
  recomputeRouteWithStops();
  const c = chargers.find(x=>x.id===id);
  if(c) toast(`Arrêt ajouté: ${c.name}`);
};

async function recomputeRouteWithStops(){
  if(!startMarker || !endMarker){ return; }
  const s = startMarker.getLatLng(), e = endMarker.getLatLng();
  // Build waypoints string: start ; stops... ; end
  const stops = selectedStops.map(id=>{
    const c = chargers.find(x=>x.id===id); return `${c.lng},${c.lat}`;
  }).join(';');
  const coords = `${s.lng},${s.lat}` + (stops?`;${stops}`:'') + `;${e.lng},${e.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  if(!data.routes || !data.routes[0]) { toast('Route non trouvée'); return; }
  const route = data.routes[0];
  if(routeLine) map.removeLayer(routeLine);
  routeLine = L.geoJSON(route.geometry, {style:{weight:6, opacity:.9}}).addTo(map);
  map.fitBounds(routeLine.getBounds());
  window.lastRoute = {
    distance_km: route.distance/1000.0,
    geometry: route.geometry.coordinates.map(([lng,lat])=>({lat, lng}))
  };
  listChargersNearRoute(window.lastRoute);
  document.getElementById('map').style.display='block';
  setTimeout(()=> map.invalidateSize(), 100);
}

let watchId = null;
function startLive(){
  if(!window.lastRoute){ toast('Trace un itinéraire.'); return; }
  const hud = document.getElementById('liveHud');
  hud.style.display='flex';
  if(navigator.geolocation){
    watchId = navigator.geolocation.watchPosition(onGeo, err=>toast('Géoloc indisponible'), {enableHighAccuracy:true, maximumAge:5000, timeout:10000});
  }else{
    toast('Géoloc non supportée');
  }
}
function stopLive(){
  if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; }
  document.getElementById('liveHud').style.display='none';
}
document.getElementById('startTrip').onclick = startLive;
document.getElementById('stopTrip').onclick = stopLive;

function onGeo(pos){
  const {latitude, longitude} = pos.coords;
  // Snap to nearest point on route (simple nearest)
  let nearest = null, min = Infinity, idx=0, iBest=0;
  for(const p of window.lastRoute.geometry){
    const d = haversine(latitude, longitude, p.lat, p.lng);
    if(d<min){ min=d; nearest=p; iBest=idx; }
    idx++;
  }
  // Remaining distance from nearest index to end
  let remain = 0;
  for(let i=iBest;i<window.lastRoute.geometry.length-1;i++){
    const a = window.lastRoute.geometry[i], b = window.lastRoute.geometry[i+1];
    remain += haversine(a.lat,a.lng,b.lat,b.lng);
  }
  const speed = pos.coords.speed ? Math.max(0,pos.coords.speed*3.6) : 90; // km/h
  const etaMin = Math.round(remain / Math.max(10,speed) * 60);
  document.getElementById('hudEta').textContent = etaMin + ' min';
  document.getElementById('hudRemain').textContent = remain.toFixed(1) + ' km';
  // Next stop label
  let next = 'Destination';
  for(const id of selectedStops){
    const c = chargers.find(x=>x.id===id);
    // crude: if distance to charger from here along route less than total remain/2, assume next
    const dTo = haversine(latitude, longitude, c.lat, c.lng);
    if(dTo < remain/2){ next = c.name; break; }
  }
  document.getElementById('hudNext').textContent = next;
}

async function fetchJSONWithRetry(url, {retries=3, timeoutMs=8000}={}){
  for(let i=0;i<retries;i++){
    try{
      const ctrl = new AbortController();
      const to = setTimeout(()=> ctrl.abort(), timeoutMs);
      const res = await fetch(url, {signal: ctrl.signal});
      clearTimeout(to);
      if(res.ok){ return await res.json(); }
    }catch(e){ /* retry */ }
    await new Promise(r=> setTimeout(r, 500*(i+1)));
  }
  throw new Error('Network/route error');
}

function showSteps(steps){
  const panel = document.getElementById('stepsPanel');
  const list = document.getElementById('stepsList');
  if(!steps || !steps.length){ panel.style.display='none'; list.innerHTML=''; return; }
  panel.style.display='block';
  list.innerHTML='';
  steps.forEach(s=>{
    const div = document.createElement('div');
    div.className='step';
    div.innerHTML = `➡️ <div><b>${s.name||s.maneuver||'Étape'}</b><br><span class="small">${(s.distance/1000).toFixed(1)} km</span></div>`;
    list.appendChild(div);
  });
}

let baseLayer = null, darkLayer = null, usingDark=false;
(function setupTiles(){
  // replace default OSM layer with variable handle
  if(baseLayer) { map.removeLayer(baseLayer); }
  baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution:'&copy; OpenStreetMap'}).addTo(map);
  darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom: 19, attribution:'&copy; OpenStreetMap, &copy; Carto'});
  const toggle = document.getElementById('toggleTiles');
  if(toggle){
    toggle.onclick = ()=>{
      usingDark = !usingDark;
      if(usingDark){ map.removeLayer(baseLayer); darkLayer.addTo(map); toggle.textContent='☀️ Carte'; }
      else { map.removeLayer(darkLayer); baseLayer.addTo(map); toggle.textContent='🌙 Carte'; }
    };
  }
})();
