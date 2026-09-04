import * as assert from 'node:assert';
import { ProjectsProvider } from '../../src/projectsProvider';
import { fixtureUri, makeContext, openedWorkspaceUri } from '../helpers';

/**
 * Regression guard for the reported bug: opening a git worktree (a folder that
 * is not one of the saved projects) used to leave activeTabId pointing at the
 * previous project, so the next switch saved the worktree's editors into that
 * project's slot. detectActiveTab() must clear activeTabId when the open
 * folders match no tab.
 */
suite('detectActiveTab(): active project tracking', () => {
  test('adopts the tab whose folders match the open workspace', () => {
    const ctx = makeContext({
      'tabs.projectTabs': [
        { id: 'a', name: 'A', folders: [{ uri: openedWorkspaceUri() }] },
        { id: 'b', name: 'B', folders: [{ uri: fixtureUri('project-b') }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);

    assert.strictEqual(provider.getActiveTabId(), 'a');
  });

  test('clears a stale activeTabId when no tab matches (worktree case)', () => {
    const ctx = makeContext({
      // Persisted active tab points at B, but the workspace shows project-a,
      // which is not saved as any tab -> nothing should be active.
      'tabs.activeTabId': 'b',
      'tabs.projectTabs': [
        { id: 'b', name: 'B', folders: [{ uri: fixtureUri('project-b') }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);

    assert.strictEqual(provider.getActiveTabId(), null);
  });

  test('re-running detection after a stray match keeps it cleared', () => {
    const ctx = makeContext({
      'tabs.projectTabs': [
        { id: 'b', name: 'B', folders: [{ uri: fixtureUri('project-b') }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);
    // Simulate a stale pointer left by an earlier switch.
    (provider as any).activeTabId = 'b';

    (provider as any).detectActiveTab(false);

    assert.strictEqual(provider.getActiveTabId(), null);
  });
});
