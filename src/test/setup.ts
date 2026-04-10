import moduleModule = require('module');

type MinimalUri = {
  fsPath: string;
  path: string;
  toString: () => string;
};

const vscodeStub = {
  env: {
    language: 'en',
    appRoot: process.cwd()
  },
  window: {
    createOutputChannel: () => ({
      appendLine: () => undefined,
      dispose: () => undefined
    })
  },
  ViewColumn: {
    One: 1
  },
  ThemeIcon: class ThemeIcon {
    constructor(public readonly id: string) {}
  },
  Uri: {
    parse(value: string): MinimalUri {
      return {
        fsPath: value,
        path: value,
        toString: () => value
      };
    },
    file(filePath: string): MinimalUri {
      return {
        fsPath: filePath,
        path: filePath,
        toString: () => filePath
      };
    },
    joinPath(...segments: Array<{ fsPath?: string; path?: string } | string>): MinimalUri {
      const value = segments
        .map((segment) => {
          if (typeof segment === 'string') {
            return segment;
          }
          return segment.fsPath ?? segment.path ?? '';
        })
        .join('/');
      return {
        fsPath: value,
        path: value,
        toString: () => value
      };
    }
  }
};

const moduleApi = moduleModule as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleApi._load;

moduleApi._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
