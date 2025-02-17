// ========================================
// KONSTANTEN & INITIALISIERUNG
// ========================================
const stuttgartLat = 48.7758;
const stuttgartLng = 9.1829;

const map = L.map('map', {
  zoomControl: false
}).setView([stuttgartLat, stuttgartLng], 8);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap-Mitwirkende'
}).addTo(map);

// Erstelle eigene Panes:
// Pane für die Landkreis-Polygone (niedriger zIndex als Marker)
map.createPane('countyPolygonPane');
map.getPane('countyPolygonPane').style.zIndex = 300;

// Pane für die Landkreis-Labels (noch weiter hinten)
map.createPane('countyLabelPane');
map.getPane('countyLabelPane').style.zIndex = 250;

// Landkreis-Grenzen dynamisch über Overpass API abrufen und als GeoJSON-Layer hinzufügen
let countiesData = null;
const overpassUrl = "https://overpass-api.de/api/interpreter";
const query = `
  [out:json][timeout:25];
  area["name"="Baden-Württemberg"][admin_level=4]->.searchArea;
  relation["admin_level"="6"](area.searchArea);
  out geom;
`;

fetch(overpassUrl, {
  method: "POST",
  body: "data=" + encodeURIComponent(query)
})
  .then(response => response.json())
  .then(data => {
    // Konvertiere die Overpass-Antwort in GeoJSON mithilfe von osmtogeojson
    countiesData = osmtogeojson(data);
    L.geoJSON(countiesData, {
      pane: 'countyPolygonPane', // Polygone in eigenes Pane legen
      filter: function(feature) {
        // Nur Polygon-Features (keine Centroid-Punkte)
        return feature.geometry.type !== "Point";
      },
      style: {
        color: 'orange',
        weight: 2,
        fill: false
      },
      onEachFeature: function(feature, layer) {
        // Berechne den Mittelpunkt des Polygons
        const center = layer.getBounds().getCenter();
        // Versuche, den Namen unter "name" oder "NAME" zu finden
        const countyName = feature.properties.name || feature.properties.NAME || "Unbekannt";
        // Erstelle einen Marker an der Mitte als Label
        L.marker(center, {
          icon: L.divIcon({
            className: 'county-label',
            html: countyName,
            // iconSize kann über CSS definiert werden, oder hier explizit:
            iconSize: [160, 20]
          }),
          interactive: false, // keine Interaktionen
          pane: 'countyLabelPane'
        }).addTo(map);
      }
    }).addTo(map);
  })
  .catch(err => console.error('Fehler beim Laden der Landkreise:', err));

const routeColors = ['blue', 'red', 'green', 'purple', 'orange', 'darkred', 'darkblue', 'darkgreen', 'darkpurple', 'cadetblue'];

let markers = [];
let routeGenerated = false;

// ========================================
// DOM-REFERENZEN & UI-ELEMENTE
// ========================================
const uploadModal = document.getElementById('uploadModal');
const modalFileInput = document.getElementById('modalFileInput');
const controls = document.getElementById('controls');
const maxHoursInput = document.getElementById('maxHours');
const calculateRouteBtn = document.getElementById('calculateRoute');
const stuttgartStartEndCheckbox = document.getElementById('stuttgartStartEnd');

// Number Input Buttons
const decrementButton = document.querySelector('.decrement');
const incrementButton = document.querySelector('.increment');
const numberInput = document.getElementById('maxHours');

// ========================================
// EVENT-LISTENER
// ========================================
modalFileInput.addEventListener('change', handleFileUpload);
calculateRouteBtn.addEventListener('click', handleCalculateRouteClick);

decrementButton.addEventListener('click', handleDecrementClick);
incrementButton.addEventListener('click', handleIncrementClick);

numberInput.addEventListener('contextmenu', (e) => e.preventDefault());
numberInput.addEventListener('mousedown', handleNumberInputMouseDown);
document.addEventListener('mousemove', handleDocumentMouseMove);
document.addEventListener('mouseup', handleDocumentMouseUp);

