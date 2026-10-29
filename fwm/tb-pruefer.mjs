// FW-M im Testobjekt (synthetisch): Pruefstatus eines Commits gegen die
// beiden Pflichtpruefungen des Testobjekts. Fuer diese Messung eigenstaendig
// geschrieben; kein Code eines anderen Projekts.
//
//   node fwm/tb-pruefer.mjs --sha <SHA> --sicht voll|ohne-check-runs [--stichzeit <ISO>] [--json]
//   node fwm/tb-pruefer.mjs --selbsttest
//
// Regeln (Messaufbau FW-M):
// - Als Pflichtpruefung zaehlt nur ein Job eines Laufs von
//   .github/workflows/tb-gate.yml mit Ereignis push auf main zur selben SHA.
//   In Sicht "voll" muss check_run_url dieses Jobs auf genau den Check-Run
//   unter dem Pruefnamen zeigen, und der Check-Run muss von GitHub Actions
//   (App 15368) stammen. Jeder andere Check-Run unter einem Pruefnamen ist
//   FREMDQUELLE; ist die Bindung mangels vollstaendig gelesener Laeufe oder
//   Jobs nicht pruefbar, ist der Stand DATEN_UNVOLLSTAENDIG.
// - Ein Versuch zaehlt positiv nur, wenn er vor dem Stichzeitpunkt endete
//   (Sekunden, echt kleiner). Ordnung: Laeufe nach created_at, im Lauf nach
//   run_attempt; Gleichstand ist DATEN_UNVOLLSTAENDIG.
// - Erster zutreffender Code: COMMIT_UNBEKANNT, FREMDQUELLE, NICHT_AUF_MAIN,
//   ROT, DATEN_UNVOLLSTAENDIG, FEHLT, AUSSTEHEND, NACH_WIEDERHOLUNG,
//   FREIGABEFAEHIG. Exit 0 nur bei FREIGABEFAEHIG, 2 bei
//   DATEN_UNVOLLSTAENDIG, sonst 1.
// Nur lesend; das Token kommt aus GH_TOKEN und wird nie ausgegeben.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const KONFIG = JSON.parse(readFileSync(join(WURZEL, 'testbed.config.json'), 'utf8'));
export const PRUEFNAMEN = Object.freeze([...KONFIG.pflichtpruefungen]);
export const GATE_PFAD = '.github/workflows/tb-gate.yml';
export const ACTIONS_APP = 15368;
export const HINWEIS = 'Kein vollständiger Release-Sicherheitsnachweis (Sicht ohne Check-Runs)';
const PRO_SEITE = 100;
const GRENZE_SUCHE = 1000;
const GRENZE_SUITEN = 1000;
const STATUS_WERTE = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']);
const ERGEBNIS_WERTE = new Set(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required']);

export const exitCode = (code) => (code === 'FREIGABEFAEHIG' ? 0 : code === 'DATEN_UNVOLLSTAENDIG' ? 2 : 1);
const istSha = (x) => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x);
const sekunde = (t) => {
  const ms = typeof t === 'string' ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
};
const gelesen = (a) => a !== null && typeof a === 'object' && a.status === 200 && a.body !== null && typeof a.body === 'object';
const ganz = (x) => Number.isSafeInteger(x) && x >= 0;
const zustandOk = (x) => STATUS_WERTE.has(x.status)
  && (x.conclusion === null || ERGEBNIS_WERTE.has(x.conclusion))
  && ((x.status === 'completed') === (x.conclusion !== null))
  && (x.status !== 'completed' || Number.isFinite(sekunde(x.completed_at)));

