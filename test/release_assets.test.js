'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, readJson, listFiles } = require('../test-support/source.js');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

test('app sources contain no diagnostic hooks, logging, or build-dependent behavior', () => {
  for (const file of listFiles('src', (file) => /\.(?:js|mjs)$/.test(file))) {
    assert.doesNotMatch(readSource(file), /\bdebugger\b|\b[A-Za-z_$]*Debug[A-Za-z_$]*\b|BOARDFISH_(?:DEV_DIAGNOSTICS|PRODUCTION)|DEBUG_TOOLS_ENABLED|\bconsole\s*\./, file);
  }
});

test('development and release use the same ordered runtime manifest', async () => {
  const { WEB_SCRIPTS: scripts } = await import('../src/js/startup_manifest.mjs');
  assert.equal(scripts[0], 'web_env.js');
  assert.equal(new Set(scripts).size, scripts.length);
  for (const script of scripts) {
    assert.equal(fs.existsSync(path.join(root, 'src/js', script)), true, script);
  }
  for (const [dependency, consumer] of [
    ['web_runtime.js', 'export_utils.js'], ['text_editor.js', 'context_menu.js'],
    ['motion.js', 'viewport.js'], ['motion.js', 'selection_input.js'],
  ]) assert.ok(scripts.indexOf(dependency) >= 0 && scripts.indexOf(dependency) < scripts.indexOf(consumer));
  assert.match(readSource('src/js/main.web.dev.mjs'), /loadScripts\(WEB_SCRIPTS\)/);
  assert.match(readSource('scripts/build-runtime-assets.mjs'), /concatenateScripts\(WEB_SCRIPTS, 'web-preview'\)/);
});

test('release builds a valid cached bundle without runtime logging or diagnostics', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-runtime-assets.mjs'), 'web-preview'], { cwd: root });
  const html = readSource('dist-web/index.html');
  const match = html.match(/<script src="(assets\/boardfish-web-preview\.[a-f0-9]{12}\.min\.js)"><\/script>/);
  assert.ok(match);
  const bundle = readSource(path.join('dist-web', match[1]));
  assert.doesNotThrow(() => new vm.Script(bundle));
  assert.doesNotMatch(bundle, /debug|diagnostic|\bconsole\s*\./i);
  assert.ok(readSource('dist-web/sw.js').includes(JSON.stringify('./' + match[1])));
  assert.ok(fs.statSync(path.join(root, 'dist-web/fonts/Geist.woff2')).size > 0);
});

test('web release preview ships minified PWA assets', () => {
  const buildSource = readSource('scripts/build-runtime-assets.mjs');
  const serverSource = readSource('scripts/serve-web.mjs');
  const workflowSource = readSource('.github/workflows/web.yml');
  const readmeSource = readSource('README.md');
  const packageJson = readJson('package.json');

  assert.match(buildSource, /const bundleTemplate = 'assets\/boardfish-web-preview\.min\.js'/);
  assert.match(buildSource, /const bundle = cacheBustedBundlePath\(bundleTemplate, result\.code\);/);
  assert.match(buildSource, /'manifest\.webmanifest'\][\s\S]*loader: 'css', minify: true/);
  assert.match(buildSource, /writeServiceWorker\(outDir, \[bundle\]\)/);
  assert.match(serverSource, /devMode \? 'src' : 'dist-web'/);
  assert.match(workflowSource, /npm run web:build/);
  assert.match(workflowSource, /path: dist-web/);
  assert.match(workflowSource, /branches:\s*\n\s*- main\s*\n\s*- beta/);
  assert.match(workflowSource, /ref: \$\{\{ steps\.beta_ref\.outputs\.ref \}\}/);
  assert.match(workflowSource, /cp -R production\/dist-web\/\. dist-web\//);
  assert.match(workflowSource, /cp -R beta-source\/dist-web\/\. dist-web\/beta\//);
  assert.match(workflowSource, /noindex, nofollow/);
  assert.match(workflowSource, /actions\/upload-pages-artifact@v4/);
  assert.doesNotMatch(readmeSource, /\/Boardfish\/beta(?:\/|\b)/i);
  assert.equal(packageJson.scripts.web, 'npm run web:preview');
  assert.equal(packageJson.scripts.build, 'npm run web:build');
  assert.equal(packageJson.scripts.check, 'npm run check:js-syntax && npm test');
});
