// FW-M im Testobjekt (synthetisch): Testwache. Nur lesende Erkennung, blockiert nichts.
// Ereignisdaten kommen ausschliesslich aus der Ereignisdatei (GITHUB_EVENT_PATH), nie aus
// Workflow-Ausdruecken. Codes: FREMDSTATUS, FREIGABE_UNZULAESSIG:<Grundcode>,
// NICHT_AUSWERTBAR, OHNE_BEFUND. Jeder Befund beendet den Lauf rot. OHNE_BEFUND ist keine Freigabe.
import { appendFileSync, readFileSync } from 'node:fs';
import { PRUEFNAMEN, bewerte, githubAbruf, lies } from './tb-pruefer.mjs';

const zeile = (t) => {
  console.log(t);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${t}\n`);
};
const ereignis = process.env.GITHUB_EVENT_NAME;
let ev;
try {
  ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
} catch {
  zeile('WACHE_CODE=NICHT_AUSWERTBAR (Ereignisdatei nicht lesbar)');
  process.exit(1);
}
zeile(`Ereignis: ${ereignis}; Laufbeginn (UTC): ${new Date().toISOString()}`);

if (ereignis === 'status') {
  zeile(`Status: Kontext ${ev.context}; Zustand ${ev.state}; SHA ${ev.sha}; Status-ID ${ev.id}; angelegt ${ev.created_at}`);
  if (PRUEFNAMEN.includes(ev.context)) {
    zeile('WACHE_CODE=FREMDSTATUS (Commit-Status unter einem Pruefnamen; GitHub Actions meldet die Pflichtpruefungen als Check-Runs)');
    process.exit(1);
  }
  zeile('WACHE_CODE=OHNE_BEFUND (Kontext ist kein Pruefname)');
  process.exit(0);
}

if (ereignis === 'deployment_status') {
  const d = ev.deployment ?? {};
  const s = ev.deployment_status ?? {};
  zeile(`Deployment ${d.id}; Status-ID ${s.id}; Umgebung ${d.environment}; Zustand ${s.state}; SHA ${d.sha}`);
  zeile(`environment_url ${s.environment_url ?? '-'}; log_url ${s.log_url ?? '-'}; target_url ${s.target_url ?? '-'}`);
  zeile(`Stichzeitpunkt ${s.created_at} (Herkunft: deployment_status.created_at); Sicht voll`);
  const r = bewerte(await lies({ repo: process.env.GITHUB_REPOSITORY, sha: d.sha, sicht: 'voll', stichzeit: s.created_at, herkunft: 'vorgabe', abruf: githubAbruf(process.env.GH_TOKEN) }));
  const enden = Object.values(r.belege.versuche ?? {}).flat().map((x) => Date.parse(x.ende)).filter(Number.isFinite);
  if (enden.length) zeile(`Delta-A (Sekunden): ${Math.floor(Date.parse(s.created_at) / 1000) - Math.floor(Math.max(...enden) / 1000)}`);
  zeile(`Laeufe: ${JSON.stringify(r.belege.pflichtlaeufe ?? [])}`);
  zeile(`Pruefer: ${r.code}; ${r.gruende.join('; ')}`);
  if (r.code === 'FREIGABEFAEHIG') { zeile('WACHE_CODE=OHNE_BEFUND'); process.exit(0); }
  if (r.code === 'DATEN_UNVOLLSTAENDIG') { zeile('WACHE_CODE=NICHT_AUSWERTBAR'); process.exit(1); }
  zeile(`WACHE_CODE=FREIGABE_UNZULAESSIG:${r.code}`);
  process.exit(1);
}

zeile(`WACHE_CODE=NICHT_AUSWERTBAR (unerwartetes Ereignis ${ereignis})`);
process.exit(1);
