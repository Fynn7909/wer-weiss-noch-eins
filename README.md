# Wer weiß noch eins?

Partyspiel im Browser nach einem TikTok-Format: Oben steht „EIN LAND MIT T“, reihum nennt jeder ein passendes Land. Nichts doppelt. Wem nichts einfällt, wird von 5 runtergezählt und fliegt raus. Der Letzte gewinnt.

Ein Handy, das reihum weitergegeben wird. Läuft komplett im Browser, auch offline.

## Lokal starten

```bash
npm install
npm run dev      # http://localhost:5173 – im WLAN auch vom Handy über die angezeigte Network-Adresse
npm test         # Unit-Tests der Spiellogik
npm run build    # fertige Seite in dist/
```

## Kostenlos online stellen

**Netlify (am einfachsten):** `npm run build`, dann auf <https://app.netlify.com/drop> den Ordner `dist` reinziehen. Fertig, du bekommst einen Link.

**GitHub Pages:** Repo anlegen und pushen, dann `npm run build` und den Inhalt von `dist` auf den Branch `gh-pages` legen, z. B. mit
`npx gh-pages -d dist`. In den Repo-Einstellungen unter *Pages* den Branch `gh-pages` wählen. Pfade sind relativ (`base: './'`), Unterordner funktionieren also.

## Neue Kategorie

Neue JSON-Datei in `src/data/` anlegen, sie erscheint automatisch im Startbildschirm:

```json
{
  "id": "staedte",
  "label": "Städte",
  "task": "EINE STADT MIT",
  "entries": [{ "name": "München", "variants": ["Muenchen", "Munich"], "letters": ["M"] }]
}
```

Kurzform für Themen (so sind die 100 Themen in `src/data/themen/*.json` geschrieben, eine Datei = eine Gruppe im Themen-Fenster):

```json
{ "id": "automarken", "label": "Automarken", "task": "EINE AUTOMARKE MIT", "group": "Marken & Technik",
  "words": "Audi, BMW, VW / Volkswagen" }
```

Komma trennt Einträge, `/` Schreibweisen. `"open": true` heißt: Liste ist nur ein Anfang, Buchstaben kommen aus den häufigen, und Unbekanntes wird abgestimmt (so laufen auch eigene Kategorien aus dem Spiel). Hauptkategorien auf dem Startbildschirm: `MAIN` in `src/ui/app.js`.

Umlaut-, ß-, Groß/klein- und Bindestrich-Varianten braucht es nicht, die werden automatisch gleich behandelt. `letters` wird beim Laden nachgerechnet.

## Aufbau

- `src/logic/` – reine Spiellogik (State-Machine, keine Zeit, kein DOM). Der State ist einfaches JSON, damit später ein Online-Modus dieselbe Logik nutzen kann.
- `src/ui/` – Bildschirme, Timer, Sound, Figuren.
- `tests/` – Vitest.
- `PLAN.md` – Spielzustände und Datenformat.

## Online spielen

Jeder am eigenen Handy. Startseite → **Online** → „Raum erstellen“ zeigt einen 4-stelligen Code
(oder Link `?raum=CODE`), die anderen tippen ihn unter „Beitreten“ ein.

- Verbindung per WebRTC über [PeerJS](https://peerjs.com) (öffentlicher Vermittlungs-Server, danach direkt Handy zu Handy).
- Wer den Raum aufmacht, ist Host: sein Gerät rechnet das Spiel (`logic/game.js`) und schickt jeden neuen Stand an alle.
  Gäste schicken nur Aktionen; `canAct()` prüft, dass jeder nur selbst antwortet und nur für sich abstimmt.
- Zeit zählt der Host. „Bereit“ und „Weiter“ gehen online nach ein paar Sekunden von selbst.
- Verbindung weg: 15 s Wartezeit, wer im selben Tab neu verbindet, bekommt seinen Platz zurück. Danach ist er raus.
- Host verlässt = Spiel vorbei für alle.
- Online wird eine **Partie** gespielt: Host stellt Runden (1–10) und „Schlag auf Schlag“ ein.
  Die Bedenkzeit kann jeder in der Lobby verschieben, sie gilt sofort für alle.
- Jeder wählt in der Lobby 3 Themen. Runde 1 gehört dem ersten Spieler, Runde 2 dem zweiten usw. –
  aus dessen Themen wird eins ausgelost (wer nichts gewählt hat: Zufallsthema). Jede Runde ist ein ganzes Spiel.
- Punkte pro Runde nach Platz: 10 · 5 · 3, Rest 0. Danach Tabelle mit Umsortier-Animation (`src/ui/board.js`), nach der letzten Runde Endstand.

Dateien: `src/net/peer.js` (Transport), `src/net/room.js` (Lobby, Plätze, Nachrichten), `src/logic/match.js` (Runden, Themenplan, Punkte),
Tests in `tests/room.test.js` und `tests/match.test.js`.
