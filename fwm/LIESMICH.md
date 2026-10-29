# FW-M im Testobjekt

Synthetischer Messaufbau. Er misst, ob eine nur lesende Wache Fremdmeldungen
unter einem Prüfnamen erkennt und wie sich manuelle Vercel-Wege im
GitHub-Ereignisstrom zeigen. Keine echten Daten, keine Geheimnisse, kein Code
eines anderen Projekts. Ergebnisse belegen das Verhalten der Hersteller.

| Datei | Zweck |
|---|---|
| `.github/workflows/tb-wache.yml` | Testwache, Auslöser `status` und `deployment_status`, nur Leserechte |
| `fwm/tb-wache.mjs` | liest die Ereignisdatei, meldet `FREMDSTATUS`, `FREIGABE_UNZULAESSIG:<Grundcode>`, `NICHT_AUSWERTBAR` oder `OHNE_BEFUND` |
| `fwm/tb-pruefer.mjs` | Prüfstatus eines Commits gegen `TB Gate A` und `TB Gate B`; `--selbsttest` ohne Netz |

`OHNE_BEFUND` und `FREIGABEFAEHIG` sind keine Freigabe.
