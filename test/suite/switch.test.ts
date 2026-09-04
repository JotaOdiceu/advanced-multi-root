import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { ProjectsProvider } from '../../src/projectsProvider';
import { fixtureUri, makeContext, openedWorkspaceUri } from '../helpers';

const origWarning = vscode.window.showWarningMessage;

function stubWarning(answer: string | undefined): void {
  (vscode.window as any).showWarningMessage = () => Promise.resolve(answer);
}

teardown(async () => {
  (vscode.window as any).showWarningMessage = origWarning;
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

suite('performSwitch(): abort on unsaved changes', () => {
  test('cancelling the save prompt leaves the workspace and active tab untouched', async () => {
    const ctx = makeContext({
      'tabs.activeTabId': 'a',
      'tabs.projectTabs': [
        { id: 'a', name: 'A', folders: [{ uri: openedWorkspaceUri() }] },
        { id: 'b', name: 'B', folders: [{ uri: fixtureUri('project-b') }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);
    assert.strictEqual(provider.getActiveTabId(), 'a');

    // Make a tracked file dirty.
    const fileUri = vscode.Uri.parse(`${openedWorkspaceUri()}/a.txt`);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((e) => e.insert(new vscode.Position(0, 0), 'dirty '));
    assert.ok(doc.isDirty, 'precondition: document should be dirty');

    stubWarning(undefined); // user dismisses the modal -> cancel

    await (provider as any).performSwitch('b');

    assert.strictEqual(provider.getActiveTabId(), 'a', 'active tab unchanged');
    assert.strictEqual(
      ctx.globalState.get('tabs.pendingRestore'),
      undefined,
      'no restore was scheduled',
    );
    assert.strictEqual(
      vscode.workspace.workspaceFolders?.[0].uri.toString(),
      openedWorkspaceUri(),
      'workspace folder 0 unchanged',
    );
  });
});

suite('removeTab(): removing the active project', () => {
  test('migrates to another project when the removed one was open', async () => {
    const ctx = makeContext({
      'tabs.activeTabId': 'a',
      'tabs.projectTabs': [
        { id: 'a', name: 'A', folders: [{ uri: openedWorkspaceUri() }] },
        { id: 'b', name: 'B', folders: [{ uri: fixtureUri('project-b') }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);
    const switched: string[] = [];
    (provider as any).switchProject = async (id: string) => {
      switched.push(id);
    };
    stubWarning('Remove');

    const tabA = provider.getTabs().find((t) => t.id === 'a');
    await provider.removeTab({ tab: tabA } as any);

    assert.deepStrictEqual(
      provider.getTabs().map((t) => t.id),
      ['b'],
    );
    assert.deepStrictEqual(switched, ['b']);
    assert.strictEqual(
      ctx.globalState.get('tabs.openFiles.a'),
      undefined,
      'the removed tab session is forgotten',
    );
  });

  test('does not touch the workspace when the removed project was not open', async () => {
    const ctx = makeContext({
      'tabs.activeTabId': 'a',
      'tabs.projectTabs': [
        { id: 'a', name: 'A', folders: [{ uri: openedWorkspaceUri() }] },
        { id: 'b', name: 'B', folders: [{ uri: fixtureUri('project-b') }] },
      ],
    });
    const provider = new ProjectsProvider(ctx);
    const switched: string[] = [];
    (provider as any).switchProject = async (id: string) => {
      switched.push(id);
    };
    stubWarning('Remove');

    const tabB = provider.getTabs().find((t) => t.id === 'b');
    await provider.removeTab({ tab: tabB } as any);

    assert.deepStrictEqual(
      provider.getTabs().map((t) => t.id),
      ['a'],
    );
    assert.deepStrictEqual(switched, []);
  });
});
