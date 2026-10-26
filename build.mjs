// Baut eine statische Seite, die nur sagt, welcher Commit ausgeliefert wird.
// Keine Daten, keine Geheimnisse. Die Messskripte lesen ausschliesslich die
// Meta-Felder "tb-commit" und "tb-build" aus und verwerfen den Rest.
import { mkdirSync, writeFileSync } from 'node:fs';

const env = process.env;
const commit = env.VERCEL_GIT_COMMIT_SHA || 'lokal';
const umgebung = env.VERCEL_ENV || 'lokal';
const zeit = new Date().toISOString();
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta name="tb-commit" content="${commit}">
<meta name="tb-build" content="${zeit}">
<meta name="tb-env" content="${umgebung}">
<title>release-gate-testbed</title>
</head>
<body>
<p>Synthetisches Testobjekt. Commit ${commit.slice(0, 7)}, gebaut ${zeit}, Umgebung ${umgebung}.</p>
</body>
</html>
`;
mkdirSync('public', { recursive: true });
writeFileSync('public/index.html', html);
console.log(`public/index.html geschrieben: commit=${commit} env=${umgebung} zeit=${zeit}`);
