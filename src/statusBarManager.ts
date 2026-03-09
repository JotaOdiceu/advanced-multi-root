import * as vscode from 'vscode';
import { ProjectTab } from './projectsProvider';

/**
 * Shows workspace tabs in the status bar.
 * Active tab is highlighted, clicking switches to that workspace.
 * Tabs spread from center to left and right.
 */
export class StatusBarManager implements vscode.Disposable {
  private items: vscode.StatusBarItem[] = [];

  /** Central priority — tabs spread from center to left and right */
  private static readonly CENTER_PRIORITY = 0;

  constructor(
    private getTabs: () => readonly ProjectTab[],
    private getActiveTabId: () => string | null,
  ) {
    this.update();
  }

  /** Recreate status bar items */
  update(): void {
    // Clear old items
    this.disposeItems();

    const tabs = this.getTabs();
    const activeId = this.getActiveTabId();

    if (tabs.length === 0) {
      return;
    }

    // Sort tabs to spread from center to left and right
    // High priority = further left. Active tab in center, others on sides.

    tabs.forEach((tab, i) => {
      const isActive = tab.id === activeId;

      // Center spread: first tab highest priority, last tab lowest
      const priority = StatusBarManager.CENTER_PRIORITY + (tabs.length - i);

      const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        priority,
      );

      // Highlight the active tab
      if (isActive) {
        item.text = `$(folder-opened) ${tab.name}`;
        item.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground',
        );
        item.tooltip = `● Active: ${tab.path}`;
      } else {
        item.text = `$(folder) ${tab.name}`;
        item.tooltip = `Switch to: ${tab.path}`;
      }

      item.command = {
        command: 'tabs.switchTabById',
        title: 'Switch Tab',
        arguments: [tab.id],
      };

      item.show();
      this.items.push(item);
    });
  }

  private disposeItems(): void {
    for (const item of this.items) {
      item.dispose();
    }
    this.items = [];
  }

  dispose(): void {
    this.disposeItems();
  }
}
