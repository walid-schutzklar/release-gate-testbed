// Offline-Pruefung vor jeder Veroeffentlichung und vor jedem Messfall.
// Exit 0 = getrennt und veroeffentlichungsfaehig, 1 = Verstoss, 2 = nicht pruefbar.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Abbruch, LOKAL_DATEI, WURZEL, hatPlatzhalter, ladeKonfig, pruefeRepo, pruefeUrl } from './lib.mjs';

const befunde = [];
const melde = (ok, text) => {
  befunde.push({ ok, text });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${text}`);
};
const git = (...a) => execFileSync('git', ['-C', WURZEL, ...a], { encoding: 'utf8' });
const rel = (p) => relative(WURZEL, p).replace(/\\/g, '/');

try {
  const k = ladeKonfig();
  melde(k.lokal, `${LOKAL_DATEI} vorhanden (Sperrliste und Projektwerte nur lokal)`);
  if (k.lokal && !hatPlatzhalter(k)) {
    pruefeRepo(k, k.githubRepo);
    pruefeUrl(k, k.produktionsAdresse);
    melde(true, `Repository und Produktionsadresse bestehen die Sperrliste`);
  } else {
    melde(true, 'Platzhalter vorhanden – Netzskripte gesperrt');
  }

  // Zu pruefende Dateien: bei Git alles, was veroeffentlicht wuerde; sonst der Baum.
  let dateien;
  const mitGit = existsSync(join(WURZEL, '.git'));
  if (mitGit) {
    const remotes = git('remote', '-v').toLowerCase();
    const fremd = k.verboten.repos.filter((r) => remotes.includes(`/${r.toLowerCase()}`) || remotes.includes(`:${r.toLowerCase()}`));
    melde(fremd.length === 0, `kein Remote auf ein gesperrtes Repository (${fremd.length} Treffer)`);
    let ignoriert = false;
    try { git('check-ignore', '-q', LOKAL_DATEI); ignoriert = true; } catch { ignoriert = false; }
    melde(ignoriert, `${LOKAL_DATEI} ist von Git ausgeschlossen`);
    const verfolgt = git('ls-files').split('\n').filter(Boolean);
    melde(!verfolgt.includes(LOKAL_DATEI), `${LOKAL_DATEI} ist nicht versioniert`);
    dateien = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean).map((p) => join(WURZEL, p));
  } else {
    dateien = [];
    const lauf = (d) => {
      for (const n of readdirSync(d)) {
        if (['.git', 'node_modules', 'belege', 'public', '.vercel'].includes(n)) continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) lauf(p); else if (n !== LOKAL_DATEI) dateien.push(p);
      }
    };
    lauf(WURZEL);
    melde(true, 'kein .git-Ordner (lokale Vorbereitung)');
  }

  const vp = join(WURZEL, '.vercel', 'project.json');
  if (existsSync(vp)) {
    const p = JSON.parse(readFileSync(vp, 'utf8'));
    melde(p.projectName === k.vercelProjekt, `.vercel/project.json verweist auf ${p.projectName}`);
  } else {
    melde(true, 'keine .vercel/project.json (nicht verknuepft)');
  }

  const envDateien = dateien.filter((p) => /(^|\/)\.env/.test(rel(p)));
  melde(envDateien.length === 0, `keine .env-Dateien im Veroeffentlichungsumfang (${envDateien.map(rel).join(', ') || 'keine'})`);

  // Interne Begriffe (nur aus der lokalen Sperrliste) und Geheimnismuster.
  const woerter = k.verboten.imInhalt.map((w) => w.toLowerCase());
  const muster = [/sk_live_[A-Za-z0-9]/, /eyJhbGciOi[A-Za-z0-9_-]{20,}/, /vercel_[A-Za-z0-9]{20,}/i, /gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/];
  const intern = [];
  const geheim = [];
  for (const p of dateien) {
    const t = readFileSync(p, 'utf8');
    const klein = t.toLowerCase();
    for (const w of woerter) if (klein.includes(w)) intern.push(`${rel(p)} ~ "${w}"`);
    if (rel(p) === 'scripts/guard.mjs') continue; // definiert die Muster selbst
    for (const m of muster) if (m.test(t)) geheim.push(`${rel(p)} ~ ${m}`);
  }
  melde(woerter.length > 0, `Sperrliste interner Begriffe vorhanden (${woerter.length} Begriffe)`);
  melde(intern.length === 0, `keine internen Begriffe im Veroeffentlichungsumfang (${intern.join('; ') || 'keine'})`);
  melde(geheim.length === 0, `keine Geheimnismuster im Veroeffentlichungsumfang (${geheim.join('; ') || 'keine'})`);
  melde(dateien.length > 0, `${dateien.length} Dateien geprueft`);
} catch (e) {
  if (e instanceof Abbruch) {
    console.log(`${e.code === 1 ? 'FAIL' : 'NICHT PRUEFBAR'}  ${e.message}`);
    process.exit(e.code);
  }
  console.log(`NICHT PRUEFBAR  ${e.message}`);
  process.exit(2);
}
const fehler = befunde.filter((b) => !b.ok).length;
console.log(`\n${befunde.length} Pruefungen, ${befunde.length - fehler} bestanden, ${fehler} fehlgeschlagen`);
process.exit(fehler === 0 ? 0 : 1);
