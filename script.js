// initialize Map
var map = L.map('map', {
  zoomControl: false // deactivate zoom buttons on the left
}).setView([48.7758, 9.1829], 8);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap-Mitwirkende'
}).addTo(map);

// format (false) latitude values
function formatLatitude(value) {
  const stringValue = value.toString();
  return parseFloat(stringValue.slice(0, 2) + '.' + stringValue.slice(2));
}

// format (false) longitutde values
function formatLongitude(value) {
  const stringValue = value.toString();
  if (parseInt(stringValue[0]) < 2) {
    return parseFloat(stringValue.slice(0, 2) + '.' + stringValue.slice(2));
  } else {
    return parseFloat(stringValue.slice(0, 1) + '.' + stringValue.slice(1));
  }
}

// Datei-Upload-Event
document.getElementById('fileInput').addEventListener('change', function (e) {
  var file = e.target.files[0];
  var reader = new FileReader();

  reader.onload = function (e) {
    var data = new Uint8Array(e.target.result);
    var workbook = XLSX.read(data, { type: 'array' });

    // choose first tabel
    var sheetName = workbook.SheetNames[0];
    var sheet = workbook.Sheets[sheetName];

    // convert tabel to json
    var json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    console.log("Eingelesene Daten:", json);

    // process data and set markers
    json.forEach(function (row, index) {
      if (row.lat && row.lng) {
        // call formatting functions
        var lat = formatLatitude(row.lat);
        var lng = formatLongitude(row.lng);

        console.log(`Zeile ${index + 1}: Korrigierte Koordinaten lat=${lat}, lng=${lng}`); // debug

        // fallback for missing fields
        var ansprechperson =
          (row.Anrede || "keine Angaben") +
          " " +
          (row.Vorname || "keine Angaben") +
          " " +
          (row.Nachname || "keine Angaben");
        var modelle = row.Modelle || "keine Angaben";
        var schule = row.Schule || "keine Angaben";

        // add markers on map
        var marker = L.marker([lat, lng]).addTo(map);
        var popupContent =
          "<b>" + schule + "</b><br>" +
          "Ansprechperson: " + ansprechperson + "<br>" +
          "Modelle: " + modelle;
        marker.bindPopup(popupContent);
      } else {
        console.warn(`Ungültige oder fehlende Daten in Zeile ${index + 1}:`, row);
      }
    });
  };

  reader.readAsArrayBuffer(file);
});

