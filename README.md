# release-gate-testbed

Synthetisches Testobjekt. Es misst das Verhalten von GitHub-Rulesets und
Vercel Deployment Checks in sechs Messfällen (M1 bis M6). Es enthält **keine**
echten Daten, **keine** Geheimnisse und **keinen** produktiven Code; es gibt
keine Umgebungsvariablen und keine Datenbank. Ergebnisse belegen das Verhalten
der Hersteller, nicht die Konfiguration eines anderen Projekts.

## Inhalt

| Datei | Zweck |
|---|---|
| `build.mjs`, `vercel.json` | statische Seite; die Meta-Felder `tb-commit`, `tb-build`, `tb-env` zeigen, welcher Commit ausgeliefert wird |
| `umgebung-schluessel.pub.pem` | Isolationsprüfung: der Build ordnet jeden Umgebungsvariablen-**Namen** einer Gruppe zu (Vercel-System, Laufzeit, Plattform, sonstige `VERCEL_`/`NOW_`, unbekannt), veröffentlicht im Meta-Feld `tb-umgebung` nur Anzahlen und eine Prüfsumme und die Namensliste nur verschlüsselt (`/umgebung.json`); Werte werden nie gelesen. `umgebungStreng` in `gate-control.json` lässt den Build bei unbekannten Namen oder einem Bypass-Secret scheitern |
| `.github/workflows/tb-gate.yml`, `.github/gate.sh` | zwei Pflichtprüfungen `TB Gate A`, `TB Gate B`; ihr Ergebnis steuert `gate-control.json` |
| `gate-control.json` | `pass`, `fail`, `fail-on-push`, `fail-first-attempt`, `fail-first-attempt-on-push`, `timeout-on-push`, `slow-pass` je Prüfung |
| `testbed.config.json` | Projektname und Namen der Pflichtprüfungen |
| `testbed.local.example.json` | Vorlage für die lokale, nie veröffentlichte Datei mit Repository, Adresse und Sperrliste |
| `scripts/guard.mjs` | Offline-Prüfung vor Veröffentlichung und Messung (Remote, Ausschluss der lokalen Datei, keine `.env`, keine internen Begriffe, keine Geheimnismuster) |
| `scripts/zeitlinie.mjs` | Messung: Abrufe der Adressen und GitHub-Ereignisse als JSONL |
| `scripts/status-fremd.mjs` | M3: gleichnamiger Commit-Status aus anderer Quelle (nur mit `TB_FREIGABE_M3=ja`) |
| `scripts/auswertung.mjs` | Auswertung je Messfall mit festen Ergebniscodes; `NICHT_AUSWERTBAR` ist nie „bestanden" |
| `scripts/selbsttest.mjs` | Offline-Selbsttest aller Auswertungen und Sperren |

## Lokal prüfen (ohne Netz)

```
node scripts/selbsttest.mjs
node scripts/guard.mjs
```

## Grenzen

- Ohne `testbed.local.json` oder mit Platzhaltern verweigern alle Netzskripte.
- Jede Adresse außerhalb des Testprojekts und jede gesperrte Adresse wird abgelehnt.
- Messbelege werden nie überschrieben und nicht veröffentlicht (`belege/` ist ausgeschlossen).