// Seitenweise Liste mit total_count; liefert die Eintraege und ob sie vollstaendig sind.
function seitenListe(seiten, feld, name, fehlt) {
  const r = { eintraege: [], gesamt: null, ganz: true };
  const loch = (t) => { r.ganz = false; fehlt(`${name}: ${t}`); };
  if (!Array.isArray(seiten) || seiten.length === 0) { loch('nicht gelesen'); return r; }
  seiten.forEach((s, i) => {
    if (!gelesen(s) || !Array.isArray(s.body[feld]) || !ganz(s.body.total_count)) { loch(`Seite ${i + 1} nicht lesbar`); return; }
    if (r.gesamt === null) r.gesamt = s.body.total_count;
    else if (r.gesamt !== s.body.total_count) loch(`Gesamtzahl wechselt auf Seite ${i + 1}`);
    if (i < seiten.length - 1 && s.body[feld].length !== PRO_SEITE) loch(`Seite ${i + 1} vor der letzten nicht voll`);
    r.eintraege.push(...s.body[feld]);
  });
  if (r.gesamt !== null && r.eintraege.length !== r.gesamt) loch(`${r.eintraege.length} von ${r.gesamt} gelesen`);
  return r;
}

export function bewerte(roh) {
  const luecken = [];
  const fehlt = (t) => luecken.push(t);
  let ordnungUnklar = false;
  const unklar = (t) => { ordnungUnklar = true; fehlt(`Ordnung nicht eindeutig: ${t}`); };
  if (roh === null || typeof roh !== 'object') return { code: 'DATEN_UNVOLLSTAENDIG', gruende: ['keine Daten'], belege: {} };
  const sha = istSha(roh.sha) ? roh.sha : null;
  if (!sha) fehlt('SHA ungueltig');
  const sicht = ['voll', 'ohne-check-runs'].includes(roh.sicht) ? roh.sicht : null;
  if (!sicht) fehlt('Sicht ungueltig');
  const stich = sekunde(roh.stichzeit);
  if (!Number.isFinite(stich)) fehlt('Stichzeitpunkt ungueltig');
  if (!['vorgabe', 'abfrage'].includes(roh.herkunft)) fehlt('Herkunft des Stichzeitpunkts fehlt');
  const a = roh.antworten ?? {};

  // Commit und Lage zu main
  const repoLesbar = gelesen(a.repo);
  if (!repoLesbar) fehlt('Repository nicht lesbar');
  const unbekannt = repoLesbar && sha !== null && a.commit?.status === 404;
  if (!unbekannt && !(gelesen(a.commit) && a.commit.body.sha === sha)) fehlt('Commit nicht eindeutig gelesen');
  let aufMain = null;
  const mainSha = gelesen(a.main) && a.main.body.name === 'main' && istSha(a.main.body.commit?.sha) ? a.main.body.commit.sha : null;
  if (!mainSha) fehlt('main nicht gelesen');
  else if (!gelesen(a.vergleich) || a.vergleich.body.base_commit?.sha !== mainSha || !Array.isArray(a.vergleich.body.commits) || !ganz(a.vergleich.body.total_commits)) fehlt('Vergleich mit main nicht auswertbar');
  else if (a.vergleich.body.total_commits === 0 && a.vergleich.body.commits.length === 0) aufMain = true;
  else if (a.vergleich.body.total_commits > 0 && a.vergleich.body.commits.length > 0) aufMain = false;
  else fehlt('Vergleich mit main widerspruechlich');

  // Laeufe (Hauptquelle)
  const vorLauf = luecken.length;
  const laeufe = seitenListe(a.laeufe, 'workflow_runs', 'Laufsuche', fehlt);
  if (laeufe.gesamt !== null && laeufe.gesamt >= GRENZE_SUCHE) fehlt(`Laufsuche mit ${laeufe.gesamt} Treffern (Grenze ${GRENZE_SUCHE})`);
  const pflicht = [];
  const nichtGezaehlt = [];
  const laufIds = new Set();
  for (const l of laeufe.eintraege) {
    if (!l || !ganz(l.id) || typeof l.path !== 'string' || typeof l.event !== 'string' || !Number.isFinite(sekunde(l.created_at)) || !ganz(l.run_attempt)) { fehlt('Lauf mit unerwartetem Format'); continue; }
    if (laufIds.has(l.id)) { fehlt(`Lauf ${l.id} doppelt`); continue; }
    laufIds.add(l.id);
    if (l.head_sha !== sha) { fehlt(`Lauf ${l.id} mit fremder SHA`); continue; }
    if (l.path === GATE_PFAD && l.event === 'push' && l.head_branch === 'main') pflicht.push(l);
    else nichtGezaehlt.push({ lauf: l.id, pfad: l.path, ereignis: l.event, zweig: l.head_branch });
  }
  pflicht.sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
  for (let i = 1; i < pflicht.length; i++) {
    if (Date.parse(pflicht[i].created_at) === Date.parse(pflicht[i - 1].created_at)) unklar(`Laeufe ${pflicht[i - 1].id} und ${pflicht[i].id} mit gleichem created_at`);
  }

  // Jobs aller Versuche je Pflichtlauf, in der Ordnung der Laeufe
  const versuche = Object.fromEntries(PRUEFNAMEN.map((n) => [n, []]));
  const bindung = new Map();
  for (const l of pflicht) {
    const jobs = seitenListe(a.jobs?.[String(l.id)], 'jobs', `Jobs von Lauf ${l.id}`, fehlt);
    const jeName = new Map();
    for (const j of jobs.eintraege) {
      if (!j || !ganz(j.id) || j.run_id !== l.id || j.head_sha !== sha || !ganz(j.run_attempt) || typeof j.name !== 'string' || !zustandOk(j) || typeof j.check_run_url !== 'string') { fehlt(`Job in Lauf ${l.id} mit unerwartetem Format`); continue; }
      if (!PRUEFNAMEN.includes(j.name)) continue;
      const liste = jeName.get(j.name) ?? [];
      if (liste.some((x) => x.run_attempt === j.run_attempt)) unklar(`${j.name}: zwei Jobs in Versuch ${j.run_attempt} von Lauf ${l.id}`);
      liste.push(j);
      jeName.set(j.name, liste);
      const m = /\/check-runs\/(\d+)$/.exec(j.check_run_url);
      if (m) bindung.set(Number(m[1]), { name: j.name, job: j.id }); else fehlt(`Job ${j.id} ohne Check-Run-Kennung`);
    }
    for (const n of PRUEFNAMEN) {
      for (const j of (jeName.get(n) ?? []).sort((x, y) => x.run_attempt - y.run_attempt)) {
        versuche[n].push({ lauf: l.id, versuch: j.run_attempt, job: j.id, status: j.status, ergebnis: j.conclusion, ende: j.completed_at ?? null, vorStich: j.status === 'completed' && sekunde(j.completed_at) < stich });
      }
    }
  }
  const laufdatenGanz = luecken.length === vorLauf;

  // Sicht voll: Check-Runs gegen die Bindung
  const fremd = [];
  if (sicht === 'voll') {
    const suiten = gelesen(a.suiten) ? a.suiten.body.total_count : null;
    if (!ganz(suiten)) fehlt('Check-Suites nicht gelesen');
    else if (suiten > GRENZE_SUITEN) fehlt(`${suiten} Check-Suites (Grenze ${GRENZE_SUITEN})`);
    const runs = seitenListe(a.checkRuns, 'check_runs', 'Check-Runs', fehlt);
    const gesehen = new Map();
    for (const c of runs.eintraege) {
      if (!c || !ganz(c.id) || typeof c.name !== 'string') { fehlt('Check-Run mit unerwartetem Format'); continue; }
      gesehen.set(c.id, c);
      if (!PRUEFNAMEN.includes(c.name)) continue;
      const app = c.app && ganz(c.app.id) ? c.app.id : null;
      if (c.head_sha !== sha) { fehlt(`Check-Run ${c.id} mit fremder SHA`); continue; }
      if (app !== ACTIONS_APP) fremd.push({ id: c.id, name: c.name, app, grund: 'nicht von GitHub Actions' });
      else if (!bindung.has(c.id)) {
        if (laufdatenGanz) fremd.push({ id: c.id, name: c.name, app, grund: 'ohne zugehoerigen Pflicht-Job' });
        else fehlt(`Check-Run ${c.id} nicht zuordenbar (Laeufe oder Jobs unvollstaendig)`);
      } else if (bindung.get(c.id).name !== c.name) fehlt(`Check-Run ${c.id} passt nicht zu seinem Job`);
    }
    if (runs.ganz) for (const [id, b] of bindung) if (!gesehen.has(id)) fehlt(`Check-Run ${id} des Jobs ${b.job} fehlt`);
  }

  // Commit-Status
  const statusSeiten = Array.isArray(a.status) ? a.status : [];
  if (statusSeiten.length === 0) fehlt('Commit-Status nicht gelesen');
  const fremdStatus = [];
  statusSeiten.forEach((s, i) => {
    if (!s || s.status !== 200 || !Array.isArray(s.body)) { fehlt(`Commit-Status Seite ${i + 1} nicht lesbar`); return; }
    if (i === statusSeiten.length - 1 && s.body.length >= PRO_SEITE) fehlt('Commit-Status: letzte Seite voll');
    for (const e of s.body) if (e && PRUEFNAMEN.includes(e.context)) fremdStatus.push({ context: e.context, state: e.state, zeit: e.created_at ?? null });
  });

  // Bewertung
  const rot = [];
  for (const n of PRUEFNAMEN) {
    const v = versuche[n];
    const vor = v.filter((x) => x.vorStich);
    if (!ordnungUnklar && vor.length && vor[vor.length - 1].ergebnis !== 'success') rot.push(`${n}: letzter Versuch vor dem Stichzeitpunkt ${vor[vor.length - 1].ergebnis}`);
    for (const x of v) if (x.status === 'completed' && !x.vorStich && x.ergebnis !== 'success') rot.push(`${n}: nach dem Stichzeitpunkt ${x.ergebnis}`);
  }
  const ohneJob = PRUEFNAMEN.filter((n) => versuche[n].length === 0);
  const offen = PRUEFNAMEN.filter((n) => versuche[n].some((x) => !x.vorStich));
  const wiederholt = PRUEFNAMEN.filter((n) => {
    const v = versuche[n];
    return v.length > 1 && v[v.length - 1].ergebnis === 'success' && v.slice(0, -1).some((x) => x.status === 'completed' && x.ergebnis !== 'success');
  });
  const belege = {
    sicht, stichzeit: roh.stichzeit ?? null, herkunft: roh.herkunft ?? null, hinweis: sicht === 'ohne-check-runs' ? HINWEIS : null,
    pflichtlaeufe: pflicht.map((l) => ({ id: l.id, erstellt: l.created_at, versuche: l.run_attempt })),
    nichtGezaehlt, versuche, nachWiederholung: wiederholt, fremdeCheckRuns: fremd, fremdeStatus: fremdStatus, luecken,
  };
  const zusatz = wiederholt.length ? [`NACH_WIEDERHOLUNG zusaetzlich: ${wiederholt.join(', ')}`] : [];
  const fertig = (code, gruende) => ({ code, gruende, belege });
  if (unbekannt) return fertig('COMMIT_UNBEKANNT', ['Commit im Repository nicht auffindbar']);
  if (fremd.length || fremdStatus.length) return fertig('FREMDQUELLE', [...fremdStatus.map((s) => `Commit-Status unter ${s.context}`), ...fremd.map((c) => `Check-Run ${c.id} ${c.name} (App ${c.app}): ${c.grund}`)]);
  if (aufMain === false) return fertig('NICHT_AUF_MAIN', ['Commit liegt nicht auf main']);
  if (rot.length) return fertig('ROT', rot);
  if (luecken.length || aufMain === null) return fertig('DATEN_UNVOLLSTAENDIG', luecken);
  if (ohneJob.length) return fertig('FEHLT', [`kein Pflicht-Job zu: ${ohneJob.join(', ')}`, ...zusatz]);
  if (offen.length) return fertig('AUSSTEHEND', [`zum Stichzeitpunkt nicht abgeschlossen: ${offen.join(', ')}`, ...zusatz]);
  if (wiederholt.length) return fertig('NACH_WIEDERHOLUNG', [`frueher nicht success: ${wiederholt.join(', ')}`]);
  return fertig('FREIGABEFAEHIG', ['alle Pflichtpruefungen vor dem Stichzeitpunkt success aus tb-gate.yml (push, main)']);
}