// ========================================
// EVENT-HANDLER FUNKTIONEN
// ========================================
async function handleCalculateRouteClick() {
  // Wenn bereits eine Route dargestellt ist, fungiert der Button nun als "Löschen"-Funktion
  if (routeGenerated) {
    // Route löschen
    removeAllPolylines();
    routeGenerated = false;

    // Button zurücksetzen
    calculateRouteBtn.textContent = "Route berechnen";
    calculateRouteBtn.style.backgroundColor = "";
    calculateRouteBtn.disabled = false;
    document.body.style.cursor = 'auto';
    return;
  }

  // Falls noch keine Route generiert wurde: Route berechnen
  const maxHours = parseFloat(maxHoursInput.value);
  if (isNaN(maxHours) || maxHours <= 0) {
    alert("Bitte eine gültige maximale Stundenanzahl eingeben.");
    return;
  }

  const stuttgartStartEnd = stuttgartStartEndCheckbox.checked;
  showLoadingState(calculateRouteBtn);

  removeAllPolylines();

  // Clustering (4km Radius)
  const clusterRadius = 4000;
  const clusteredMarkers = clusterClosePoints(markers, clusterRadius);

  // TSP-Heuristik (Nearest Neighbor)
  let ordered = tspNearestNeighbor([stuttgartLat, stuttgartLng], clusteredMarkers);

  // 2-Opt Verbesserung anwenden
  ordered = twoOpt(ordered, {lat: stuttgartLat, lng: stuttgartLng});

  // Routen erstellen basierend auf maxHours
  const routes = await splitIntoTimedRoutes(ordered, maxHours, stuttgartStartEnd);

  for (let i = 0; i < routes.length; i++) {
    const routeData = routes[i];
    const color = routeColors[i % routeColors.length];
    const wps = routeData.waypoints.map(m => L.Routing.waypoint(L.latLng(m.lat, m.lng)));

    L.Routing.osrmv1().route(wps, function(err, resp) {
      if (err) {
        console.error("Fehler beim Routen:", err);
        hideLoadingState(calculateRouteBtn);
        return;
      }
      const route = resp[0];
      const polyline = L.polyline(route.coordinates, {color: color, weight:8, opacity:0.7}).addTo(map);

      const durationHours = route.summary.totalTime / 3600;
      const durationText = "Dauer: " + durationHours.toFixed(2) + " Stunden";
      const googleMapsUrl = createGoogleMapsLink(routeData.waypoints);

      polyline.bindPopup(
        `<div>
          <p>${durationText}</p>
          <a href="${googleMapsUrl}" target="_blank">In Google Maps öffnen</a>
        </div>`
      );
    });
  }

  hideLoadingState(calculateRouteBtn);

  // Route wurde generiert: Button ändern auf "Route löschen"
  routeGenerated = true;
  calculateRouteBtn.textContent = "Route löschen";
  calculateRouteBtn.style.backgroundColor = "red";
  calculateRouteBtn.disabled = false;
  document.body.style.cursor = 'auto';
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  const reader = new FileReader();

  reader.onload = function(e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array' });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    console.log("Eingelesene Daten:", json);

    markers = [];
    json.forEach(function (row, index) {
      if (row.lat && row.lng) {
        const lat = formatLatitude(row.lat);
        const lng = formatLongitude(row.lng);

        const ansprechperson =
          (row.Anrede || "keine Angaben") + " " +
          (row.Vorname || "keine Angaben") + " " +
          (row.Nachname || "keine Angaben");
        const modelle = row.Modelle || "keine Angaben";
        const schule = row.Schule || "keine Angaben";

        const marker = L.marker([lat, lng]).addTo(map);
        const popupContent =
          "<b>" + schule + "</b><br>" +
          "Ansprechperson: " + ansprechperson + "<br>" +
          "Modelle: " + modelle;
        marker.bindPopup(popupContent);

        markers.push({ lat: lat, lng: lng });
      } else {
        console.warn(`Ungültige oder fehlende Daten in Zeile ${index + 1}:`, row);
      }
    });

    uploadModal.style.display = 'none';
    controls.classList.remove('hidden');
    maxHoursInput.disabled = false;
    calculateRouteBtn.disabled = false;
  };

  reader.readAsArrayBuffer(file);
}

function handleDecrementClick() {
  const currentValue = parseInt(numberInput.value) || 0;
  const min = parseInt(numberInput.min) || 0;
  if (currentValue > min) {
    numberInput.value = currentValue - 1;
  }
}

