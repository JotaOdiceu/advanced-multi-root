import * as vscode from 'vscode';

/** In-memory stand-in for ExtensionContext.globalState. */
class FakeMemento implements vscode.Memento {
  private store = new Map<string, unknown>();

  constructor(seed: Record<string, unknown> = {}) {
    for (const [k, v] of Object.entries(seed)) {
      this.store.set(k, v);
    }
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }

  setKeysForSync(): void {
    /* no-op */
  }
}

/** Minimal ExtensionContext: ProjectsProvider only touches globalState. */
export function makeContext(
  seed: Record<string, unknown> = {},
): vscode.ExtensionContext {
  return {
    subscriptions: [],
    globalState: new FakeMemento(seed),
    workspaceState: new FakeMemento(),
    extensionMode: vscode.ExtensionMode.Test,
  } as unknown as vscode.ExtensionContext;
}

/** file:// URI string for a path inside the test fixtures folder. */
export function fixtureUri(...segments: string[]): string {
  const root = vscode.workspace.workspaceFolders?.[0].uri;
  if (!root) {
    throw new Error('test runner opened without a workspace folder');
  }
  return vscode.Uri.joinPath(root, '..', ...segments).toString();
}

/** URI string of the folder the test runner opened (fixtures/project-a). */
export function openedWorkspaceUri(): string {
  const root = vscode.workspace.workspaceFolders?.[0].uri;
  if (!root) {
    throw new Error('test runner opened without a workspace folder');
  }
  return root.toString();
}
