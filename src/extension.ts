import * as vscode from 'vscode';
import { PythonEnvironment } from './python/pythonEnvironment';
import { DbtProject } from './utils/dbtProject';
import { DbtDiagnosticsParser } from './utils/diagnostics';
import { CompileCommand, ModelStatus } from './commands/compile';
import { TestCommand } from './commands/test';
import { RunCommand } from './commands/run';
import { ModelTreeProvider, ModelFileDecorationProvider } from './providers/modelTreeProvider';

let outputChannel: vscode.OutputChannel;
let pythonEnv: PythonEnvironment;
let dbtProject: DbtProject;
let diagnosticsParser: DbtDiagnosticsParser;
let modelTreeProvider: ModelTreeProvider;
let fileDecorationProvider: ModelFileDecorationProvider;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('dbt Forge');
  outputChannel.appendLine('dbt Forge is activating...');

  // Initialize core components
  dbtProject = new DbtProject();
  diagnosticsParser = new DbtDiagnosticsParser();
  pythonEnv = new PythonEnvironment(context.extensionPath, outputChannel);

  // Discover the dbt project
  const hasProject = await dbtProject.discover();
  if (hasProject) {
    outputChannel.appendLine(`Found dbt project: ${dbtProject.config?.name} at ${dbtProject.projectRoot}`);
    vscode.commands.executeCommand('setContext', 'dbtForge.isActive', true);
  } else {
    outputChannel.appendLine('No dbt project found in workspace.');
  }

  // Check for existing Python environment
  const envExists = await pythonEnv.checkExisting();
  if (envExists) {
    outputChannel.appendLine('Existing Python environment found and valid.');
  }

  // Status change handler that updates both tree view and file decorations
  const onStatusChange = (model: string, status: ModelStatus) => {
    modelTreeProvider.updateModelStatus(model, status);
    fileDecorationProvider.updateStatus(model, status);
  };

  // Initialize command handlers
  const compileCmd = new CompileCommand(pythonEnv, dbtProject, diagnosticsParser, outputChannel, onStatusChange);
  const testCmd = new TestCommand(pythonEnv, dbtProject, diagnosticsParser, outputChannel, onStatusChange);
  const runCmd = new RunCommand(pythonEnv, dbtProject, diagnosticsParser, outputChannel, onStatusChange);

  // Tree view provider
  modelTreeProvider = new ModelTreeProvider(dbtProject);
  const treeView = vscode.window.createTreeView('dbtForge.models', {
    treeDataProvider: modelTreeProvider,
    showCollapseAll: true,
  });

  // File decoration provider (status badges in Explorer)
  fileDecorationProvider = new ModelFileDecorationProvider(dbtProject);
  const config = vscode.workspace.getConfiguration('dbtForge');
  if (config.get<boolean>('showStatusInExplorer')) {
    context.subscriptions.push(
      vscode.window.registerFileDecorationProvider(fileDecorationProvider)
    );
  }

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(database) dbt Forge';
  statusBarItem.tooltip = hasProject
    ? `dbt project: ${dbtProject.config?.name}`
    : 'No dbt project found';
  statusBarItem.command = 'dbtForge.selectTarget';
  statusBarItem.show();

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('dbtForge.compile', () => compileCmd.compileAll()),
    vscode.commands.registerCommand('dbtForge.compileModel', () => compileCmd.compileCurrentModel()),
    vscode.commands.registerCommand('dbtForge.test', () => testCmd.testAll()),
    vscode.commands.registerCommand('dbtForge.testModel', () => testCmd.testCurrentModel()),
    vscode.commands.registerCommand('dbtForge.run', () => runCmd.runAll()),
    vscode.commands.registerCommand('dbtForge.runModel', () => runCmd.runCurrentModel()),
    vscode.commands.registerCommand('dbtForge.showCompiledSql', () => compileCmd.showCompiledSql()),

    vscode.commands.registerCommand('dbtForge.init', async () => {
      const success = await pythonEnv.initialize();
      if (success) {
        vscode.window.showInformationMessage('dbt Forge: Python environment initialized successfully.');
        modelTreeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('dbtForge.selectTarget', async () => {
      const targets = dbtProject.getTargets();
      if (targets.length === 0) {
        vscode.window.showWarningMessage('dbt Forge: No targets found in profiles.yml.');
        return;
      }

      const defaultTarget = dbtProject.getDefaultTarget();
      const items = targets.map(t => ({
        label: t,
        description: t === defaultTarget ? '(default)' : undefined,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a dbt target profile',
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration('dbtForge');
        await config.update('defaultTarget', selected.label, vscode.ConfigurationTarget.Workspace);
        statusBarItem.text = `$(database) dbt: ${selected.label}`;
        vscode.window.showInformationMessage(`dbt Forge: Target set to "${selected.label}".`);
      }
    }),
  );

  // Auto-compile on save (if enabled)
  if (config.get<boolean>('compileOnSave')) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.fileName.endsWith('.sql') && dbtProject.isModelFile(doc.fileName)) {
          await compileCmd.compileCurrentModel();
        }
      })
    );
  }

  // Watch for dbt_project.yml changes
  const projectWatcher = vscode.workspace.createFileSystemWatcher('**/dbt_project.{yml,yaml}');
  projectWatcher.onDidChange(async () => {
    await dbtProject.discover();
    modelTreeProvider.refresh();
  });
  context.subscriptions.push(projectWatcher);

  // Watch for schema YAML changes
  const schemaWatcher = vscode.workspace.createFileSystemWatcher('**/models/**/*.{yml,yaml}');
  schemaWatcher.onDidChange(() => modelTreeProvider.refresh());
  schemaWatcher.onDidCreate(() => modelTreeProvider.refresh());
  schemaWatcher.onDidDelete(() => modelTreeProvider.refresh());
  context.subscriptions.push(schemaWatcher);

  // Disposables
  context.subscriptions.push(
    outputChannel,
    diagnosticsParser,
    treeView,
    statusBarItem,
  );

  outputChannel.appendLine('dbt Forge activated successfully.');
}

export function deactivate() {
  outputChannel?.appendLine('dbt Forge deactivated.');
}
