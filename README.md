# Advanced Multi-Root

**Manage multiple projects in a single VS Code window with tabs.**

This project is a fork of **VSC Tab**. **Advanced Multi-Root** allows you to work with multiple projects in the same window without needing to open them all at once. It enables easy navigation between them through tabs, keeping your open files and terminals memorized for each project individually.

## Features

- **Simplified Navigation** — Switch between projects instantly in the sidebar or via the status bar.
- **Session Memory** — When switching projects, your open files and terminals are kept in memory. Return to the project and pick up exactly where you left off.
- **Organization** — Easily add, rename, or remove projects from your list.
- **Save Current Folder** — Turn the folder you currently have open into a project in the list with a single click.

## How to Use

1. Click the **Tabs** icon in the Activity Bar (sidebar).
2. Click the **"+"** icon to browse and add a project folder.
3. Click on any listed project to switch your workspace.
4. Use the inline buttons next to items to rename or remove projects.

## Commands

The following commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) or interface shortcuts:

| Command                                               | Command ID              | Description                                                    |
|-------------------------------------------------------|-------------------------|----------------------------------------------------------------|
| `Advanced Multi-Root: Add Project`                    | `tabs.addTab`           | Add a new project to the list.                                 |
| `Advanced Multi-Root: Remove All Projects`            | `tabs.removeAll`        | Remove all projects from the list.                             |
| `Advanced Multi-Root: Remove Project`                 | `tabs.removeTab`        | Remove the selected project.                                   |
| `Advanced Multi-Root: Rename Project`                 | `tabs.renameTab`        | Rename the selected project tab.                               |
| `Advanced Multi-Root: Open Project`                   | `tabs.switchTab`        | Open / switch to the selected project.                         |
| `Advanced Multi-Root: Switch to Project by ID`        | `tabs.switchTabById`    | Switch to a specific project (internal use in the status bar). |
| `Advanced Multi-Root: Save Current Folder as Project` | `tabs.saveCurrentAsTab` | Save the active workspace folder as a project.                 |
| `Advanced Multi-Root: Refresh Projects`               | `tabs.refresh`          | Refresh the project list in the interface.                     |
| `Advanced Multi-Root: Settings`                       | `tabs.openSettings`     | Open extension settings (set default folder).                  |

## License

[MIT](LICENSE)
