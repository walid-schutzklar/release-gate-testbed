#!/usr/bin/env bash
# Verhalten einer Pflichtpruefung nach gate-control.json.
#   pass                         -> Exit 0
#   fail                         -> Exit 1 (echter Pruefungsfehler)
#   fail-on-push                 -> beim Push auf main rot, im Pull Request gruen (M1, M3, M5)
#   fail-first-attempt           -> Versuch 1 rot, ab Versuch 2 gruen
#   fail-first-attempt-on-push   -> wie oben, aber nur beim Push auf main; im Pull Request gruen (M2)
#   timeout-on-push              -> beim Push ueber das Zeitlimit (Abbruch ohne Ergebnis), im PR gruen (M2)
#   slow-pass                    -> wartet slowSekunden, dann gruen (M4)
# Unbekannter Wert -> Exit 1 (nie still gruen).
# Die "-on-push"-Varianten bilden den realen Fall nach, dass ein Stand im
# Pull Request gruen war und erst auf main rot wird; so bleibt das Ruleset
# des Testobjekts (PR-Pflicht, strict) unveraendert aktiv.
set -euo pipefail
modus="$(jq -r --arg g "$GATE" '.[$g] // "UNBEKANNT"' gate-control.json)"
ereignis="${GITHUB_EVENT_NAME:-unbekannt}"
echo "Gate: $GATE  Modus: $modus  Ereignis: $ereignis  Versuch: $VERSUCH  Zeit: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
case "$modus" in
  pass) exit 0 ;;
  fail) echo "Absichtlicher Pruefungsfehler (Messfall)"; exit 1 ;;
  fail-on-push)
    if [ "$ereignis" = "push" ]; then echo "Push auf main: absichtlich rot"; exit 1; fi
    exit 0 ;;
  fail-first-attempt)
    if [ "$VERSUCH" -le 1 ]; then echo "Versuch 1: absichtlich rot"; exit 1; fi
    echo "Versuch $VERSUCH: gruen"; exit 0 ;;
  fail-first-attempt-on-push)
    if [ "$ereignis" = "push" ] && [ "$VERSUCH" -le 1 ]; then echo "Push, Versuch 1: absichtlich rot"; exit 1; fi
    echo "gruen"; exit 0 ;;
  timeout-on-push)
    if [ "$ereignis" = "push" ]; then echo "Push: laeuft absichtlich ueber das Zeitlimit"; sleep 600; exit 1; fi
    exit 0 ;;
  slow-pass)
    s="$(jq -r '.slowSekunden // 240' gate-control.json)"
    echo "Warte $s Sekunden"; sleep "$s"; exit 0 ;;
  *) echo "Unbekannter Modus '$modus' - rot"; exit 1 ;;
esac
