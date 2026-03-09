import * as vscode from 'vscode';
import { ProjectsProvider, TabTreeItem } from './projectsProvider';
import { StatusBarManager } from './statusBarManager';

export function activate(context: vscode.ExtensionContext) {
  console.log('Tabs extension is now active!');

  const provider = new ProjectsProvider(context);

  const treeView = vscode.window.createTreeView('tabs-projects', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  // Status bar tabs
  const statusBar = new StatusBarManager(
    () => provider.getTabs(),
    () => provider.getActiveTabId(),
  );

  // Update status bar on tab changes
  provider.onDidChangeTabs(() => statusBar.update());

  context.subscriptions.push(
    treeView,
    statusBar,
    vscode.commands.registerCommand('tabs.addTab', () => provider.addTab()),
    vscode.commands.registerCommand('tabs.removeAll', () =>
      provider.removeAllTabs(),
    ),
    vscode.commands.registerCommand('tabs.removeTab', (item: TabTreeItem) =>
      provider.removeTab(item),
    ),
    vscode.commands.registerCommand('tabs.renameTab', (item: TabTreeItem) =>
      provider.renameTab(item),
    ),
    vscode.commands.registerCommand('tabs.switchTab', (item: TabTreeItem) =>
      provider.switchTab(item),
    ),
    vscode.commands.registerCommand('tabs.switchTabById', (tabId: string) =>
      provider.switchTabById(tabId),
    ),
    vscode.commands.registerCommand('tabs.saveCurrentAsTab', () =>
      provider.saveCurrentAsTab(),
    ),
    vscode.commands.registerCommand('tabs.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('tabs.openSettings', async () => {
      const current =
        vscode.workspace
          .getConfiguration('tabs')
          .get<string>('defaultFolder') || 'Not set (uses home directory)';
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: '$(folder) Change Default Folder',
            description: current,
            id: 'setFolder',
          },
          {
            label: '$(clear-all) Clear Default Folder',
            description: 'Reset to home directory',
            id: 'clearFolder',
          },
          {
            label: '$(gear) Open All Settings',
            description: 'Open VS Code settings for Tabs',
            id: 'openSettings',
          },
        ],
        { placeHolder: 'Tabs Settings' },
      );

      if (!pick) {
        return;
      }

      if (pick.id === 'setFolder') {
        const defaultUri =
          current !== 'Not set (uses home directory)'
            ? vscode.Uri.file(current)
            : vscode.Uri.file(require('node:os').homedir());
        const uri = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Default Folder',
          defaultUri,
        });
        if (uri && uri.length > 0) {
          await vscode.workspace
            .getConfiguration('tabs')
            .update(
              'defaultFolder',
              uri[0].fsPath,
              vscode.ConfigurationTarget.Global,
            );
          vscode.window.showInformationMessage(
            `Default folder set to: ${uri[0].fsPath}`,
          );
        }
      } else if (pick.id === 'clearFolder') {
        await vscode.workspace
          .getConfiguration('tabs')
          .update('defaultFolder', '', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          'Default folder reset to home directory.',
        );
      } else {
        vscode.commands.executeCommand('workbench.action.openSettings', 'tabs');
      }
    }),
  );
}

export function deactivate() {}