function handleIncrementClick() {
  const currentValue = parseInt(numberInput.value) || 0;
  const max = parseInt(numberInput.max) || 100;
  if (currentValue < max) {
    numberInput.value = currentValue + 1;
  }
}

// Rechtsklick-Slide-Funktion Variablen
let isDragging = false;
let startX = 0;
let startValue = 0;

function handleNumberInputMouseDown(e) {
  // Nur bei rechter Maustaste (button===2)
  if (e.button === 2) {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startValue = parseInt(numberInput.value) || 0;
    document.body.style.userSelect = 'none'; 
  }
}

function handleDocumentMouseMove(e) {
  if (isDragging) {
    const deltaX = e.clientX - startX;
    const change = Math.floor(deltaX / 20);

    const min = parseInt(numberInput.min) || 0;
    const max = parseInt(numberInput.max) || 100;

    let newValue = startValue + change;
    newValue = Math.max(newValue, min);
    newValue = Math.min(newValue, max);
    numberInput.value = newValue;
  }
}

function handleDocumentMouseUp(e) {
  if (isDragging) {
    isDragging = false;
    document.body.style.userSelect = 'auto';
  }
}

// ========================================
// HILFSFUNKTIONEN
// ========================================
function formatLatitude(value) {
  const stringValue = value.toString();
  return parseFloat(stringValue.slice(0, 2) + '.' + stringValue.slice(2));
}

function formatLongitude(value) {
  const stringValue = value.toString();
  if (parseInt(stringValue[0]) < 2) {
    return parseFloat(stringValue.slice(0, 2) + '.' + stringValue.slice(2));
  } else {
    return parseFloat(stringValue.slice(0, 1) + '.' + stringValue.slice(1));
  }
}

function distance(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // Erdradius in m
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)* 
            Math.sin(dLng/2)*Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; 
}

function totalDistance(route, startPoint) {
  let current = startPoint;
  let dist = 0;
  for (let i = 0; i < route.length; i++) {
    dist += distance(current.lat, current.lng, route[i].lat, route[i].lng);
    current = route[i];
  }
  return dist;
}

function clusterClosePoints(points, radius) {
  const clustered = [];
  const used = new Array(points.length).fill(false);

  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const cluster = [points[i]];
    used[i] = true;
    for (let j = i+1; j < points.length; j++) {
      if (used[j]) continue;
      if (distance(points[i].lat, points[i].lng, points[j].lat, points[j].lng) <= radius) {
        cluster.push(points[j]);
        used[j] = true;
      }
    }
    const avgLat = cluster.reduce((sum, p) => sum+p.lat, 0)/cluster.length;
    const avgLng = cluster.reduce((sum, p) => sum+p.lng, 0)/cluster.length;
    clustered.push({lat:avgLat, lng:avgLng});
  }

  return clustered;
}

function tspNearestNeighbor(start, points) {
  const remaining = points.slice();
  const route = [];
  let current = {lat:start[0], lng:start[1]};

  while (remaining.length > 0) {
    let nearestIndex = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distance(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIndex = i;
      }
    }
    route.push(remaining[nearestIndex]);
    current = remaining[nearestIndex];
    remaining.splice(nearestIndex, 1);
  }

  return route;
}

// 2-Opt Algorithmus zur Verbesserung der Route
function twoOpt(route, startPoint) {
  let improved = true;
  let bestRoute = route;
  let bestDist = totalDistance(route, startPoint);

  while (improved) {
    improved = false;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let k = i+1; k < bestRoute.length; k++) {
        const newRoute = twoOptSwap(bestRoute, i, k);
        const newDist = totalDistance(newRoute, startPoint);
        if (newDist < bestDist) {
          bestDist = newDist;
          bestRoute = newRoute;
          improved = true;
        }
      }
    }
  }

  return bestRoute;
}

function twoOptSwap(route, i, k) {
  const newRoute = route.slice();
  let reversedSegment = newRoute.slice(i, k+1).reverse();
  return [...newRoute.slice(0, i), ...reversedSegment, ...newRoute.slice(k+1)];
}

