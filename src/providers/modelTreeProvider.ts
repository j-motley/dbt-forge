import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DbtProject } from '../utils/dbtProject';
import { ModelStatus } from '../commands/compile';

/**
 * Tree view provider showing dbt models with their compilation status.
 * Appears in the dbt Forge sidebar panel.
 */
export class ModelTreeProvider implements vscode.TreeDataProvider<ModelTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ModelTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private modelStatuses = new Map<string, ModelStatus>();

  constructor(private dbtProject: DbtProject) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  updateModelStatus(modelName: string, status: ModelStatus): void {
    this.modelStatuses.set(modelName, status);
    this.refresh();
  }

  getTreeItem(element: ModelTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (!this.dbtProject.projectRoot) {
      return [new ModelTreeItem('No dbt project found', '', vscode.TreeItemCollapsibleState.None)];
    }

    if (!element) {
      // Root level: show model directories
      const modelPaths = this.dbtProject.getModelPaths();
      return modelPaths.map(mp => {
        const fullPath = path.join(this.dbtProject.projectRoot!, mp);
        const exists = fs.existsSync(fullPath);
        return new ModelTreeItem(
          mp,
          fullPath,
          exists ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
          'directory'
        );
      });
    }

    // Child level: show files and subdirectories
    if (!fs.existsSync(element.resourcePath)) {
      return [];
    }

    const entries = fs.readdirSync(element.resourcePath, { withFileTypes: true });
    const items: ModelTreeItem[] = [];

    // Directories first
    for (const entry of entries.filter(e => e.isDirectory())) {
      if (entry.name.startsWith('.') || entry.name === '__pycache__') { continue; }
      items.push(new ModelTreeItem(
        entry.name,
        path.join(element.resourcePath, entry.name),
        vscode.TreeItemCollapsibleState.Collapsed,
        'directory'
      ));
    }

    // Then SQL files
    for (const entry of entries.filter(e => e.isFile() && e.name.endsWith('.sql'))) {
      const modelName = path.basename(entry.name, '.sql');
      const status = this.modelStatuses.get(modelName) || 'idle';
      const filePath = path.join(element.resourcePath, entry.name);

      const item = new ModelTreeItem(
        modelName,
        filePath,
        vscode.TreeItemCollapsibleState.None,
        'model',
        status
      );

      item.command = {
        command: 'vscode.open',
        title: 'Open Model',
        arguments: [vscode.Uri.file(filePath)],
      };

      items.push(item);
    }

    // Then YAML files
    for (const entry of entries.filter(e => e.isFile() && (e.name.endsWith('.yml') || e.name.endsWith('.yaml')))) {
      const filePath = path.join(element.resourcePath, entry.name);
      const item = new ModelTreeItem(
        entry.name,
        filePath,
        vscode.TreeItemCollapsibleState.None,
        'schema'
      );

      item.command = {
        command: 'vscode.open',
        title: 'Open Schema',
        arguments: [vscode.Uri.file(filePath)],
      };

      items.push(item);
    }

    return items;
  }
}

export class ModelTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly resourcePath: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType?: 'directory' | 'model' | 'schema',
    public readonly status?: ModelStatus
  ) {
    super(label, collapsibleState);

    this.tooltip = resourcePath;

    // Set context value for menu contributions
    this.contextValue = itemType || 'unknown';

    // Set icons based on type and status
    if (itemType === 'model') {
      this.iconPath = this.getModelIcon(status);
      this.description = this.getStatusDescription(status);
    } else if (itemType === 'schema') {
      this.iconPath = new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('charts.yellow'));
    } else if (itemType === 'directory') {
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }

  private getModelIcon(status?: ModelStatus): vscode.ThemeIcon {
    switch (status) {
      case 'compiling':
      case 'testing':
        return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
      case 'success':
      case 'test-pass':
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'error':
      case 'test-fail':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      default:
        return new vscode.ThemeIcon('file-code', new vscode.ThemeColor('foreground'));
    }
  }

  private getStatusDescription(status?: ModelStatus): string {
    switch (status) {
      case 'compiling': return '⟳ compiling...';
      case 'testing': return '⟳ testing...';
      case 'success': return '✓ compiled';
      case 'error': return '✗ error';
      case 'test-pass': return '✓ tests pass';
      case 'test-fail': return '✗ tests fail';
      default: return '';
    }
  }
}

/**
 * Provides file decoration (status badges) for model files in the Explorer.
 */
export class ModelFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private modelStatuses = new Map<string, ModelStatus>();
  private dbtProject: DbtProject;

  constructor(dbtProject: DbtProject) {
    this.dbtProject = dbtProject;
  }

  updateStatus(modelName: string, status: ModelStatus, filePath?: string): void {
    this.modelStatuses.set(modelName, status);
    if (filePath) {
      this._onDidChangeFileDecorations.fire(vscode.Uri.file(filePath));
    }
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!uri.fsPath.endsWith('.sql')) { return undefined; }
    if (!this.dbtProject.isModelFile(uri.fsPath)) { return undefined; }

    const modelName = this.dbtProject.getModelName(uri.fsPath);
    if (!modelName) { return undefined; }

    const status = this.modelStatuses.get(modelName);
    if (!status || status === 'idle') { return undefined; }

    switch (status) {
      case 'success':
      case 'test-pass':
        return {
          badge: '✓',
          color: new vscode.ThemeColor('charts.green'),
          tooltip: 'Compiled successfully',
        };
      case 'error':
      case 'test-fail':
        return {
          badge: '✗',
          color: new vscode.ThemeColor('charts.red'),
          tooltip: 'Compilation error',
        };
      case 'compiling':
      case 'testing':
        return {
          badge: '⟳',
          color: new vscode.ThemeColor('charts.blue'),
          tooltip: 'Compiling...',
        };
      default:
        return undefined;
    }
  }
}
