import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  // A stable folder-0 workspace: switching logic that replaces folder 0 would
  // restart the extension host and kill the runner, so the tests exercise the
  // pieces around the swap (detection, persistence, migration) against this.
  workspaceFolder: 'test/fixtures/project-a',
  mocha: {
    ui: 'tdd',
    timeout: 20000,
  },
});