function removeAllPolylines() {
  map.eachLayer(function(layer) {
    if (layer instanceof L.Polyline && !(layer instanceof L.TileLayer)) {
      map.removeLayer(layer);
    }
  });
}

async function splitIntoTimedRoutes(orderedMarkers, maxHours, stuttgartStartEnd) {
  const routes = [];
  const maxSeconds = maxHours * 3600;
  let currentStart = {lat: stuttgartLat, lng: stuttgartLng};

  let index = 0;
  while (index < orderedMarkers.length) {
    let currentRoute = [];
    currentRoute.push(currentStart);

    while (index < orderedMarkers.length) {
      const testRoute = currentRoute.concat([orderedMarkers[index]]);
      const dur = await getRouteDuration(testRoute);
      if (dur > maxSeconds) {
        break;
      } else {
        currentRoute = testRoute;
        index++;
      }
    }

    if (stuttgartStartEnd) {
      const testRouteEndStuttgart = currentRoute.concat([{lat: stuttgartLat, lng: stuttgartLng}]);
      await getRouteDuration(testRouteEndStuttgart);
      currentRoute = testRouteEndStuttgart;
    } else {
      if (index >= orderedMarkers.length) {
        const testRouteEnd = currentRoute.concat([{lat: stuttgartLat, lng: stuttgartLng}]);
        await getRouteDuration(testRouteEnd);
        currentRoute = testRouteEnd;
      }
    }

    const lastPoint = currentRoute[currentRoute.length - 1];
    currentStart = lastPoint;

    routes.push({waypoints: currentRoute});
  }

  return routes;
}

function getRouteDuration(routePoints) {
  return new Promise((resolve, reject) => {
    const wps = routePoints.map(p => L.Routing.waypoint(L.latLng(p.lat, p.lng)));
    L.Routing.osrmv1().route(wps, function(err, resp) {
      if (err) {
        return reject(err);
      }
      const dur = resp[0].summary.totalTime; 
      resolve(dur);
    });
  });
}

function createGoogleMapsLink(waypoints) {
  const maxWaypointsForGoogle = 20;
  const origin = waypoints[0];
  const destination = waypoints[waypoints.length - 1];
  let intermediate = waypoints.slice(1, waypoints.length - 1);

  if (intermediate.length > maxWaypointsForGoogle) {
    intermediate = [];
  }

  const waypointParam = intermediate.map(function(wp) {
    return wp.lat + ',' + wp.lng;
  }).join('|');

  let googleMapsUrl = 'https://www.google.com/maps/dir/?api=1' +
    '&origin=' + origin.lat + ',' + origin.lng +
    '&destination=' + destination.lat + ',' + destination.lng +
    (waypointParam ? '&waypoints=' + encodeURIComponent(waypointParam) : '');

  return googleMapsUrl;
}

function showLoadingState(button) {
  button.classList.add('loading');
  button.disabled = true;
  button.textContent = "Wird berechnet...";
  // Globaler Cursor auf 'wait'
  document.body.style.cursor = 'wait';
}

function hideLoadingState(button) {
  button.classList.remove('loading');
  button.disabled = false;
  button.textContent = "Route berechnen";
  // Globaler Cursor zurücksetzen
  document.body.style.cursor = 'auto';
}

// Funktionen zum Aus-/Einblenden der County-Linien und Labels

function hideCountyLayers() {
  // Hole beide Panes und setze display auf "none"
  const labelPane = map.getPane('countyLabelPane');
  const polygonPane = map.getPane('countyPolygonPane');
  if (labelPane) {
    labelPane.style.display = 'none';
  }
  if (polygonPane) {
    polygonPane.style.display = 'none';
  }
}

function showCountyLayers() {
  // Setze beide Panes auf "block"
  const labelPane = map.getPane('countyLabelPane');
  const polygonPane = map.getPane('countyPolygonPane');
  if (labelPane) {
    labelPane.style.display = 'block';
  }
  if (polygonPane) {
    polygonPane.style.display = 'block';
  }
}

// Checkbox-Event-Listener zum Umschalten der County-Layer
document.getElementById('toggleLabels').addEventListener('change', function(e) {
  if (e.target.checked) {
    showCountyLayers();
  } else {
    hideCountyLayers();
  }
});
