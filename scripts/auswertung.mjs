// Wertet eine Zeitlinie (JSONL aus zeitlinie.mjs) fuer einen Messfall aus.
// Jedes Ergebnis ist ein fester Code; was die Daten nicht eindeutig hergeben,
// ist NICHT_AUSWERTBAR (nie "bestanden").
//
//   node scripts/auswertung.mjs --fall M1 --datei belege/m1.jsonl --sha-neu <SHA> --sha-alt <SHA>
//        [--prod-url <url>] [--min-beobachtung 600] [--aktion-zeit <ISO, nur M5>]
import { readFileSync } from 'node:fs';
import { Abbruch, argumente, ladeKonfig, liesJsonl } from './lib.mjs';

const ms = (t) => (t ? Date.parse(t) : NaN);

// Zeitpunkt eines Abrufs: bevorzugt das Date-Feld der Server-Antwort (Uhr von
// Vercel, Sekundenaufloesung), sonst die lokale Uhr. Beides wird ausgewiesen.
const abrufZeit = (r) => (r.serverDatum ? Date.parse(r.serverDatum) : ms(r.lokal));

export function auswerten({ ereignisse, fall, shaNeu, shaAlt, prodUrl, pflicht, minBeobachtungS = 600, aktionZeit = null }) {
  const start = ereignisse.find((e) => e.art === 'start');
  if (!start) return { code: 'NICHT_AUSWERTBAR', grund: 'kein Start-Eintrag' };
  const url = prodUrl || start.urls?.[0];
  const abrufe = ereignisse.filter((e) => e.art === 'abruf' && e.url === url && e.status !== null).sort((a, b) => abrufZeit(a) - abrufZeit(b));
  const alleAbrufe = ereignisse.filter((e) => e.art === 'abruf');
  const runs = ereignisse.filter((e) => e.art === 'checkrun' && pflicht.includes(e.name));
  const fremd = ereignisse.filter((e) => e.art === 'commitstatus' && pflicht.includes(e.context));
  const ende = ereignisse.find((e) => e.art === 'ende');
  const letzteZeit = abrufe.length ? abrufZeit(abrufe[abrufe.length - 1]) : NaN;
  const ersteNeu = abrufe.find((r) => r.commit === shaNeu);
  const letzteAlt = [...abrufe].reverse().find((r) => r.commit === shaAlt);
  const basis = { url, abrufe: abrufe.length, ersteNeu: ersteNeu ? ersteNeu.serverDatum || ersteNeu.lokal : null, letzteAlt: letzteAlt ? letzteAlt.serverDatum || letzteAlt.lokal : null, ende: ende?.grund ?? null };
  if (abrufe.length === 0) return { code: 'NICHT_AUSWERTBAR', grund: 'keine verwertbaren Abrufe der Produktionsadresse', ...basis };

  const ergebnisseJeName = (name) => runs.filter((r) => r.name === name && r.status === 'completed').sort((a, b) => ms(a.completed_at) - ms(b.completed_at));
  const fehlschlag = runs.filter((r) => r.status === 'completed' && r.conclusion !== 'success').sort((a, b) => ms(a.completed_at) - ms(b.completed_at))[0];

  switch (fall) {
    case 'M1': {
      if (!fehlschlag) return { code: 'NICHT_AUSWERTBAR', grund: 'keine fehlgeschlagene Pflichtpruefung beobachtet', ...basis };
      const nachFehler = (letzteZeit - ms(fehlschlag.completed_at)) / 1000;
      if (ersteNeu) return { code: 'UMGESCHALTET_TROTZ_ROT', grund: `Produktionsadresse lieferte ${shaNeu.slice(0, 7)} trotz ${fehlschlag.name}=${fehlschlag.conclusion}`, ...basis };
      if (nachFehler < minBeobachtungS) return { code: 'NICHT_AUSWERTBAR', grund: `nur ${Math.round(nachFehler)} s nach dem Fehlschlag beobachtet (mind. ${minBeobachtungS})`, ...basis };
      return { code: 'GEHALTEN', grund: `${Math.round(nachFehler)} s nach ${fehlschlag.name}=${fehlschlag.conclusion} weiterhin nicht umgeschaltet`, ...basis };
    }
    case 'M2': {
      const namen = pflicht.filter((n) => ergebnisseJeName(n).length >= 2);
      if (namen.length === 0) return { code: 'NICHT_AUSWERTBAR', grund: 'keine Pflichtpruefung mit mindestens zwei Ergebnissen (kein Wiederholungslauf beobachtet)', ...basis };
      const n = namen[0];
      const folge = ergebnisseJeName(n);
      const ersteRot = folge.find((r) => r.conclusion !== 'success');
      const spaeterGruen = folge.find((r) => r.conclusion === 'success' && ms(r.completed_at) > ms(ersteRot?.completed_at));
      if (!ersteRot || !spaeterGruen) return { code: 'NICHT_AUSWERTBAR', grund: `${n}: keine Folge rot -> gruen`, ...basis };
      if (!ersteNeu) return { code: 'NICHT_UMGESCHALTET', grund: `${n}: nach gruener Wiederholung (${spaeterGruen.completed_at}) nicht umgeschaltet`, ...basis, rot: ersteRot.completed_at, gruen: spaeterGruen.completed_at };
      const t = abrufZeit(ersteNeu);
      const code = t < ms(spaeterGruen.completed_at) ? 'UMGESCHALTET_VOR_WIEDERHOLUNG' : 'UMGESCHALTET_NACH_WIEDERHOLUNG';
      return { code, grund: `${n}: rot ${ersteRot.completed_at}, gruen ${spaeterGruen.completed_at}, erste neue Auslieferung ${ersteNeu.serverDatum || ersteNeu.lokal}`, ...basis };
    }
    case 'M3': {
      const fremdGruen = fremd.find((s) => s.state === 'success' && s.creatorTyp !== 'Bot');
      if (!fremdGruen) return { code: 'NICHT_AUSWERTBAR', grund: 'kein fremder Commit-Status success unter einem Pflichtnamen', ...basis };
      const echt = ergebnisseJeName(fremdGruen.context);
      const echtGruen = echt.find((r) => r.conclusion === 'success');
      if (echtGruen) return { code: 'NICHT_AUSWERTBAR', grund: `${fremdGruen.context} wurde auch echt gruen – Messung nicht eindeutig`, ...basis };
      const seit = (letzteZeit - ms(fremdGruen.created_at)) / 1000;
      if (ersteNeu && abrufZeit(ersteNeu) >= ms(fremdGruen.created_at)) return { code: 'FREMDSTATUS_ANERKANNT', grund: `Umschaltung nach Fremdstatus ${fremdGruen.context} (${fremdGruen.created_at}) ohne gruene Pruefung`, ...basis };
      if (ersteNeu) return { code: 'NICHT_AUSWERTBAR', grund: 'Umschaltung lag vor dem Fremdstatus', ...basis };
      if (seit < minBeobachtungS) return { code: 'NICHT_AUSWERTBAR', grund: `nur ${Math.round(seit)} s nach dem Fremdstatus beobachtet`, ...basis };
      return { code: 'FREMDSTATUS_NICHT_ANERKANNT', grund: `${Math.round(seit)} s nach dem Fremdstatus nicht umgeschaltet`, ...basis };
    }
    case 'M4': {
      const gruenJeName = pflicht.map((n) => ergebnisseJeName(n).filter((r) => r.conclusion === 'success').pop());
      if (gruenJeName.some((r) => !r)) return { code: 'NICHT_AUSWERTBAR', grund: 'nicht alle Pflichtpruefungen gruen beobachtet', ...basis };
      const pruefEnde = Math.max(...gruenJeName.map((r) => ms(r.completed_at)));
      if (!ersteNeu || !letzteAlt) return { code: 'NICHT_AUSWERTBAR', grund: 'Wechsel alt -> neu nicht vollstaendig beobachtet', ...basis };
      const tAlt = abrufZeit(letzteAlt);
      const tNeu = abrufZeit(ersteNeu);
      const fenster = { pruefEnde: new Date(pruefEnde).toISOString(), letzteAltZeit: new Date(tAlt).toISOString(), ersteNeuZeit: new Date(tNeu).toISOString(), fensterS: (tNeu - tAlt) / 1000 };
      if (tNeu < pruefEnde) return { code: 'VOR_PRUEFUNGSENDE', grund: 'neue Auslieferung vor dem Ende der letzten Pflichtpruefung', ...basis, ...fenster };
      if (tAlt >= pruefEnde) return { code: 'NACH_PRUEFUNGSENDE', grund: 'bisheriger Stand noch nach dem Ende der letzten Pflichtpruefung ausgeliefert', ...basis, ...fenster };
      return { code: 'FENSTER_UEBERLAPPT', grund: 'Pruefungsende liegt zwischen letzter alter und erster neuer Auslieferung', ...basis, ...fenster };
    }
    case 'M5': {
      if (!aktionZeit) return { code: 'NICHT_AUSWERTBAR', grund: '--aktion-zeit fehlt', ...basis };
      if (!fehlschlag) return { code: 'NICHT_AUSWERTBAR', grund: 'der Ziel-Stand hat keine fehlgeschlagene Pflichtpruefung', ...basis };
      const ta = ms(aktionZeit);
      const neuNach = abrufe.find((r) => r.commit === shaNeu && abrufZeit(r) >= ta);
      const neuVor = abrufe.find((r) => r.commit === shaNeu && abrufZeit(r) < ta);
      if (neuVor) return { code: 'NICHT_AUSWERTBAR', grund: 'roter Stand war schon vor der Aktion ausgeliefert', ...basis };
      if (neuNach) return { code: 'WEG_UMGEHT_PRUEFUNG', grund: `roter Stand nach der Aktion (${aktionZeit}) ausgeliefert`, ...basis };
      const seit = (letzteZeit - ta) / 1000;
      if (seit < minBeobachtungS) return { code: 'NICHT_AUSWERTBAR', grund: `nur ${Math.round(seit)} s nach der Aktion beobachtet`, ...basis };
      return { code: 'WEG_GEHALTEN', grund: `${Math.round(seit)} s nach der Aktion nicht ausgeliefert`, ...basis };
    }
    case 'M6': {
      const jeUrl = {};
      for (const r of alleAbrufe) {
        const e = (jeUrl[r.url] ||= { abrufe: 0, status: {}, commits: {}, weiterleitungen: {} });
        e.abrufe++;
        e.status[r.status] = (e.status[r.status] || 0) + 1;
        if (r.commit) e.commits[r.commit.slice(0, 7)] = (e.commits[r.commit.slice(0, 7)] || 0) + 1;
        if (r.ort) e.weiterleitungen[r.ort] = (e.weiterleitungen[r.ort] || 0) + 1;
      }
      const urteil = {};
      for (const [u, e] of Object.entries(jeUrl)) {
        const nurInhalt = Object.keys(e.status).every((s) => s === '200') && Object.keys(e.commits).length > 0;
        const nurGeschuetzt = Object.keys(e.status).every((s) => ['302', '307', '401', '403'].includes(s)) && Object.keys(e.commits).length === 0;
        urteil[u] = { ...e, code: nurInhalt ? 'OEFFENTLICH_MIT_INHALT' : nurGeschuetzt ? 'GESCHUETZT_OHNE_INHALT' : 'UNEINHEITLICH' };
      }
      return { code: 'ADRESSEN_ERFASST', grund: `${Object.keys(urteil).length} Adressen`, ...basis, adressen: urteil };
    }
    default:
      throw new Abbruch(2, `unbekannter Fall ${fall}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('auswertung.mjs')) {
  try {
    const a = argumente(process.argv.slice(2));
    const k = ladeKonfig();
    const ereignisse = liesJsonl(readFileSync(a.datei, 'utf8'));
    const r = auswerten({ ereignisse, fall: a.fall, shaNeu: a['sha-neu'], shaAlt: a['sha-alt'], prodUrl: a['prod-url'], pflicht: k.pflichtpruefungen, minBeobachtungS: Number(a['min-beobachtung'] ?? 600), aktionZeit: a['aktion-zeit'] ?? null });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.code === 'NICHT_AUSWERTBAR' ? 2 : 0);
  } catch (e) {
    console.error(e instanceof Abbruch ? `NICHT AUSWERTBAR: ${e.message}` : e);
    process.exit(2);
  }
}