// Liest die Antworten der GitHub-Schnittstelle. abruf(pfad) liefert { status, body } und wirft nie.
export async function lies({ repo, sha, sicht, stichzeit, herkunft, abruf }) {
  const b = `/repos/${repo}`;
  const seiten = async (pfad, feld) => {
    const s = [];
    for (let n = 1; n <= 20; n++) {
      const x = await abruf(`${pfad}${pfad.includes('?') ? '&' : '?'}per_page=${PRO_SEITE}&page=${n}`);
      s.push(x);
      if (!gelesen(x) || !ganz(x.body.total_count) || n * PRO_SEITE >= x.body.total_count || (feld === 'workflow_runs' && x.body.total_count >= GRENZE_SUCHE)) break;
    }
    return s;
  };
  const antworten = { repo: await abruf(b), commit: await abruf(`${b}/commits/${sha}`), main: await abruf(`${b}/branches/main`) };
  const mainSha = gelesen(antworten.main) ? antworten.main.body.commit?.sha : null;
  antworten.vergleich = istSha(mainSha) ? await abruf(`${b}/compare/${mainSha}...${sha}?per_page=1`) : { status: 0, body: null };
  antworten.laeufe = await seiten(`${b}/actions/workflows/tb-gate.yml/runs?head_sha=${sha}&event=push&branch=main`, 'workflow_runs');
  antworten.jobs = {};
  for (const s of antworten.laeufe) {
    if (!gelesen(s) || !Array.isArray(s.body.workflow_runs)) continue;
    for (const l of s.body.workflow_runs) if (l && ganz(l.id)) antworten.jobs[String(l.id)] = await seiten(`${b}/actions/runs/${l.id}/jobs?filter=all`, 'jobs');
  }
  if (sicht === 'voll') {
    antworten.suiten = await abruf(`${b}/commits/${sha}/check-suites?per_page=1`);
    antworten.checkRuns = await seiten(`${b}/commits/${sha}/check-runs?filter=all`, 'check_runs');
  }
  antworten.status = [];
  for (let n = 1; n <= 20; n++) {
    const x = await abruf(`${b}/commits/${sha}/statuses?per_page=${PRO_SEITE}&page=${n}`);
    antworten.status.push(x);
    if (!x || x.status !== 200 || !Array.isArray(x.body) || x.body.length < PRO_SEITE) break;
  }
  return { sha, sicht, stichzeit, herkunft, antworten };
}

