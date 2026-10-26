// Zeitlinie eines Messfalls: ausgelieferter Commit je Adresse und die
// serverseitigen Ereignisse bei GitHub (Check-Runs, Commit-Status,
// Deployments). Schreibt JSONL; liest von jeder Seite nur die Meta-Felder
// tb-commit/tb-build/tb-env und verwirft den Rest.
//
// Aufruf:
//   node scripts/zeitlinie.mjs --sha <volle SHA> --urls <url1,url2> --out belege/m1.jsonl
//        [--intervall 5] [--dauer 30] [--github-jeder 3] [--stopp-nach-neu 3]
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Abbruch, argumente, gh, hatPlatzhalter, iso, ladeKonfig, pruefeRepo, pruefeUrl } from './lib.mjs';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function abruf(url) {
  const start = Date.now();
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    const text = r.status === 200 ? await r.text() : '';
    const meta = (n) => text.match(new RegExp(`<meta name="${n}" content="([^"]*)"`))?.[1] ?? null;
    return {
      status: r.status,
      ort: r.headers.get('location') ? new URL(r.headers.get('location'), url).host : null,
      serverDatum: r.headers.get('date'),
      vercelId: r.headers.get('x-vercel-id'),
      cache: r.headers.get('x-vercel-cache'),
      alter: r.headers.get('age'),
      commit: meta('tb-commit'),
      build: meta('tb-build'),
      env: meta('tb-env'),
      dauerMs: Date.now() - start,
    };
  } catch (e) {
    return { status: null, fehler: String(e.message).slice(0, 200), dauerMs: Date.now() - start };
  }
}

function githubStand(repo, sha) {
  const runs = gh(`repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=all`).check_runs.map((c) => ({
    art: 'checkrun', id: c.id, name: c.name, app: c.app?.slug, status: c.status, conclusion: c.conclusion,
    started_at: c.started_at, completed_at: c.completed_at, suite: c.check_suite?.id,
  }));
  const statuses = gh(`repos/${repo}/commits/${sha}/statuses?per_page=100`).map((s) => ({
    art: 'commitstatus', id: s.id, context: s.context, state: s.state, description: s.description,
    created_at: s.created_at, creator: s.creator?.login, creatorTyp: s.creator?.type,
  }));
  const deployments = gh(`repos/${repo}/deployments?sha=${sha}&per_page=100`);
  const dep = [];
  for (const d of deployments) {
    dep.push({ art: 'deployment', id: d.id, environment: d.environment, created_at: d.created_at, creator: d.creator?.login });
    for (const s of gh(`repos/${repo}/deployments/${d.id}/statuses?per_page=100`)) {
      dep.push({ art: 'deploymentstatus', id: s.id, deployment: d.id, state: s.state, description: s.description, environment_url: s.environment_url, created_at: s.created_at });
    }
  }
  return [...runs, ...statuses, ...dep];
}

async function main() {
  const a = argumente(process.argv.slice(2));
  const k = ladeKonfig();
  if (hatPlatzhalter(k)) throw new Abbruch(2, 'Konfiguration enthaelt Platzhalter – erst nach Owner-Freigabe eintragen');
  const repo = pruefeRepo(k, k.githubRepo);
  if (!/^[0-9a-f]{40}$/.test(String(a.sha))) throw new Abbruch(2, '--sha muss eine volle Commit-SHA sein');
  const urls = String(a.urls || k.produktionsAdresse).split(',').map((u) => pruefeUrl(k, u.trim()));
  if (!a.out) throw new Abbruch(2, '--out fehlt');
  const intervall = Math.max(2, Number(a.intervall ?? 5));
  const dauerMin = Math.min(60, Number(a.dauer ?? 30));
  const githubJeder = Math.max(1, Number(a['github-jeder'] ?? 3));
  const stoppNachNeu = a['stopp-nach-neu'] ? Number(a['stopp-nach-neu']) : null;
  if (existsSync(a.out)) throw new Abbruch(2, `${a.out} existiert bereits – Belege werden nie ueberschrieben`);
  mkdirSync(dirname(a.out), { recursive: true });
  const schreib = (o) => appendFileSync(a.out, JSON.stringify(o) + '\n');
  schreib({ art: 'start', lokal: iso(), repo, sha: a.sha, urls, intervall, dauerMin, githubJeder });

  const gesehen = new Map();
  let neuInFolge = 0;
  const ende = Date.now() + dauerMin * 60000;
  for (let n = 1; Date.now() < ende; n++) {
    const lokal = iso();
    for (const url of urls) {
      const r = await abruf(url);
      schreib({ art: 'abruf', n, lokal, url, ...r });
      if (url === urls[0]) neuInFolge = r.commit === a.sha ? neuInFolge + 1 : 0;
    }
    if (n % githubJeder === 1 || githubJeder === 1) {
      try {
        for (const e of githubStand(repo, a.sha)) {
          const schluessel = `${e.art}:${e.id}:${e.status ?? ''}:${e.conclusion ?? ''}:${e.state ?? ''}`;
          if (!gesehen.has(schluessel)) {
            gesehen.set(schluessel, lokal);
            schreib({ ...e, erstmalsGesehenLokal: lokal });
          }
        }
      } catch (e) {
        schreib({ art: 'githubfehler', lokal, fehler: String(e.message).slice(0, 200) });
      }
    }
    if (stoppNachNeu && neuInFolge >= stoppNachNeu) {
      schreib({ art: 'ende', lokal: iso(), grund: `${stoppNachNeu} Abrufe in Folge mit neuer SHA` });
      return;
    }
    await pause(intervall * 1000);
  }
  schreib({ art: 'ende', lokal: iso(), grund: 'Hoechstdauer erreicht' });
}

main().catch((e) => {
  console.error(e instanceof Abbruch ? `${e.code === 1 ? 'VERSTOSS' : 'NICHT AUSFUEHRBAR'}: ${e.message}` : e);
  process.exit(e instanceof Abbruch ? e.code : 2);
});
