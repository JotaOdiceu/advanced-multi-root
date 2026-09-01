import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface ProjectTab {
  id: string;
  name: string;
  path: string;
}

/** Editor session to reopen once a switch has taken effect. */
interface PendingRestore {
  tabId: string;
  uris: string[];
}

// ── Tree Item ──────────────────────────────────────────────

export class TabTreeItem extends vscode.TreeItem {
  constructor(
    public readonly tab: ProjectTab,
    public readonly isActive: boolean,
  ) {
    super(tab.name, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${tab.path}`;
    this.description = isActive ? '● active' : tab.path;
    this.contextValue = isActive ? 'tab-active' : 'tab';
    this.iconPath = new vscode.ThemeIcon(
      isActive ? 'folder-opened' : 'folder',
      isActive ? new vscode.ThemeColor('charts.green') : undefined,
    );

    // Open folder when tab is clicked
    this.command = {
      command: 'tabs.switchTab',
      title: 'Switch to Project',
      arguments: [this],
    };
  }
}

// ── Provider ───────────────────────────────────────────────

export class ProjectsProvider implements vscode.TreeDataProvider<TabTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TabTreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tabs: ProjectTab[] = [];
  private activeTabId: string | null = null;

  private _onDidChangeTabs = new vscode.EventEmitter<void>();
  readonly onDidChangeTabs = this._onDidChangeTabs.event;

  constructor(private context: vscode.ExtensionContext) {
    this.load();
    this.detectActiveTab();

    // A switch that replaced workspace folder 0 restarts the extension host,
    // so the editor restore has to run here, on the next activation.
    void this.applyPendingRestore();

    // Update active tab when workspace folders change
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.detectActiveTab();
      // Covers switches that swap folders without a window reload.
      void this.applyPendingRestore();
      this._onDidChangeTreeData.fire(undefined);
      this._onDidChangeTabs.fire();
    });
  }

  /** External access to the tab list */
  getTabs(): readonly ProjectTab[] {
    return this.tabs;
  }
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  refresh(): void {
    this.detectActiveTab();
    this._onDidChangeTreeData.fire(undefined);
    this._onDidChangeTabs.fire();
  }

  // ── Persistence ────────────────────────────────────────

  private load(): void {
    const raw = this.context.globalState.get<any[]>('tabs.projectTabs', []);
    this.activeTabId = this.context.globalState.get<string | null>(
      'tabs.activeTabId',
      null,
    );

    this.tabs = raw.map((t) => ({
      id: t.id || this.genId(),
      name: t.name || 'Unnamed',
      path: t.path || '',
    }));

    // Legacy format migration: tabs or projects
    if (this.tabs.length === 0) {
      const oldTabs = this.context.globalState.get<any[]>('tabs.tabs', []);
      if (oldTabs.length > 0) {
        // Migration from legacy multi-folder tabs — make each folder a separate tab
        for (const tab of oldTabs) {
          const folders = tab.folders || tab.projects || [];
          for (const f of folders) {
            this.tabs.push({
              id: this.genId(),
              name: f.name || path.basename(f.path),
              path: f.path,
            });
          }
        }
      } else {
        const oldProjects = this.context.globalState.get<any[]>(
          'tabs.projects',
          [],
        );
        for (const p of oldProjects) {
          this.tabs.push({
            id: this.genId(),
            name: p.name || path.basename(p.path),
            path: p.path,
          });
        }
      }
      if (this.tabs.length > 0) {
        void this.save();
      }
    }
  }

  private async save(): Promise<void> {
    await this.context.globalState.update('tabs.projectTabs', this.tabs);
    await this.context.globalState.update('tabs.activeTabId', this.activeTabId);
  }

  private genId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  /** fsPath of the open folder, or undefined for multi-root / empty windows. */
  private currentWorkspacePath(): string | undefined {
    const wsFolders = vscode.workspace.workspaceFolders;
    return wsFolders && wsFolders.length === 1
      ? wsFolders[0].uri.fsPath
      : undefined;
  }

  /** URIs (as strings) of every open text editor across all tab groups. */
  private collectOpenTextUris(): string[] {
    const uris: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const t of group.tabs) {
        if (t.input instanceof vscode.TabInputText) {
          uris.push(t.input.uri.toString());
        }
      }
    }
    return uris;
  }

  /** True when `uri` is the folder itself or a file nested under it. */
  private uriBelongsToFolder(uri: vscode.Uri, folderPath: string): boolean {
    if (uri.scheme !== 'file') {
      return false;
    }
    const rel = path.relative(folderPath, uri.fsPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  /** Find active tab based on currently open folder */
  private detectActiveTab(): void {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (wsFolders && wsFolders.length === 1) {
      const openPath = wsFolders[0].uri.fsPath;
      const match = this.tabs.find((t) => t.path === openPath);
      if (match) {
        if (this.activeTabId !== match.id) {
          this.activeTabId = match.id;
          void this.save();
        }
        return;
      }
    }

    // The open folder is not one of our tabs: a git worktree, an unrelated
    // folder, a multi-root workspace, or an empty window. No tab is active.
    // Keeping a stale activeTabId here is what makes the next switchTab
    // overwrite another project's saved session with the wrong files.
    if (this.activeTabId !== null) {
      this.activeTabId = null;
      void this.save();
    }
  }

  // ── TreeDataProvider ───────────────────────────────────

  getTreeItem(element: TabTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TabTreeItem): Thenable<TabTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.tabs.map((tab) => new TabTreeItem(tab, tab.id === this.activeTabId)),
    );
  }

  // ── Core: Switch Project ─────────────────────────

  /** Tree item click. */
  async switchTab(item: TabTreeItem): Promise<void> {
    await this.switchProject(item.tab.id);
  }

  /** Status bar / command invocation. */
  async switchTabById(tabId: string): Promise<void> {
    await this.switchProject(tabId);
  }

  /**
   * The single entry point for making a project the active workspace. Every
   * caller (tree, status bar, add, remove) goes through here so the save →
   * close → swap → restore sequence stays in one place.
   */
  async switchProject(tabId: string): Promise<void> {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) {
      return;
    }
    if (!fs.existsSync(tab.path)) {
      vscode.window.showErrorMessage(`Folder "${tab.path}" does not exist.`);
      return;
    }
    if (tab.id === this.activeTabId) {
      return;
    }

    // The project's folder is already the open one (e.g. adopted from a git
    // worktree checkout or just added). Adopt it without the close/swap dance.
    if (this.currentWorkspacePath() === tab.path) {
      this.activeTabId = tab.id;
      await this.save();
      this._onDidChangeTabs.fire();
      return;
    }

    // 1) Save the current session — but only into the slot of the tab whose
    //    folder is actually open. If an unrelated folder (worktree, etc.) is
    //    open, activeTabId may be stale and saving here would clobber another
    //    project's session.
    const previousActiveId = this.activeTabId;
    const activeTab = previousActiveId
      ? this.tabs.find((t) => t.id === previousActiveId)
      : undefined;
    if (activeTab && this.currentWorkspacePath() === activeTab.path) {
      await this.context.globalState.update(
        `tabs.openFiles.${activeTab.id}`,
        this.collectOpenTextUris(),
      );
    }

    // 2) Deal with unsaved changes first. closeAllEditors would otherwise pop
    //    a save dialog per file and, if the user backs out, we would still
    //    switch the workspace under half-saved editors.
    const dirtyDocs = vscode.workspace.textDocuments.filter(
      (d) => d.isDirty && !d.isUntitled,
    );
    if (dirtyDocs.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `You have ${dirtyDocs.length} unsaved file(s). Save before switching?`,
        { modal: true },
        'Save All',
        "Don't Save",
      );
      if (choice !== 'Save All' && choice !== "Don't Save") {
        return; // cancelled — stay on the current project
      }
      if (choice === 'Save All') {
        await vscode.workspace.saveAll(false);
      }
    }

    // 3) Close all editors. If dirty tabs survive (e.g. an untitled file whose
    //    save prompt was dismissed), the user cancelled — abort the switch.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const dirtyRemains = vscode.window.tabGroups.all.some((g) =>
      g.tabs.some((t) => t.isDirty),
    );
    if (dirtyRemains) {
      vscode.window.showInformationMessage('Project switch cancelled.');
      return;
    }

    // 4) Record the session to restore. Replacing workspace folder 0 restarts
    //    the extension host, so this has to survive into the next activation —
    //    applyPendingRestore() runs it there (and on folder-change events, for
    //    the cases where no reload happens).
    const savedUris = this.context.globalState.get<string[]>(
      `tabs.openFiles.${tab.id}`,
      [],
    );
    const pending: PendingRestore = { tabId: tab.id, uris: savedUris };
    await this.context.globalState.update('tabs.pendingRestore', pending);

    this.activeTabId = tab.id;
    await this.save();

    // 5) Swap the workspace to this project's folder.
    const wsCount = vscode.workspace.workspaceFolders?.length ?? 0;
    const applied = vscode.workspace.updateWorkspaceFolders(0, wsCount, {
      uri: vscode.Uri.file(tab.path),
    });
    if (!applied) {
      vscode.window.showErrorMessage(
        `Could not switch to "${tab.name}": the workspace folders could not be updated.`,
      );
      this.activeTabId = previousActiveId;
      await this.context.globalState.update('tabs.pendingRestore', undefined);
      await this.save();
      this._onDidChangeTabs.fire();
      return;
    }

    // 6) Fast path for switches that don't reload the window.
    await this.applyPendingRestore();
    this._onDidChangeTabs.fire();
  }

  /**
   * Reopen the saved editors for a switch that is now in effect. Safe to call
   * repeatedly — it only acts once the workspace actually shows the pending
   * project, and clears the marker afterwards.
   */
  private async applyPendingRestore(): Promise<void> {
    const pending = this.context.globalState.get<PendingRestore>(
      'tabs.pendingRestore',
    );
    if (!pending) {
      return;
    }
    const tab = this.tabs.find((t) => t.id === pending.tabId);
    if (!tab || this.currentWorkspacePath() !== tab.path) {
      return; // workspace is not (yet) on the target project
    }

    for (const uriStr of pending.uris) {
      try {
        const uri = vscode.Uri.parse(uriStr);
        // Keep only files under this project's folder; anything else is
        // leftover from a session that was mis-saved against this slot.
        if (!this.uriBelongsToFolder(uri, tab.path)) {
          continue;
        }
        await vscode.commands.executeCommand('vscode.open', uri, {
          preview: false,
        });
      } catch (e) {
        console.error(`Failed to restore editor: ${uriStr}`, e);
      }
    }

    await this.context.globalState.update('tabs.pendingRestore', undefined);
    await vscode.commands.executeCommand('workbench.view.explorer');
  }

  // ── Save current folder as tab ───────────────────

  async saveCurrentAsTab(): Promise<void> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      vscode.window.showWarningMessage('No folder is open.');
      return;
    }

    for (const wf of wsFolders) {
      const folderPath = wf.uri.fsPath;
      if (this.tabs.some((t) => t.path === folderPath)) {
        continue; // Already saved
      }

      const tabName =
        wsFolders.length === 1
          ? await vscode.window.showInputBox({
              prompt: 'Tab name',
              value: wf.name,
            })
          : wf.name;

      if (!tabName) {
        continue;
      }

      this.tabs.push({
        id: this.genId(),
        name: tabName,
        path: folderPath,
      });
    }

    this.activeTabId =
      this.tabs.find((t) => t.path === wsFolders[0].uri.fsPath)?.id ??
      this.activeTabId;
    await this.save();
    this.refresh();
    vscode.window.showInformationMessage('Current folder saved as tab.');
  }

  // ── Tab CRUD ───────────────────────────────────────────

  async addTab(): Promise<void> {
    const configuredFolder = vscode.workspace
      .getConfiguration('tabs')
      .get<string>('defaultFolder');
    const defaultPath =
      configuredFolder && configuredFolder.trim() !== ''
        ? configuredFolder
        : require('node:os').homedir();
    const defaultUri = vscode.Uri.file(defaultPath);
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: true,
      openLabel: 'Add Project Folder(s)',
      defaultUri,
    });
    if (!uris || uris.length === 0) {
      return;
    }

    // Register every picked folder first; switch once at the end. Calling
    // updateWorkspaceFolders inside the loop activated each intermediate
    // project and raced the async folder-change events.
    const addedIds: string[] = [];
    for (const uri of uris) {
      const folderPath = uri.fsPath;

      if (this.tabs.some((t) => t.path === folderPath)) {
        vscode.window.showWarningMessage(
          `"${path.basename(folderPath)}" is already added.`,
        );
        continue;
      }
      if (!fs.existsSync(folderPath)) {
        vscode.window.showErrorMessage(`"${folderPath}" does not exist.`);
        continue;
      }

      const tabName = await vscode.window.showInputBox({
        prompt: 'Tab name',
        value: path.basename(folderPath),
      });
      if (!tabName) {
        continue;
      }

      const id = this.genId();
      this.tabs.push({ id, name: tabName, path: folderPath });
      addedIds.push(id);
    }

    if (addedIds.length === 0) {
      return;
    }

    await this.save();
    this.refresh();
    this._onDidChangeTabs.fire();

    // Open the last project that was added.
    await this.switchProject(addedIds[addedIds.length - 1]);
  }

  async removeTab(item: TabTreeItem): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `Remove tab "${item.tab.name}"?`,
      { modal: true },
      'Remove',
    );
    if (answer !== 'Remove') {
      return;
    }

    this.tabs = this.tabs.filter((t) => t.id !== item.tab.id);
    if (this.activeTabId === item.tab.id) {
      this.activeTabId = null;
    }

    // Remove from Workspace (if it's the active one)
    const wsFolders = vscode.workspace.workspaceFolders || [];
    if (wsFolders.length === 1 && wsFolders[0].uri.fsPath === item.tab.path) {
      // If there's another tab, switch to the first one so it doesn't stay empty
      if (this.tabs.length > 0) {
        const firstTab = this.tabs[0];
        this.activeTabId = firstTab.id;
        vscode.workspace.updateWorkspaceFolders(0, 1, {
          uri: vscode.Uri.file(firstTab.path),
        });
      } else {
        // If no tabs are left, clear all of them
        vscode.workspace.updateWorkspaceFolders(0, 1);
      }
    }

    await this.save();
    this.refresh();
    this._onDidChangeTabs.fire();
  }

  async removeAllTabs(): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      'Are you sure you want to remove all projects?',
      { modal: true },
      'Remove All',
    );
    if (answer !== 'Remove All') {
      return;
    }

    this.tabs = [];
    this.activeTabId = null;

    // Optionally clear workspace folders completely
    vscode.workspace.updateWorkspaceFolders(
      0,
      vscode.workspace.workspaceFolders?.length || 0,
    );

    await this.save();
    this.refresh();
    this._onDidChangeTabs.fire();
  }

  async renameTab(item: TabTreeItem): Promise<void> {
    const newName = await vscode.window.showInputBox({
      prompt: 'New name',
      value: item.tab.name,
    });
    if (!newName || newName === item.tab.name) {
      return;
    }

    const tab = this.tabs.find((t) => t.id === item.tab.id);
    if (tab) {
      tab.name = newName;
      await this.save();
      this.refresh();
      this._onDidChangeTabs.fire();
    }
  }
}
