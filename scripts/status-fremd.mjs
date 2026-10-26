// M3: setzt im TESTOBJEKT einen Commit-Status, der denselben Namen traegt
// wie eine Pflichtpruefung, aber nicht von GitHub Actions stammt. Nur nach
// ausdruecklicher Owner-Freigabe fuer M3 (Umgebungsvariable TB_FREIGABE_M3=ja).
//
//   TB_FREIGABE_M3=ja node scripts/status-fremd.mjs --sha <SHA> --context "TB Gate A" --state success
import { Abbruch, argumente, gh, hatPlatzhalter, iso, ladeKonfig, pruefeRepo } from './lib.mjs';

try {
  const a = argumente(process.argv.slice(2));
  const k = ladeKonfig();
  if (process.env.TB_FREIGABE_M3 !== 'ja') throw new Abbruch(2, 'keine Freigabe: TB_FREIGABE_M3=ja fehlt');
  if (hatPlatzhalter(k)) throw new Abbruch(2, 'Konfiguration enthaelt Platzhalter');
  const repo = pruefeRepo(k, k.githubRepo);
  if (!/^[0-9a-f]{40}$/.test(String(a.sha))) throw new Abbruch(2, '--sha muss eine volle Commit-SHA sein');
  if (!k.pflichtpruefungen.includes(a.context)) throw new Abbruch(2, `--context muss eine Pflichtpruefung des Testobjekts sein: ${k.pflichtpruefungen.join(', ')}`);
  if (!['success', 'failure', 'pending', 'error'].includes(a.state)) throw new Abbruch(2, '--state ungueltig');
  const antwort = gh(`repos/${repo}/statuses/${a.sha}`, ['-X', 'POST', '-f', `state=${a.state}`, '-f', `context=${a.context}`, '-f', 'description=M3 Fremdstatus Testobjekt']);
  console.log(JSON.stringify({ art: 'fremdstatus_gesetzt', lokal: iso(), repo, sha: a.sha, context: antwort.context, state: antwort.state, created_at: antwort.created_at, creator: antwort.creator?.login, id: antwort.id }));
} catch (e) {
  console.error(e instanceof Abbruch ? `${e.code === 1 ? 'VERSTOSS' : 'NICHT AUSFUEHRBAR'}: ${e.message}` : e);
  process.exit(e instanceof Abbruch ? e.code : 2);
}
