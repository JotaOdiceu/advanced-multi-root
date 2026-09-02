import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { ProjectsProvider } from '../../src/projectsProvider';
import { makeContext } from '../helpers';

suite('load(): legacy format migration', () => {
  test('v1 {path} entries in tabs.projectTabs become {folders} shape', () => {
    const ctx = makeContext({
      'tabs.projectTabs': [{ id: 'x', name: 'Old', path: '/tmp/old-project' }],
    });
    const provider = new ProjectsProvider(ctx);

    const tabs = provider.getTabs();
    assert.strictEqual(tabs.length, 1);
    assert.strictEqual(tabs[0].id, 'x');
    assert.strictEqual(tabs[0].folders.length, 1);
    assert.strictEqual(
      tabs[0].folders[0].uri,
      vscode.Uri.file('/tmp/old-project').toString(),
    );
    // Upgrade is persisted back.
    const stored = ctx.globalState.get<any[]>('tabs.projectTabs');
    assert.ok(Array.isArray(stored?.[0].folders));
  });

  test('legacy tabs.tabs key is migrated', () => {
    const ctx = makeContext({
      'tabs.tabs': [
        { name: 'Legacy', folders: [{ path: '/tmp/legacy-a' }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);

    const tabs = provider.getTabs();
    assert.strictEqual(tabs.length, 1);
    assert.strictEqual(tabs[0].name, 'Legacy');
    assert.strictEqual(
      tabs[0].folders[0].uri,
      vscode.Uri.file('/tmp/legacy-a').toString(),
    );
  });

  test('legacy tabs.projects key is migrated', () => {
    const ctx = makeContext({
      'tabs.projects': [{ name: 'P', path: '/tmp/legacy-proj' }],
    });
    const provider = new ProjectsProvider(ctx);

    const tabs = provider.getTabs();
    assert.strictEqual(tabs.length, 1);
    assert.strictEqual(
      tabs[0].folders[0].uri,
      vscode.Uri.file('/tmp/legacy-proj').toString(),
    );
  });

  test('current {folders:[{uri}]} shape is left untouched', () => {
    const uri = vscode.Uri.file('/tmp/current').toString();
    const ctx = makeContext({
      'tabs.projectTabs': [
        { id: 'c', name: 'Current', folders: [{ uri, name: 'current' }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);

    const tabs = provider.getTabs();
    assert.strictEqual(tabs.length, 1);
    assert.strictEqual(tabs[0].folders[0].uri, uri);
  });

  test('entries with no resolvable folder are dropped', () => {
    const ctx = makeContext({
      'tabs.projectTabs': [
        { id: 'bad', name: 'Bad', folders: [] },
        { id: 'ok', name: 'Ok', folders: [{ uri: vscode.Uri.file('/tmp/ok').toString() }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);

    const tabs = provider.getTabs();
    assert.strictEqual(tabs.length, 1);
    assert.strictEqual(tabs[0].id, 'ok');
  });
});
