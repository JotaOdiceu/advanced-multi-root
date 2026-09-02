import * as assert from 'node:assert';
import { ProjectsProvider } from '../../src/projectsProvider';
import { fixtureUri, makeContext, openedWorkspaceUri } from '../helpers';

suite('editor session persistence', () => {
  test('readStoredSession tolerates the old string[] shape', () => {
    const ctx = makeContext({
      'tabs.openFiles.a': ['file:///tmp/one.ts', 'file:///tmp/two.ts'],
    });
    const provider = new ProjectsProvider(ctx);

    const session = (provider as any).readStoredSession('a');
    assert.deepStrictEqual(session, [
      { uri: 'file:///tmp/one.ts' },
      { uri: 'file:///tmp/two.ts' },
    ]);
  });

  test('readStoredSession returns SavedEditor objects unchanged', () => {
    const entry = {
      uri: 'file:///tmp/one.ts',
      viewColumn: 2,
      active: true,
      pinned: true,
    };
    const ctx = makeContext({ 'tabs.openFiles.a': [entry] });
    const provider = new ProjectsProvider(ctx);

    const session = (provider as any).readStoredSession('a');
    assert.deepStrictEqual(session, [entry]);
  });

  test('readStoredSession returns [] for an unknown tab', () => {
    const provider = new ProjectsProvider(makeContext());
    assert.deepStrictEqual((provider as any).readStoredSession('nope'), []);
  });

  test('applyPendingRestore keeps the marker when the workspace is not on the target', async () => {
    const ctx = makeContext({
      'tabs.projectTabs': [
        { id: 'b', name: 'B', folders: [{ uri: fixtureUri('project-b') }] },
      ],
      'tabs.pendingRestore': { tabId: 'b', editors: [] },
    });
    const provider = new ProjectsProvider(ctx);

    await (provider as any).applyPendingRestore();

    // Workspace shows project-a, target is project-b -> restore must wait.
    assert.ok(ctx.globalState.get('tabs.pendingRestore'));
  });

  test('applyPendingRestore clears the marker once the workspace matches', async () => {
    const ctx = makeContext({
      'tabs.projectTabs': [
        { id: 'a', name: 'A', folders: [{ uri: openedWorkspaceUri() }] },
      ],
      'tabs.pendingRestore': { tabId: 'a', editors: [] },
    });
    // The constructor also kicks off a restore; wait for the marker to clear.
    new ProjectsProvider(ctx);

    for (let i = 0; i < 40 && ctx.globalState.get('tabs.pendingRestore'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.strictEqual(ctx.globalState.get('tabs.pendingRestore'), undefined);
  });
});
