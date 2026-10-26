// Gemeinsame Bausteine der Messskripte. Grundsatz: Alles, was das Netz
// anspricht, prueft vorher, dass es ausschliesslich das Testobjekt trifft.
// Projektbezogene Werte und die Sperrliste stehen nur in testbed.local.json
// (nie veroeffentlicht); ohne diese Datei ist jedes Netzskript gesperrt.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOKAL_DATEI = 'testbed.local.json';

export class Abbruch extends Error {
  constructor(code, text) {
    super(text);
    this.code = code; // 1 = Verstoss, 2 = nicht pruefbar / nicht auswertbar
  }
}

const LEER = { repos: [], hostGenau: [], hostPraefix: [], hostEnthaelt: [], imInhalt: [] };

export function ladeKonfig(wurzel = WURZEL) {
  let k;
  try {
    k = JSON.parse(readFileSync(join(wurzel, 'testbed.config.json'), 'utf8'));
  } catch (e) {
    throw new Abbruch(2, `Konfiguration nicht lesbar: ${e.message}`);
  }
  if (!k.vercelProjekt || !Array.isArray(k.pflichtpruefungen) || k.pflichtpruefungen.length === 0) {
    throw new Abbruch(2, 'Konfiguration unvollstaendig (vercelProjekt, pflichtpruefungen)');
  }
  const pfad = join(wurzel, LOKAL_DATEI);
  if (!existsSync(pfad)) return { ...k, lokal: false, githubRepo: null, produktionsAdresse: null, verboten: LEER };
  let l;
  try {
    l = JSON.parse(readFileSync(pfad, 'utf8'));
  } catch (e) {
    throw new Abbruch(2, `${LOKAL_DATEI} nicht lesbar: ${e.message}`);
  }
  for (const f of ['githubRepo', 'produktionsAdresse', 'verboten']) {
    if (!(f in l)) throw new Abbruch(2, `${LOKAL_DATEI} ohne Feld ${f}`);
  }
  return { ...k, lokal: true, githubRepo: l.githubRepo, produktionsAdresse: l.produktionsAdresse, verboten: { ...LEER, ...l.verboten } };
}

export function hatPlatzhalter(k) {
  return !k.lokal || JSON.stringify([k.githubRepo, k.produktionsAdresse]).includes('<');
}

export function pruefeRepo(k, repo) {
  const r = String(repo).toLowerCase();
  if (r.includes('<')) throw new Abbruch(2, 'Repository enthaelt noch einen Platzhalter');
  if (k.verboten.repos.some((v) => r === v.toLowerCase())) throw new Abbruch(1, `verbotenes Repository: ${repo}`);
  if (!k.githubRepo || r !== String(k.githubRepo).toLowerCase()) throw new Abbruch(1, `Repository ${repo} ist nicht das konfigurierte Testobjekt`);
  return repo;
}

export function pruefeUrl(k, adresse) {
  let u;
  try {
    u = new URL(adresse);
  } catch {
    throw new Abbruch(1, `keine gueltige Adresse: ${adresse}`);
  }
  if (u.protocol !== 'https:') throw new Abbruch(1, `nur https erlaubt: ${adresse}`);
  const h = u.hostname.toLowerCase();
  if (k.verboten.hostGenau.some((v) => h === v)) throw new Abbruch(1, `verbotene Adresse: ${h}`);
  if (k.verboten.hostPraefix.some((v) => h.startsWith(v))) throw new Abbruch(1, `verbotene Adresse (Praefix): ${h}`);
  if (k.verboten.hostEnthaelt.some((v) => h.includes(v))) throw new Abbruch(1, `verbotene Adresse (Bestandteil): ${h}`);
  if (!h.startsWith(String(k.vercelProjekt).toLowerCase())) {
    throw new Abbruch(1, `Adresse ${h} gehoert nicht zum Testprojekt ${k.vercelProjekt}`);
  }
  return u.toString();
}

export function gh(pfad, args = []) {
  return JSON.parse(execFileSync('gh', ['api', ...args, pfad], { encoding: 'utf8', maxBuffer: 1e8 }));
}

export const iso = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function liesJsonl(text) {
  const zeilen = text.split(/\r?\n/).filter((z) => z.trim() !== '');
  return zeilen.map((z, i) => {
    try {
      return JSON.parse(z);
    } catch {
      throw new Abbruch(2, `JSONL Zeile ${i + 1} nicht lesbar`);
    }
  });
}

export function argumente(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) throw new Abbruch(2, `unerwartetes Argument: ${t}`);
    const k = t.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[k] = v;
  }
  return a;
}