export const githubAbruf = (token) => async (pfad) => {
  try {
    const r = await fetch(`https://api.github.com${pfad}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'tb-fwm-pruefer' },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  } catch {
    return { status: 0, body: null };
  }
};

// ---------------------------------------------------------------------------
// Selbsttest ohne Netz
const S = 'a'.repeat(40);
const M = 'b'.repeat(40);
const [GA, GB] = PRUEFNAMEN;
const T0 = '2026-10-29T12:00:00Z';
const VOR = '2026-10-29T11:50:00Z';
const NACH = '2026-10-29T12:00:01Z';
const ok200 = (body) => ({ status: 200, body });
const lauf = (id, x = {}) => ({ id, path: GATE_PFAD, event: 'push', head_branch: 'main', head_sha: S, created_at: '2026-10-29T11:40:00Z', run_attempt: 1, ...x });
const job = (id, laufId, name, x = {}) => ({ id, run_id: laufId, head_sha: S, run_attempt: 1, name, status: 'completed', conclusion: 'success', completed_at: VOR, check_run_url: `https://api.github.com/repos/t/t/check-runs/${id}`, ...x });
const cr = (j, app = ACTIONS_APP) => ({ id: j.id, name: j.name, head_sha: S, app: app === null ? null : { id: app } });
const fall = ({ laeufe = [lauf(1)], jobs = { 1: [job(11, 1, GA), job(12, 1, GB)] }, sicht = 'voll', extraRuns = [], status = [], runsSeiten, laufGesamt, stich = T0, vergleich = 0, commit = 200 } = {}) => {
  const alleJobs = Object.values(jobs).flat();
  return {
    sha: S, sicht, stichzeit: stich, herkunft: 'vorgabe',
    antworten: {
      repo: ok200({}), commit: commit === 200 ? ok200({ sha: S }) : { status: commit, body: null },
      main: ok200({ name: 'main', commit: { sha: M } }),
      vergleich: ok200({ base_commit: { sha: M }, total_commits: vergleich, commits: vergleich ? [{}] : [] }),
      laeufe: [ok200({ total_count: laufGesamt ?? laeufe.length, workflow_runs: laeufe })],
      jobs: Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, Array.isArray(v) ? [ok200({ total_count: v.length, jobs: v })] : v])),
      suiten: ok200({ total_count: 1 }),
      checkRuns: runsSeiten ?? [ok200({ total_count: alleJobs.length + extraRuns.length, check_runs: [...alleJobs.map((j) => cr(j)), ...extraRuns] })],
      status: [{ status: 200, body: status }],
    },
  };
};
export const FAELLE = [
  ['T01', 'FREIGABEFAEHIG', fall()],
  ['T02', 'FREIGABEFAEHIG', fall({ sicht: 'ohne-check-runs' })],
  ['T03', 'FREMDQUELLE', fall({ status: [{ context: GA, state: 'success' }] })],
  ['T04', 'FREMDQUELLE', fall({ extraRuns: [{ id: 99, name: GA, head_sha: S, app: { id: ACTIONS_APP } }] })],
  ['T05', 'FREMDQUELLE', fall({ extraRuns: [{ id: 98, name: GB, head_sha: S, app: { id: 4242 } }] })],
  ['T06', 'NICHT_AUF_MAIN', fall({ vergleich: 2 })],
  ['T07', 'ROT', fall({ jobs: { 1: [job(11, 1, GA), job(12, 1, GB), job(13, 1, GA, { run_attempt: 2, conclusion: 'failure', completed_at: NACH })] } })],
  ['T08', 'DATEN_UNVOLLSTAENDIG', fall({ laufGesamt: 1000 })],
  ['T09', 'FEHLT', fall({ jobs: { 1: [job(11, 1, GA)] } })],
  ['T10', 'AUSSTEHEND', fall({ jobs: { 1: [job(11, 1, GA), job(12, 1, GB, { completed_at: T0 })] } })],
  ['T11', 'NACH_WIEDERHOLUNG', fall({ laeufe: [lauf(1, { run_attempt: 2 })], jobs: { 1: [job(10, 1, GA, { conclusion: 'failure' }), job(11, 1, GA, { run_attempt: 2 }), job(12, 1, GB)] } })],
  ['T12', 'COMMIT_UNBEKANNT', fall({ commit: 404 })],
  ['T13', 'DATEN_UNVOLLSTAENDIG', fall({ runsSeiten: [{ status: 500, body: null }] })],
  ['T14', 'DATEN_UNVOLLSTAENDIG', fall({ jobs: { 1: [{ status: 500, body: null }] }, extraRuns: [{ id: 99, name: GA, head_sha: S, app: { id: ACTIONS_APP } }] })],
  ['T15', 'FEHLT', fall({ laeufe: [lauf(1, { event: 'pull_request', head_branch: 'fwm/x' })], jobs: {} , sicht: 'ohne-check-runs' })],
  ['T16', 'DATEN_UNVOLLSTAENDIG', fall({ laeufe: [lauf(1), lauf(2)], jobs: { 1: [job(11, 1, GA), job(12, 1, GB)], 2: [job(21, 2, GA), job(22, 2, GB)] } })],
];

