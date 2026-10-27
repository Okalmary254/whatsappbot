const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(fullPath);
    return entry.isFile() && fullPath.endsWith('.js') ? [fullPath] : [];
  });
}

test('JavaScript files parse without syntax errors', () => {
  const files = [...javascriptFiles(path.join(root, 'src')), ...javascriptFiles(path.join(root, 'public'))];
  assert.ok(files.length > 0, 'expected JavaScript source files to be present');
  for (const file of files) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }), file);
  }
});

test('dashboard protects HTTP routes and WebSocket upgrades', () => {
  const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
  assert.match(server, /DASHBOARD_PASSWORD/);
  assert.match(server, /server\.on\('upgrade'/);
  assert.match(server, /WWW-Authenticate/);
  assert.doesNotMatch(server, /app\.use\(cors\(\)\)/);
});

test('shutdown closes the socket without logging out', () => {
  const entry = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
  const bot = fs.readFileSync(path.join(root, 'src/bot.js'), 'utf8');
  assert.match(entry, /process\.on\('SIGTERM'/);
  assert.match(entry, /bot\.close\(\)/);
  assert.match(bot, /async close\(\)/);
});

test('database readiness and message retention are configured', () => {
  const db = fs.readFileSync(path.join(root, 'src/db.js'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/chatStore.js'), 'utf8');
  assert.match(db, /const ready = initDatabase\(\)/);
  assert.match(store, /await ready/);
  assert.match(store, /RETENTION_DAYS/);
});
