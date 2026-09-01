import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** One folder inside a project. Stored as a vscode.Uri string so remote
 *  workspaces (SSH, WSL, Dev Containers, Codespaces) round-trip correctly. */
export interface ProjectFolder {
  uri: string;
  name?: string;
}

export interface ProjectTab {
  id: string;
  name: string;
  folders: ProjectFolder[];
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

    const labels = tab.folders.map(folderLabel);
    this.tooltip = labels.join('\n');
    this.description = isActive
      ? '● active'
      : tab.folders.length > 1
        ? `${tab.folders.length} folders`
        : (labels[0] ?? '');
    this.contextValue = isActive ? 'tab-active' : 'tab';
    this.iconPath = new vscode.ThemeIcon(
      isActive ? 'folder-opened' : 'folder',
      isActive ? new vscode.ThemeColor('charts.green') : undefined,
    );

    // Open project when the tab is clicked
    this.command = {
      command: 'tabs.switchTab',
      title: 'Switch to Project',
      arguments: [this],
    };
  }
}

/** Human-readable label for a folder: its name, else its path. */
export function folderLabel(folder: ProjectFolder): string {
  if (folder.name) {
    return folder.name;
  }
  try {
    const uri = vscode.Uri.parse(folder.uri);
    return uri.scheme === 'file' ? uri.fsPath : uri.toString();
  } catch {
    return folder.uri;
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
    // Don't persist during activation — only reflect what is already open.
    this.detectActiveTab(false);

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
    this.activeTabId = this.context.globalState.get<string | null>(
      'tabs.activeTabId',
      null,
    );

    const raw = this.context.globalState.get<any[]>('tabs.projectTabs', []);
    this.tabs = raw
      .map((t) => this.normalizeStoredTab(t))
      .filter((t): t is ProjectTab => t !== undefined);

    if (this.tabs.length === 0) {
      this.migrateLegacyFormats();
      if (this.tabs.length > 0) {
        void this.save();
      }
    } else if (raw.some((t) => !Array.isArray(t?.folders))) {
      // At least one v1 entry (single `path`) was upgraded to the folders shape.
      void this.save();
    }
  }

  /** Accepts both the current {folders} shape and the legacy {path} shape. */
  private normalizeStoredTab(t: any): ProjectTab | undefined {
    if (!t || typeof t !== 'object') {
      return undefined;
    }
    const id = typeof t.id === 'string' && t.id ? t.id : this.genId();

    if (Array.isArray(t.folders)) {
      const folders = this.normalizeFolders(t.folders);
      if (folders.length === 0) {
        return undefined;
      }
      return { id, name: t.name || folderLabel(folders[0]), folders };
    }

    if (typeof t.path === 'string' && t.path) {
      return {
        id,
        name: t.name || path.basename(t.path),
        folders: [
          {
            uri: vscode.Uri.file(t.path).toString(),
            name: path.basename(t.path),
          },
        ],
      };
    }
    return undefined;
  }

  private normalizeFolders(list: any[]): ProjectFolder[] {
    const out: ProjectFolder[] = [];
    for (const f of list) {
      if (!f) {
        continue;
      }
      if (typeof f.uri === 'string' && f.uri) {
        out.push({ uri: f.uri, name: f.name });
      } else if (typeof f.path === 'string' && f.path) {
        out.push({
          uri: vscode.Uri.file(f.path).toString(),
          name: f.name || path.basename(f.path),
        });
      }
    }
    return out;
  }

  private migrateLegacyFormats(): void {
    const oldTabs = this.context.globalState.get<any[]>('tabs.tabs', []);
    if (oldTabs.length > 0) {
      for (const tab of oldTabs) {
        const folders = this.normalizeFolders(
          tab.folders || tab.projects || [],
        );
        if (folders.length > 0) {
          this.tabs.push({
            id: this.genId(),
            name: tab.name || folderLabel(folders[0]),
            folders,
          });
        }
      }
      return;
    }
    const oldProjects = this.context.globalState.get<any[]>(
      'tabs.projects',
      [],
    );
    for (const p of oldProjects) {
      const folders = this.normalizeFolders([p]);
      if (folders.length > 0) {
        this.tabs.push({
          id: this.genId(),
          name: p.name || folderLabel(folders[0]),
          folders,
        });
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

  // ── URI helpers ────────────────────────────────────────

  /** Canonical key for comparing folder URIs (drops query/fragment and a
   *  trailing slash; case-folds on case-insensitive platforms). */
  private uriKey(uriStr: string): string {
    try {
      let s = vscode.Uri.parse(uriStr)
        .with({ query: '', fragment: '' })
        .toString();
      if (s.length > 1 && s.endsWith('/')) {
        s = s.slice(0, -1);
      }
      return process.platform === 'win32' ? s.toLowerCase() : s;
    } catch {
      return uriStr;
    }
  }

  private sameFolderSet(a: string[], b: string[]): boolean {
    if (a.length === 0 || a.length !== b.length) {
      return false;
    }
    const keys = new Set(b.map((u) => this.uriKey(u)));
    return a.every((u) => keys.has(this.uriKey(u)));
  }

  /** URI strings of the folders currently open in the workspace. */
  private currentWorkspaceUris(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) =>
      f.uri.toString(),
    );
  }

  /** True when the workspace shows exactly this project's folders. */
  private workspaceMatchesTab(tab: ProjectTab): boolean {
    return this.sameFolderSet(
      tab.folders.map((f) => f.uri),
      this.currentWorkspaceUris(),
    );
  }

  private tabFolderUris(tab: ProjectTab): vscode.Uri[] {
    const uris: vscode.Uri[] = [];
    for (const f of tab.folders) {
      try {
        uris.push(vscode.Uri.parse(f.uri));
      } catch {
        // skip unparseable entry
      }
    }
    return uris;
  }

  /** True when `uri` is one of `folders` or nested under one of them. */
  private uriUnderFolders(uri: vscode.Uri, folders: vscode.Uri[]): boolean {
    const ci = process.platform === 'win32';
    const target = ci ? uri.path.toLowerCase() : uri.path;
    return folders.some((folder) => {
      if (uri.scheme !== folder.scheme || uri.authority !== folder.authority) {
        return false;
      }
      const base = ci ? folder.path.toLowerCase() : folder.path;
      const rel = path.posix.relative(base, target);
      return (
        rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel))
      );
    });
  }

  /** Name/URI of the first folder that can't be reached, or undefined. */
  private async firstMissingFolder(
    tab: ProjectTab,
  ): Promise<string | undefined> {
    for (const f of tab.folders) {
      let uri: vscode.Uri;
      try {
        uri = vscode.Uri.parse(f.uri);
      } catch {
        return f.name ?? f.uri;
      }
      // Only verify local folders; a remote FS provider may legitimately be
      // absent right now (not connected) without the folder being gone.
      if (uri.scheme !== 'file') {
        continue;
      }
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if ((stat.type & vscode.FileType.Directory) === 0) {
          return f.name ?? uri.fsPath;
        }
      } catch {
        return f.name ?? uri.fsPath;
      }
    }
    return undefined;
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

  /** Find the active tab from the folders currently open in the workspace. */
  private detectActiveTab(persist = true): void {
    const wsUris = this.currentWorkspaceUris();
    const match =
      wsUris.length > 0
        ? this.tabs.find((t) =>
            this.sameFolderSet(
              t.folders.map((f) => f.uri),
              wsUris,
            ),
          )
        : undefined;

    // No match means a worktree, an unrelated folder, or a workspace we don't
    // track — no tab is active. A stale activeTabId here is what makes the
    // next switch overwrite another project's saved session.
    const next = match?.id ?? null;
    if (next !== this.activeTabId) {
      this.activeTabId = next;
      if (persist) {
        void this.save();
      }
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
    if (tab.folders.length === 0) {
      vscode.window.showErrorMessage(`"${tab.name}" has no folders.`);
      return;
    }
    const missing = await this.firstMissingFolder(tab);
    if (missing) {
      vscode.window.showErrorMessage(`Folder "${missing}" does not exist.`);
      return;
    }
    if (tab.id === this.activeTabId) {
      return;
    }

    // The workspace already shows this project's folders (adopted from a git
    // worktree checkout, just added, etc.) — adopt without the close/swap dance.
    if (this.workspaceMatchesTab(tab)) {
      this.activeTabId = tab.id;
      await this.save();
      this._onDidChangeTabs.fire();
      return;
    }

    // 1) Save the current session, but only into the slot of the tab whose
    //    folders are actually open. If an unrelated folder (worktree, etc.) is
    //    open, activeTabId may be stale and saving here would clobber another
    //    project's session.
    const previousActiveId = this.activeTabId;
    const activeTab = previousActiveId
      ? this.tabs.find((t) => t.id === previousActiveId)
      : undefined;
    if (activeTab && this.workspaceMatchesTab(activeTab)) {
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

    // 5) Swap the workspace to this project's folders.
    const wsCount = vscode.workspace.workspaceFolders?.length ?? 0;
    const applied = vscode.workspace.updateWorkspaceFolders(
      0,
      wsCount,
      ...tab.folders.map((f) => ({
        uri: vscode.Uri.parse(f.uri),
        name: f.name,
      })),
    );
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
    if (!tab || !this.workspaceMatchesTab(tab)) {
      return; // workspace is not (yet) on the target project
    }

    const folderUris = this.tabFolderUris(tab);
    for (const uriStr of pending.uris) {
      try {
        const uri = vscode.Uri.parse(uriStr);
        // Keep only files under one of this project's folders; anything else
        // is leftover from a session that was mis-saved against this slot.
        if (!this.uriUnderFolders(uri, folderUris)) {
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

  // ── Save current workspace as a project ───────────

  async saveCurrentAsTab(): Promise<void> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      vscode.window.showWarningMessage('No folder is open.');
      return;
    }

    const folders: ProjectFolder[] = wsFolders.map((wf) => ({
      uri: wf.uri.toString(),
      name: wf.name,
    }));

    const existing = this.tabs.find((t) =>
      this.sameFolderSet(
        t.folders.map((f) => f.uri),
        folders.map((f) => f.uri),
      ),
    );
    if (existing) {
      this.activeTabId = existing.id;
      await this.save();
      this.refresh();
      vscode.window.showInformationMessage(
        `This workspace is already saved as "${existing.name}".`,
      );
      return;
    }

    const names = folders.map(folderLabel);
    const name = await vscode.window.showInputBox({
      prompt: 'Project name',
      value: names.length === 1 ? names[0] : names.join(' + '),
    });
    if (!name) {
      return;
    }

    const id = this.genId();
    this.tabs.push({ id, name, folders });
    this.activeTabId = id;
    await this.save();
    this.refresh();
    this._onDidChangeTabs.fire();
    vscode.window.showInformationMessage(
      `Saved current workspace as "${name}".`,
    );
  }

  // ── Tab CRUD ───────────────────────────────────────────

  async addTab(): Promise<void> {
    const configuredFolder = vscode.workspace
      .getConfiguration('tabs')
      .get<string>('defaultFolder');
    const defaultPath =
      configuredFolder && configuredFolder.trim() !== ''
        ? configuredFolder
        : os.homedir();
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: true,
      openLabel: 'Add Project Folder(s)',
      defaultUri: vscode.Uri.file(defaultPath),
    });
    if (!picked || picked.length === 0) {
      return;
    }

    // Multiple folders picked in one action become one multi-root project.
    const folders: ProjectFolder[] = picked.map((uri) => ({
      uri: uri.toString(),
      name: path.basename(uri.fsPath) || uri.toString(),
    }));

    const existing = this.tabs.find((t) =>
      this.sameFolderSet(
        t.folders.map((f) => f.uri),
        folders.map((f) => f.uri),
      ),
    );
    if (existing) {
      vscode.window.showWarningMessage(`Already added as "${existing.name}".`);
      await this.switchProject(existing.id);
      return;
    }

    const names = folders.map(folderLabel);
    const name = await vscode.window.showInputBox({
      prompt: 'Project name',
      value: names.length === 1 ? names[0] : names.join(' + '),
    });
    if (!name) {
      return;
    }

    const id = this.genId();
    this.tabs.push({ id, name, folders });
    await this.save();
    this.refresh();
    this._onDidChangeTabs.fire();

    await this.switchProject(id);
  }

  async removeTab(item: TabTreeItem): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `Remove project "${item.tab.name}"?`,
      { modal: true },
      'Remove',
    );
    if (answer !== 'Remove') {
      return;
    }

    const wasActive = this.activeTabId === item.tab.id;
    const wasOpen = this.workspaceMatchesTab(item.tab);

    this.tabs = this.tabs.filter((t) => t.id !== item.tab.id);
    await this.forgetSession(item.tab.id);
    if (wasActive) {
      this.activeTabId = null;
    }
    await this.save();
    this.refresh();
    this._onDidChangeTabs.fire();

    // Only touch the workspace if the removed project was the open one.
    if (!wasOpen) {
      return;
    }
    if (this.tabs.length > 0) {
      await this.switchProject(this.tabs[0].id);
    } else {
      vscode.workspace.updateWorkspaceFolders(
        0,
        vscode.workspace.workspaceFolders?.length ?? 0,
      );
    }
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

    for (const t of this.tabs) {
      await this.forgetSession(t.id);
    }
    await this.context.globalState.update('tabs.pendingRestore', undefined);
    this.tabs = [];
    this.activeTabId = null;

    vscode.workspace.updateWorkspaceFolders(
      0,
      vscode.workspace.workspaceFolders?.length ?? 0,
    );

    await this.save();
    this.refresh();
    this._onDidChangeTabs.fire();
  }

  /** Drop the persisted editor session for a tab that no longer exists. */
  private async forgetSession(tabId: string): Promise<void> {
    await this.context.globalState.update(`tabs.openFiles.${tabId}`, undefined);
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
