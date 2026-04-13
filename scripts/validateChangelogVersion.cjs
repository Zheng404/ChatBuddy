const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(packageJsonPath)) {
  fail('package.json not found');
}

if (!fs.existsSync(changelogPath)) {
  fail('CHANGELOG.md not found');
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = String(pkg.version || '').trim();

if (!version) {
  fail('package.json version is empty');
}

const changelog = fs.readFileSync(changelogPath, 'utf8');
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headingPattern = new RegExp(`^##\\s+\\[${escapedVersion}\\](?:\\s+-\\s+.+)?$`, 'm');

if (!headingPattern.test(changelog)) {
  fail(`CHANGELOG.md is missing a section for version ${version}`);
}

console.log(`CHANGELOG.md contains version ${version}`);
