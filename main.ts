// Token Radar, rebuilt by hand: a sealed DefiLlama snapshot goes in, a ranked
// board of pre-token protocols comes out.
//
// What this file does, in order: it finds the snapshot (a file, or a directory
// holding snapshot.json), hands it to the radar-2 model in lib/model.ts, and
// writes the results to the output directory — board.json with the ranking,
// data.js with the same data for the dashboard, the dashboard's own files,
// the screenshots, and finally dossier.json, which the vendored make.fun
// library rebuilds from the output directory so the two agree byte for byte.
//
// The dashboard itself is static: dashboard/index.html, dashboard/app.css and
// dashboard/app.js read the data.js this file writes. Nothing here touches
// the network, and nothing is random, so the same snapshot always yields the
// same bytes.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath as urlToPath } from 'node:url';
import { buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier as makeDossier } from './vendor/makefun-board.ts';

const entryDir = urlToPath(new URL('.', import.meta.url));

/** The caps the dossier builder enforces (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name <value>` out of the arguments, or the fallback when it is absent. */
function cliOption(name: string, fallback: string): string {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--' + name && i + 1 < argv.length) return argv[i + 1]!;
    const prefix = '--' + name + '=';
    if (token.startsWith(prefix)) return token.slice(prefix.length);
  }
  return fallback;
}

const inputGiven = cliOption('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : path.join(inputGiven, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  process.stderr.write('token radar: no snapshot at ' + snapshotPath + ': pass --input <snapshot.json|directory> or mount the sealed /input\n');
  process.exit(2);
}
const outDir = cliOption('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(fs.readFileSync(snapshotPath, 'utf8'));
const scored = buildRadar(snap);
const board = scored.board;
const radar = scored.radar;
const problem = boardIssue(board, snap);
if (problem !== null) {
  process.stderr.write('token radar: the model wrote a board the gate refuses: ' + problem + '\n');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
fs.writeFileSync(path.join(outDir, 'data.js'), dataScript(radar));

/** Move one directory's plain files into `to`, leaving out names that begin with a dot. */
function copyDirFiles(from: string, to: string): string[] {
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const entry of fs.readdirSync(from)) {
    if (entry.charAt(0) === '.') continue;
    const source = path.join(from, entry);
    if (!fs.statSync(source).isFile()) continue;
    fs.copyFileSync(source, path.join(to, entry));
    names.push(entry);
  }
  return names;
}

copyDirFiles(path.join(entryDir, 'dashboard'), path.join(outDir, 'dashboard'));
const shots = copyDirFiles(path.join(entryDir, 'screenshots'), path.join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write('token radar: screenshots/ holds ' + shots.length + ' image' + (shots.length === 1 ? '' : 's') + ': hand in 3, the board, a detail view and a filtered view\n');
  process.exit(1);
}
for (const shot of shots) {
  if (!SHOT_NAME.test(shot)) {
    process.stderr.write('token radar: screenshots/' + shot + ': a name is letters, digits and . _ -, 1 to 128 characters\n');
    process.exit(1);
  }
}

// The dossier goes last: the scorer rebuilds it from this output directory and compares the bytes.
fs.writeFileSync(path.join(outDir, 'dossier.json'), makeDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  'token radar: ' + snap.protocols.length + ' protocols, ' + snap.watchlist.length + ' on the watchlist, ' + board.length + ' rows scored (' + radar.early_size + ' early, ' + radar.live_size + ' live set aside)\n' +
    'token radar: wrote ' + path.join(outDir, 'board.json') + ', ' + path.join(outDir, 'data.js') + ', ' + path.join(outDir, 'dashboard') + ' (3 files), ' + path.join(outDir, 'screenshots') + ' (' + shots.length + ' images) and ' + path.join(outDir, 'dossier.json') + '\n',
);
