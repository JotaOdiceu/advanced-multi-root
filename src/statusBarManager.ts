import * as vscode from 'vscode';
import { folderLabel, ProjectTab } from './projectsProvider';

/**
 * A single status bar item showing the active project. Clicking it opens the
 * project QuickPick. Hidden while no projects exist.
 */
export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor(
    private getTabs: () => readonly ProjectTab[],
    private getActiveTabId: () => string | null,
  ) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0,
    );
    this.item.command = 'tabs.quickSwitch';
    this.update();
  }

  update(): void {
    const tabs = this.getTabs();
    if (tabs.length === 0) {
      this.item.hide();
      return;
    }

    const active = tabs.find((t) => t.id === this.getActiveTabId());
    if (active) {
      this.item.text = `$(folder-opened) ${active.name}`;
      this.item.tooltip = `Active project: ${active.folders
        .map(folderLabel)
        .join(', ')}\nClick to switch project`;
    } else {
      this.item.text = '$(folder) Select project';
      this.item.tooltip = 'Click to switch project';
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
