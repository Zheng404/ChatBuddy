const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestDataPath = path.join(rootDir, 'src', 'extension', 'localeAwareManifestData.json');

const localeVariants = [
  { locale: 'en', suffix: 'uiEn' },
  { locale: 'zh-CN', suffix: 'uiZh' }
];

const aliasCommandPattern = /\.ui(?:En|Zh)$/;

function buildAliasCommandId(commandId, suffix) {
  return `${commandId}.${suffix}`;
}

function buildLocalizedWhen(baseWhen, locale) {
  return `(${baseWhen}) && chatbuddy.locale == '${locale}'`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildGeneratedCommands(data) {
  return data.commands.flatMap((entry) =>
    localeVariants.map(({ locale, suffix }) => {
      const generated = {
        command: buildAliasCommandId(entry.command, suffix),
        title: entry.titles[locale]
      };
      if (entry.icon) {
        generated.icon = entry.icon;
      }
      return generated;
    })
  );
}

function buildGeneratedMenuEntries(data) {
  const menus = {};
  for (const [location, entries] of Object.entries(data.menus)) {
    menus[location] = entries.flatMap((entry) =>
      localeVariants.map(({ locale, suffix }) => ({
        command: buildAliasCommandId(entry.command, suffix),
        when: buildLocalizedWhen(entry.when, locale),
        group: entry.group
      }))
    );
  }

  menus.commandPalette = data.commands.flatMap((entry) =>
    localeVariants.map(({ suffix }) => ({
      command: buildAliasCommandId(entry.command, suffix),
      when: 'false'
    }))
  );

  return menus;
}

function stripGeneratedCommands(commands) {
  return commands.filter((entry) => !aliasCommandPattern.test(entry.command));
}

function stripGeneratedMenuEntries(entries = []) {
  return entries.filter((entry) => !aliasCommandPattern.test(entry.command));
}

function main() {
  const packageJson = readJson(packageJsonPath);
  const manifestData = readJson(manifestDataPath);

  packageJson.contributes.commands = [
    ...stripGeneratedCommands(packageJson.contributes.commands),
    ...buildGeneratedCommands(manifestData)
  ];

  const generatedMenus = buildGeneratedMenuEntries(manifestData);
  for (const [location, generatedEntries] of Object.entries(generatedMenus)) {
    packageJson.contributes.menus[location] = [
      ...stripGeneratedMenuEntries(packageJson.contributes.menus[location]),
      ...generatedEntries
    ];
  }

  writeJson(packageJsonPath, packageJson);
}

main();
