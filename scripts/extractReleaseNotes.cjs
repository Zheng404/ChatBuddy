const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return String(process.argv[index + 1] || '').trim();
}

if (!fs.existsSync(packageJsonPath)) {
  fail('package.json not found');
}

if (!fs.existsSync(changelogPath)) {
  fail('CHANGELOG.md not found');
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = getArg('--version', String(pkg.version || '').trim());
const outputFile = getArg('--out', path.join(rootDir, '.github-release-notes.md'));

if (!version) {
  fail('release version is empty');
}

const changelog = fs.readFileSync(changelogPath, 'utf8');
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headingPattern = new RegExp(`^##\\s+\\[${escapedVersion}\\](?:\\s+-\\s+.+)?$`, 'm');
const match = changelog.match(headingPattern);

if (!match || typeof match.index !== 'number') {
  fail(`CHANGELOG.md is missing a section for version ${version}`);
}

const startIndex = match.index + match[0].length;
const remaining = changelog.slice(startIndex);
const nextHeadingMatch = remaining.match(/\n##\s+\[/);
const section = (nextHeadingMatch ? remaining.slice(0, nextHeadingMatch.index) : remaining).trim();

if (!section) {
  fail(`CHANGELOG.md section for version ${version} is empty`);
}

fs.writeFileSync(outputFile, `${section}\n`, 'utf8');
console.log(`Release notes written to ${path.relative(rootDir, outputFile)}`);
