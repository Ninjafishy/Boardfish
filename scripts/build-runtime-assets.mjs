import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { WEB_SCRIPTS } from '../src/js/startup_manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');
const jsRoot = path.join(srcRoot, 'js');

const variants = {
  'web-preview': {
    outDir: path.join(root, 'dist-web'),
    scripts: WEB_SCRIPTS,
    bundle: 'assets/boardfish-web-preview.min.js',
  },
};

function assertInsideWorkspace(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Invalid Build Output Path: ${resolved}`);
  }
  return resolved;
}

async function resetDir(dir) {
  const resolved = assertInsideWorkspace(dir);
  await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });
}

async function copyStaticAssets(outDir) {
  for (const name of ['boardfish-icon.png', 'boardfish-icon-192.png', 'fonts', 'manifest.webmanifest']) {
    await cp(path.join(srcRoot, name), path.join(outDir, name), { recursive: true });
  }
  const css = await esbuild.transform(await readFile(path.join(srcRoot, 'styles.css'), 'utf8'), { loader: 'css', minify: true });
  await writeFile(path.join(outDir, 'styles.css'), css.code);
}

function resolveScriptPath(script) {
  return path.resolve(jsRoot, script);
}

async function concatenateScripts(scripts, variantName) {
  const parts = [];
  for (const script of scripts) {
    const filePath = resolveScriptPath(script);
    const source = await readFile(filePath, 'utf8');
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    parts.push(`\n;/* ${variantName}: ${relative} */\n${source}\n`);
  }
  return parts.join('');
}

async function compileProductionBundle(source) {
  return esbuild.transform(source, {
    define: { module: 'undefined', require: 'undefined' },
    legalComments: 'none',
    minify: true,
    treeShaking: true,
  });
}

async function writeIndex(outDir, scriptTag, preloadScript) {
  const html = await readFile(path.join(srcRoot, 'index.html'), 'utf8');
  let next = html.replace(
    /<script\s+type="module"\s+src="js\/main(?:\.[^"]+)?\.mjs"><\/script>/,
    scriptTag,
  );
  next = next.replace(
    /\n<\/head>/,
    `\n  <link rel="preload" href="${preloadScript}" as="script" />\n</head>`,
  );
  await writeFile(path.join(outDir, 'index.html'), next);
}

async function writeServiceWorker(outDir, buildAssets) {
  const source = await readFile(path.join(srcRoot, 'sw.js'), 'utf8');
  const assets = buildAssets.map((asset) => `  './${asset}',`).join('\n');
  const sw = await esbuild.transform(source.replace('  /* BOARDFISH_BUILD_ASSETS */', assets), { minify: true });
  await writeFile(path.join(outDir, 'sw.js'), sw.code);
}

function cacheBustedBundlePath(bundle, code) {
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
  return bundle.replace(/(?:\.min)?\.js$/, `.${hash}.min.js`);
}

async function buildBundle(variantName, config) {
  await resetDir(config.outDir);
  await mkdir(path.join(config.outDir, 'assets'), { recursive: true });
  await copyStaticAssets(config.outDir);

  const concatenated = await concatenateScripts(config.scripts, variantName);
  const result = await compileProductionBundle(concatenated);
  const bundle = cacheBustedBundlePath(config.bundle, result.code);
  const outPath = path.join(config.outDir, bundle);
  await writeFile(outPath, result.code);
  await writeIndex(config.outDir, `<script src="${bundle}"></script>`, bundle);
  await writeServiceWorker(config.outDir, [bundle]);

  const rawKb = Math.round(Buffer.byteLength(result.code) / 1024 * 10) / 10;
  const gzipKb = Math.round(gzipSync(result.code).length / 1024 * 10) / 10;
  console.log(`${variantName}: ${bundle} ${rawKb} KB raw, ${gzipKb} KB gzip`);
}

const requested = process.argv.slice(2);
const names = requested.length ? requested : ['web-preview'];

for (const name of names) {
  const config = variants[name];
  if (!config) {
    console.error(`Unknown Build Variant: "${name}". Options: ${Object.keys(variants).join(', ')}`);
    process.exit(1);
  }
  await buildBundle(name, config);
}