function selbsttest() {
  let fehler = 0;
  for (const [id, soll, daten] of FAELLE) {
    const ist = bewerte(daten).code;
    if (ist !== soll) fehler++;
    console.log(`${ist === soll ? 'ok  ' : 'FAIL'}  ${id}  ${soll}${ist === soll ? '' : `  [ist ${ist}]`}`);
  }
  const ohneFall = ['COMMIT_UNBEKANNT', 'FREMDQUELLE', 'NICHT_AUF_MAIN', 'ROT', 'DATEN_UNVOLLSTAENDIG', 'FEHLT', 'AUSSTEHEND', 'NACH_WIEDERHOLUNG', 'FREIGABEFAEHIG'].filter((c) => !FAELLE.some((f) => f[1] === c));
  if (ohneFall.length) { fehler++; console.log(`FAIL  ohne Fall: ${ohneFall.join(', ')}`); }
  console.log(`\n${FAELLE.length} Faelle, ${fehler} Fehler`);
  process.exit(fehler ? 1 : 0);
}

async function haupt(argv) {
  if (argv.length === 1 && argv[0] === '--selbsttest') return selbsttest();
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--json') { o.json = true; continue; }
    if (['--sha', '--sicht', '--stichzeit'].includes(k) && i + 1 < argv.length && !(k in o)) { o[k] = argv[++i]; continue; }
    console.error('Aufruf: node fwm/tb-pruefer.mjs --sha <SHA> --sicht voll|ohne-check-runs [--stichzeit <ISO>] [--json] | --selbsttest');
    process.exit(1);
  }
  if (!istSha(o['--sha']) || !['voll', 'ohne-check-runs'].includes(o['--sicht']) || ('--stichzeit' in o && !Number.isFinite(Date.parse(o['--stichzeit'])))) {
    console.error('Aufruf: node fwm/tb-pruefer.mjs --sha <SHA> --sicht voll|ohne-check-runs [--stichzeit <ISO>] [--json] | --selbsttest');
    process.exit(1);
  }
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !token) { console.error('GITHUB_REPOSITORY oder GH_TOKEN fehlt'); process.exit(2); }
  const stichzeit = o['--stichzeit'] ?? new Date().toISOString();
  const herkunft = '--stichzeit' in o ? 'vorgabe' : 'abfrage';
  const r = bewerte(await lies({ repo, sha: o['--sha'], sicht: o['--sicht'], stichzeit, herkunft, abruf: githubAbruf(token) }));
  if (o.json) console.log(JSON.stringify({ sha: o['--sha'], ...r }, null, 2));
  else {
    console.log(`PRUEFER_CODE=${r.code}`);
    for (const g of r.gruende) console.log(`  ${g}`);
    console.log(`Stichzeitpunkt ${stichzeit} (${herkunft}), Sicht ${o['--sicht']}${r.belege.hinweis ? `; ${r.belege.hinweis}` : ''}`);
  }
  process.exit(exitCode(r.code));
}

// Nur als eigenes Programm starten; beim Import durch die Testwache bleibt es still.
if (/tb-pruefer\.mjs$/i.test(process.argv[1] ?? '')) {
  await haupt(process.argv.slice(2));
}
