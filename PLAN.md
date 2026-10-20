# Wer weiß noch eins? – Plan

## Dateistruktur
```
index.html
src/
  main.js            Einstieg, verbindet Logik und UI
  data/              countries.json, capitals.json, animals.json (+ index.js lädt alle *.json)
  logic/
    normalize.js     Normalisierung, Anfangsbuchstabe, Levenshtein
    category.js      Kategorie aufbereiten: Varianten-Index, Buchstaben-Zählung
    game.js          reine State-Machine: createGame(), reduce(state, action)
  ui/
    app.js           Screens rendern, Events -> Actions
    timer.js         Bedenkzeit + Countdown (pausierbar), einziger Ort mit Zeit
    fx.js            Sound (WebAudio), Vibration, Konfetti
    avatars.js       SVG-Figuren
    styles.css
public/sw.js         Offline-Cache
tests/               Vitest
```

## Spielzustände (phase)
`handoff` → `turn` → (`suggest` | `dispute`) → `turn` … → `out` → `handoff` … → `winner`

- handoff: "Handy an X weitergeben", Bereit startet den Zug
- turn: Eingabe offen; UI-Timer läuft (Bedenkzeit, danach Countdown 5..1)
- suggest: "Meintest du Tansania?" (Timer pausiert)
- dispute: Abstimmung der übrigen Spieler (Timer pausiert)
- out: Spieler fliegt raus, neuer Buchstabe, nächster Spieler
- winner: einer übrig

Logik kennt keine Zeit. UI meldet `TIMEOUT` und übergibt Antwortdauer in `SUBMIT`.

## Actions
START, READY, SUBMIT {text, ms}, ACCEPT_SUGGESTION, REJECT_SUGGESTION, VOTE {playerId, yes}, TIMEOUT, CONTINUE

## Datenformat (eine Datei pro Kategorie)
```json
{
  "id": "countries",
  "label": "Länder",
  "task": "EIN LAND MIT",
  "entries": [
    { "name": "Elfenbeinküste", "variants": ["Côte d'Ivoire", "Cote d Ivoire"], "letters": ["E", "C"] }
  ]
}
```
`letters` = Anfangsbuchstaben von Name + Varianten (Ä→A …). Der Loader rechnet sie zur Sicherheit nach.
Neue Kategorie = neue JSON-Datei in `src/data/`.
