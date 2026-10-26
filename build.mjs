// Baut eine statische Seite, die nur sagt, welcher Commit ausgeliefert wird.
// Keine Daten, keine Geheimnisse. Die Messskripte lesen ausschliesslich die
// Meta-Felder "tb-commit", "tb-build", "tb-env" und "tb-umgebung" und verwerfen
// den Rest.
//
// Umgebungspruefung (Isolation): Laut Vercel-Doku koennen Umgebungsvariablen
// auf Team-Ebene mit Projekten verknuepft werden. Der Build ordnet deshalb
// jeden Variablennamen ein - dokumentierte Vercel-Systemvariable, Laufzeit/
// Betriebssystem, bekannte Plattformvariable (umgebung-basis.json), sonstige
// VERCEL_/NOW_-Variable oder unbekannt. Veroeffentlicht werden nur Anzahlen,
// eine Pruefsumme und die NAMENSLISTE verschluesselt mit dem oeffentlichen
// Schluessel umgebung-schluessel.pub.pem (lesbar nur lokal beim Messenden).
// Werte werden nie gelesen, ausser fuer VERCEL_GIT_COMMIT_SHA und VERCEL_ENV.
// Mit "umgebungStreng": true in gate-control.json bricht der Build ab, sobald
// ein Name ausserhalb der bekannten Gruppen oder ein Bypass-Secret auftaucht.
import { constants, createCipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const env = process.env;
const commit = env.VERCEL_GIT_COMMIT_SHA || 'lokal';
const umgebung = env.VERCEL_ENV || 'lokal';
const zeit = new Date().toISOString();

// Vercel-Systemvariablen laut Doku "System environment variables" (Stand 15.07.2026).
const SYSTEM = new Set(['VERCEL', 'CI', 'VERCEL_ENV', 'VERCEL_TARGET_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_REGION', 'VERCEL_DEPLOYMENT_ID', 'VERCEL_PROJECT_ID',
  'VERCEL_SKEW_PROTECTION_ENABLED', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'VERCEL_OIDC_TOKEN', 'VERCEL_HASH_SALT',
  'VERCEL_GIT_PROVIDER', 'VERCEL_GIT_REPO_SLUG', 'VERCEL_GIT_REPO_OWNER', 'VERCEL_GIT_REPO_ID',
  'VERCEL_GIT_COMMIT_REF', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_MESSAGE', 'VERCEL_GIT_COMMIT_AUTHOR_LOGIN',
  'VERCEL_GIT_COMMIT_AUTHOR_NAME', 'VERCEL_GIT_PREVIOUS_SHA', 'VERCEL_GIT_PULL_REQUEST_ID']);
// Laufzeit und Betriebssystem der Build-Umgebung (keine Projektwerte).
const LAUFZEIT = [/^(PATH|HOME|PWD|OLDPWD|SHLVL|HOSTNAME|LANG|LANGUAGE|TERM|TZ|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|_)$/,
  /^LC_/, /^(NODE|NPM|npm|YARN|PNPM|COREPACK|NVM|BUN)_/, /^NODE_VERSION$/, /^INIT_CWD$/, /^LD_LIBRARY_PATH$/];

const lies = (datei, fallback) => {
  try {
    return JSON.parse(readFileSync(datei, 'utf8'));
  } catch {
    return fallback;
  }
};
const basis = new Set(lies('umgebung-basis.json', { namen: [] }).namen);
const streng = lies('gate-control.json', {}).umgebungStreng === true;

const gruppen = { system: [], laufzeit: [], plattform: [], vercelIntern: [], unbekannt: [] };
for (const n of Object.keys(env).sort()) {
  if (SYSTEM.has(n)) gruppen.system.push(n);
  else if (LAUFZEIT.some((m) => m.test(n))) gruppen.laufzeit.push(n);
  else if (basis.has(n)) gruppen.plattform.push(n);
  else if (/^(VERCEL|NOW)_/.test(n)) gruppen.vercelIntern.push(n);
  else gruppen.unbekannt.push(n);
}
const offen = [...gruppen.vercelIntern, ...gruppen.unbekannt];
const bypass = 'VERCEL_AUTOMATION_BYPASS_SECRET' in env ? 1 : 0;
const oidc = 'VERCEL_OIDC_TOKEN' in env ? 1 : 0;
const pruefsumme = createHash('sha256').update(offen.join('\n')).digest('hex').slice(0, 16);
const zaehler = Object.fromEntries(Object.entries(gruppen).map(([g, l]) => [g, l.length]));
const zeile = `system=${zaehler.system};laufzeit=${zaehler.laufzeit};plattform=${zaehler.plattform};vercel-intern=${zaehler.vercelIntern};unbekannt=${zaehler.unbekannt};bypass=${bypass};oidc=${oidc};hash=${pruefsumme}`;
console.log(`Umgebungspruefung: ${zeile}`);

if (streng && (offen.length > 0 || bypass)) {
  console.error(`Umgebungspruefung streng: ${offen.length} Name(n) ausserhalb der bekannten Gruppen, bypass=${bypass} - Build abgebrochen`);
  console.error(`Namen (keine Werte): ${offen.join(', ') || '-'}`);
  process.exit(1);
}

mkdirSync('public', { recursive: true });
let namenStatus = 'ohne-schluessel';
if (existsSync('umgebung-schluessel.pub.pem')) {
  const schluessel = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', schluessel, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(gruppen), 'utf8'), c.final()]);
  const wk = publicEncrypt({ key: readFileSync('umgebung-schluessel.pub.pem', 'utf8'), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, schluessel);
  const b64 = (b) => b.toString('base64');
  writeFileSync('public/umgebung.json', JSON.stringify({ alg: 'RSA-OAEP-256+A256GCM', commit, umgebung, gebaut: zeit, zaehler, bypass, oidc, wk: b64(wk), iv: b64(iv), tag: b64(c.getAuthTag()), ct: b64(ct) }) + '\n');
  namenStatus = 'verschluesselt';
}

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="tb-commit" content="${commit}">
<meta name="tb-build" content="${zeit}">
<meta name="tb-env" content="${umgebung}">
<meta name="tb-umgebung" content="${zeile};namen=${namenStatus}">
<title>release-gate-testbed</title>
</head>
<body>
<p>Synthetisches Testobjekt. Commit ${commit.slice(0, 7)}, gebaut ${zeit}, Umgebung ${umgebung}.</p>
</body>
</html>
`;
writeFileSync('public/index.html', html);
console.log(`public/index.html geschrieben: commit=${commit} env=${umgebung} zeit=${zeit}`);
