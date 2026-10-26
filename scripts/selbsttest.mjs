// Offline-Selbsttest: kann jede Auswertung und jede Sperre rot werden?
// Ohne Netz, ohne gh. Exit 0 nur, wenn alle Faelle bestehen und mindestens
// MINDESTFAELLE gelaufen sind.
import { auswerten } from './auswertung.mjs';
import { Abbruch, ladeKonfig, pruefeRepo, pruefeUrl } from './lib.mjs';

const MINDESTFAELLE = 30;
let gelaufen = 0;
let fehler = 0;
const melde = (id, text, ok, info = '') => {
  gelaufen++;
  if (!ok) fehler++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${id}  ${text}${info ? `  [${info}]` : ''}`);
};

const ALT = 'a'.repeat(40);
const NEU = 'b'.repeat(40);
const URL1 = 'https://release-gate-testbed.vercel.app/';
const PFLICHT = ['TB Gate A', 'TB Gate B'];
const t = (s) => new Date(Date.UTC(2026, 9, 27, 10, 0, 0) + s * 1000).toISOString().replace(/\.000Z$/, 'Z');
const datum = (s) => new Date(Date.UTC(2026, 9, 27, 10, 0, 0) + s * 1000).toUTCString();
const start = { art: 'start', lokal: t(0), urls: [URL1] };
const abruf = (s, commit, status = 200) => ({ art: 'abruf', lokal: t(s), url: URL1, status, serverDatum: datum(s), commit });
const run = (id, name, concl, s) => ({ art: 'checkrun', id, name, app: 'github-actions', status: 'completed', conclusion: concl, completed_at: t(s) });
const abrufe = (von, bis, schritt, commit) => {
  const r = [];
  for (let s = von; s <= bis; s += schritt) r.push(abruf(s, commit));
  return r;
};
const fall = (id, text, f, ereignisse, erwartet, extra = {}) => {
  try {
    const r = auswerten({ ereignisse, fall: f, shaNeu: NEU, shaAlt: ALT, pflicht: PFLICHT, minBeobachtungS: 600, ...extra });
    melde(id, text, r.code === erwartet, `${r.code}${r.code !== erwartet ? ` statt ${erwartet}: ${r.grund}` : ''}`);
  } catch (e) {
    melde(id, text, false, e.message);
  }
};

// ---- M1
fall('M1-01', 'rote Pruefung, nie umgeschaltet, 900 s beobachtet -> GEHALTEN', 'M1',
  [start, run(1, 'TB Gate A', 'failure', 60), run(2, 'TB Gate B', 'success', 50), ...abrufe(0, 960, 5, ALT), { art: 'ende' }], 'GEHALTEN');
fall('M1-02', 'rote Pruefung, trotzdem umgeschaltet -> UMGESCHALTET_TROTZ_ROT', 'M1',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 300, 5, ALT), ...abrufe(305, 960, 5, NEU)], 'UMGESCHALTET_TROTZ_ROT');
fall('M1-03', 'zu kurz beobachtet -> NICHT_AUSWERTBAR', 'M1',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 300, 5, ALT)], 'NICHT_AUSWERTBAR');
fall('M1-04', 'kein Fehlschlag beobachtet -> NICHT_AUSWERTBAR', 'M1',
  [start, run(1, 'TB Gate A', 'success', 60), ...abrufe(0, 960, 5, ALT)], 'NICHT_AUSWERTBAR');
fall('M1-05', 'abgebrochene Pruefung (cancelled) zaehlt als nicht gruen -> GEHALTEN', 'M1',
  [start, run(1, 'TB Gate A', 'cancelled', 60), ...abrufe(0, 960, 5, ALT)], 'GEHALTEN');
fall('M1-06', 'keine Abrufe -> NICHT_AUSWERTBAR', 'M1', [start, run(1, 'TB Gate A', 'failure', 60)], 'NICHT_AUSWERTBAR');
fall('M1-07', 'nur Fehlabrufe (status null) -> NICHT_AUSWERTBAR', 'M1',
  [start, run(1, 'TB Gate A', 'failure', 60), { art: 'abruf', lokal: t(900), url: URL1, status: null }], 'NICHT_AUSWERTBAR');
fall('M1-08', 'ohne Start-Eintrag -> NICHT_AUSWERTBAR', 'M1', [run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 960, 5, ALT)], 'NICHT_AUSWERTBAR');

// ---- M2
fall('M2-01', 'rot, dann gruene Wiederholung, danach umgeschaltet', 'M2',
  [start, run(1, 'TB Gate A', 'failure', 60), run(2, 'TB Gate A', 'success', 400), ...abrufe(0, 420, 5, ALT), ...abrufe(425, 900, 5, NEU)], 'UMGESCHALTET_NACH_WIEDERHOLUNG');
fall('M2-02', 'rot, gruene Wiederholung, nicht umgeschaltet', 'M2',
  [start, run(1, 'TB Gate A', 'failure', 60), run(2, 'TB Gate A', 'success', 400), ...abrufe(0, 900, 5, ALT)], 'NICHT_UMGESCHALTET');
fall('M2-03', 'Umschaltung vor der gruenen Wiederholung', 'M2',
  [start, run(1, 'TB Gate A', 'failure', 60), run(2, 'TB Gate A', 'success', 400), ...abrufe(0, 100, 5, ALT), ...abrufe(105, 900, 5, NEU)], 'UMGESCHALTET_VOR_WIEDERHOLUNG');
fall('M2-04', 'kein Wiederholungslauf -> NICHT_AUSWERTBAR', 'M2',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 900, 5, ALT)], 'NICHT_AUSWERTBAR');
fall('M2-05', 'zwei gruene Laeufe ohne Rot -> NICHT_AUSWERTBAR', 'M2',
  [start, run(1, 'TB Gate A', 'success', 60), run(2, 'TB Gate A', 'success', 400), ...abrufe(0, 900, 5, ALT)], 'NICHT_AUSWERTBAR');
fall('M2-06', 'Abbruch (timed_out), dann gruen, danach umgeschaltet', 'M2',
  [start, run(1, 'TB Gate B', 'timed_out', 200), run(2, 'TB Gate B', 'success', 500), ...abrufe(0, 520, 5, ALT), ...abrufe(525, 900, 5, NEU)], 'UMGESCHALTET_NACH_WIEDERHOLUNG');

// ---- M3
const fremd = (s, ctx = 'TB Gate A', typ = 'User') => ({ art: 'commitstatus', id: 9, context: ctx, state: 'success', created_at: t(s), creator: 'owner', creatorTyp: typ });
fall('M3-01', 'Fremdstatus, echte Pruefung rot, umgeschaltet -> ANERKANNT', 'M3',
  [start, run(1, 'TB Gate A', 'failure', 60), fremd(120), ...abrufe(0, 125, 5, ALT), ...abrufe(130, 900, 5, NEU)], 'FREMDSTATUS_ANERKANNT');
fall('M3-02', 'Fremdstatus, nicht umgeschaltet, 780 s -> NICHT_ANERKANNT', 'M3',
  [start, run(1, 'TB Gate A', 'failure', 60), fremd(120), ...abrufe(0, 900, 5, ALT)], 'FREMDSTATUS_NICHT_ANERKANNT');
fall('M3-03', 'echte Pruefung wurde auch gruen -> NICHT_AUSWERTBAR', 'M3',
  [start, run(1, 'TB Gate A', 'success', 60), fremd(120), ...abrufe(0, 900, 5, NEU)], 'NICHT_AUSWERTBAR');
fall('M3-04', 'kein Fremdstatus -> NICHT_AUSWERTBAR', 'M3',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 900, 5, ALT)], 'NICHT_AUSWERTBAR');
fall('M3-05', 'Status von einem Bot zaehlt nicht als fremd -> NICHT_AUSWERTBAR', 'M3',
  [start, run(1, 'TB Gate A', 'failure', 60), fremd(120, 'TB Gate A', 'Bot'), ...abrufe(0, 900, 5, ALT)], 'NICHT_AUSWERTBAR');
fall('M3-06', 'Umschaltung schon vor dem Fremdstatus -> NICHT_AUSWERTBAR', 'M3',
  [start, run(1, 'TB Gate A', 'failure', 60), fremd(500), ...abrufe(0, 100, 5, ALT), ...abrufe(105, 900, 5, NEU)], 'NICHT_AUSWERTBAR');
fall('M3-07', 'zu kurz nach dem Fremdstatus beobachtet -> NICHT_AUSWERTBAR', 'M3',
  [start, run(1, 'TB Gate A', 'failure', 60), fremd(800), ...abrufe(0, 900, 5, ALT)], 'NICHT_AUSWERTBAR');

// ---- M4
fall('M4-01', 'alter Stand noch nach Pruefungsende -> NACH_PRUEFUNGSENDE', 'M4',
  [start, run(1, 'TB Gate A', 'success', 300), run(2, 'TB Gate B', 'success', 310), ...abrufe(0, 315, 5, ALT), ...abrufe(320, 400, 5, NEU)], 'NACH_PRUEFUNGSENDE');
fall('M4-02', 'Pruefungsende im Fenster -> FENSTER_UEBERLAPPT', 'M4',
  [start, run(1, 'TB Gate A', 'success', 300), run(2, 'TB Gate B', 'success', 312), ...abrufe(0, 310, 5, ALT), ...abrufe(315, 400, 5, NEU)], 'FENSTER_UEBERLAPPT');
fall('M4-03', 'neu vor Pruefungsende -> VOR_PRUEFUNGSENDE', 'M4',
  [start, run(1, 'TB Gate A', 'success', 300), run(2, 'TB Gate B', 'success', 310), ...abrufe(0, 200, 5, ALT), ...abrufe(205, 400, 5, NEU)], 'VOR_PRUEFUNGSENDE');
fall('M4-04', 'eine Pflichtpruefung nie gruen -> NICHT_AUSWERTBAR', 'M4',
  [start, run(1, 'TB Gate A', 'success', 300), ...abrufe(0, 315, 5, ALT), ...abrufe(320, 400, 5, NEU)], 'NICHT_AUSWERTBAR');
fall('M4-05', 'Wechsel nicht beobachtet -> NICHT_AUSWERTBAR', 'M4',
  [start, run(1, 'TB Gate A', 'success', 300), run(2, 'TB Gate B', 'success', 310), ...abrufe(0, 400, 5, ALT)], 'NICHT_AUSWERTBAR');

// ---- M5
fall('M5-01', 'roter Stand nach Aktion ausgeliefert -> WEG_UMGEHT_PRUEFUNG', 'M5',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 200, 5, ALT), ...abrufe(205, 900, 5, NEU)], 'WEG_UMGEHT_PRUEFUNG', { aktionZeit: t(200) });
fall('M5-02', 'roter Stand nach Aktion nicht ausgeliefert -> WEG_GEHALTEN', 'M5',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 900, 5, ALT)], 'WEG_GEHALTEN', { aktionZeit: t(200) });
fall('M5-03', 'ohne Aktionszeit -> NICHT_AUSWERTBAR', 'M5',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 900, 5, ALT)], 'NICHT_AUSWERTBAR');
fall('M5-04', 'Ziel-Stand nicht rot -> NICHT_AUSWERTBAR', 'M5',
  [start, run(1, 'TB Gate A', 'success', 60), ...abrufe(0, 900, 5, ALT)], 'NICHT_AUSWERTBAR', { aktionZeit: t(200) });
fall('M5-05', 'roter Stand schon vor der Aktion live -> NICHT_AUSWERTBAR', 'M5',
  [start, run(1, 'TB Gate A', 'failure', 60), ...abrufe(0, 100, 5, ALT), ...abrufe(105, 900, 5, NEU)], 'NICHT_AUSWERTBAR', { aktionZeit: t(200) });

// ---- M6
{
  const URL2 = 'https://release-gate-testbed-git-main-team.vercel.app/';
  const r = auswerten({ ereignisse: [start, ...abrufe(0, 30, 5, NEU), { art: 'abruf', lokal: t(1), url: URL2, status: 302, ort: 'vercel.com' }], fall: 'M6', shaNeu: NEU, shaAlt: ALT, pflicht: PFLICHT });
  melde('M6-01', 'oeffentliche Adresse mit Inhalt erkannt', r.adressen?.[URL1]?.code === 'OEFFENTLICH_MIT_INHALT', r.adressen?.[URL1]?.code);
  melde('M6-02', 'geschuetzte Adresse ohne Inhalt erkannt', r.adressen?.[URL2]?.code === 'GESCHUETZT_OHNE_INHALT', r.adressen?.[URL2]?.code);
}

// ---- Sperren (synthetische Sperrliste; die echte steht nur lokal)
const sperre = (id, text, fn, erwartetGesperrt) => {
  let gesperrt = false;
  try { fn(); } catch (e) { gesperrt = e instanceof Abbruch; }
  melde(id, text, gesperrt === erwartetGesperrt);
};
const kTest = {
  vercelProjekt: 'release-gate-testbed', pflichtpruefungen: PFLICHT, lokal: true,
  githubRepo: 'tester/release-gate-testbed', produktionsAdresse: URL1,
  verboten: { repos: ['beispiel/produktion'], hostGenau: ['prod-app.vercel.app', 'produktion.example.com'], hostPraefix: ['prod-app-'], hostEnthaelt: ['supabase.co'], imInhalt: [] },
};
sperre('S-01', 'gesperrtes Repository wird abgelehnt', () => pruefeRepo(kTest, 'beispiel/produktion'), true);
sperre('S-02', 'fremdes Repository wird abgelehnt', () => pruefeRepo(kTest, 'tester/anderes'), true);
sperre('S-03', 'konfiguriertes Testrepository wird angenommen', () => pruefeRepo(kTest, 'tester/release-gate-testbed'), false);
sperre('S-04', 'gesperrte Produktionsadresse wird abgelehnt', () => pruefeUrl(kTest, 'https://prod-app.vercel.app/'), true);
sperre('S-05', 'gesperrte Deployment-Adresse (Praefix) wird abgelehnt', () => pruefeUrl(kTest, 'https://prod-app-abc123-team.vercel.app/'), true);
sperre('S-06', 'Supabase-Adresse wird abgelehnt', () => pruefeUrl(kTest, 'https://release-gate-testbed.supabase.co/'), true);
sperre('S-07', 'http wird abgelehnt', () => pruefeUrl(kTest, 'http://release-gate-testbed.vercel.app/'), true);
sperre('S-08', 'Testadresse wird angenommen', () => pruefeUrl(kTest, URL1), false);
sperre('S-09', 'Adresse eines anderen Projekts wird abgelehnt', () => pruefeUrl(kTest, 'https://andere-app.vercel.app/'), true);
sperre('S-10', 'gesperrte Domain wird abgelehnt', () => pruefeUrl(kTest, 'https://produktion.example.com/'), true);
sperre('S-11', 'Repository mit Platzhalter wird abgelehnt', () => pruefeRepo({ ...kTest, githubRepo: '<OWNER>/x' }, '<OWNER>/x'), true);
sperre('S-12', 'ohne lokale Datei ist kein Repository zulaessig', () => pruefeRepo({ ...kTest, lokal: false, githubRepo: null }, 'tester/release-gate-testbed'), true);

// ---- Zusatz: echte, nur lokal vorhandene Sperrliste (zaehlt nicht zur Mindestzahl)
const k = ladeKonfig();
let zusatz = 0;
if (k.lokal) {
  const kLokal = { ...k, githubRepo: 'tester/release-gate-testbed', produktionsAdresse: URL1 };
  let n = 0;
  for (const r of k.verboten.repos) { sperre(`L-${++n}`, 'lokal gesperrtes Repository wird abgelehnt', () => pruefeRepo(kLokal, r), true); }
  for (const h of k.verboten.hostGenau) { sperre(`L-${++n}`, 'lokal gesperrte Adresse wird abgelehnt', () => pruefeUrl(kLokal, `https://${h}/`), true); }
  for (const p of k.verboten.hostPraefix) { sperre(`L-${++n}`, 'lokal gesperrter Praefix wird abgelehnt', () => pruefeUrl(kLokal, `https://${p}x.vercel.app/`), true); }
  zusatz = n;
}

console.log(`\n${gelaufen} Faelle (davon ${zusatz} lokale Zusatzfaelle), ${gelaufen - fehler} bestanden, ${fehler} fehlgeschlagen`);
if (gelaufen - zusatz < MINDESTFAELLE) {
  console.log(`zu wenige Faelle (${gelaufen} < ${MINDESTFAELLE})`);
  process.exit(2);
}
process.exit(fehler === 0 ? 0 : 1);
