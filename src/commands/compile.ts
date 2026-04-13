import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PythonEnvironment } from '../python/pythonEnvironment';
import { DbtProject } from '../utils/dbtProject';
import { DbtDiagnosticsParser } from '../utils/diagnostics';

/**
 * Handles `dbt compile` — renders Jinja templates into raw SQL
 * without executing anything against a database.
 */
export class CompileCommand {
  constructor(
    private pythonEnv: PythonEnvironment,
    private dbtProject: DbtProject,
    private diagnosticsParser: DbtDiagnosticsParser,
    private outputChannel: vscode.OutputChannel,
    private onStatusChange: (model: string, status: ModelStatus) => void
  ) {}

  /**
   * Compile all models in the project.
   */
  async compileAll(): Promise<void> {
    if (!this.dbtProject.projectRoot) {
      vscode.window.showErrorMessage('dbt Forge: No dbt project found in the workspace.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine('\n═══ dbt compile (all models) ═══\n');
    this.diagnosticsParser.clear();

    try {
      const args = ['compile', '--no-partial-parse'];

      const target = this.getTarget();
      if (target) {
        args.push('--target', target);
      }

      const result = await this.pythonEnv.runDbt(args, this.dbtProject.projectRoot);

      if (result.exitCode === 0) {
        this.outputChannel.appendLine('\n✓ Compilation succeeded');
        vscode.window.showInformationMessage('dbt Forge: Compilation succeeded.');
      } else {
        this.diagnosticsParser.parseOutput(
          result.stdout + result.stderr,
          this.dbtProject.projectRoot
        );
        vscode.window.showErrorMessage('dbt Forge: Compilation failed. Check the Problems panel.');
      }
    } catch (err: any) {
      this.outputChannel.appendLine(`\n✗ Error: ${err.message}`);
      vscode.window.showErrorMessage(`dbt Forge: ${err.message}`);
    }
  }

  /**
   * Compile the model currently open in the editor.
   */
  async compileCurrentModel(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.sql')) {
      vscode.window.showWarningMessage('dbt Forge: Open a .sql model file to compile.');
      return;
    }

    if (!this.dbtProject.projectRoot) {
      vscode.window.showErrorMessage('dbt Forge: No dbt project found.');
      return;
    }

    const modelName = this.dbtProject.getModelName(editor.document.fileName);
    if (!modelName) {
      vscode.window.showWarningMessage('dbt Forge: This file is not inside a model directory.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine(`\n═══ dbt compile --select ${modelName} ═══\n`);
    this.onStatusChange(modelName, 'compiling');

    try {
      const args = ['compile', '--select', modelName];

      const target = this.getTarget();
      if (target) {
        args.push('--target', target);
      }

      const result = await this.pythonEnv.runDbt(args, this.dbtProject.projectRoot);

      if (result.exitCode === 0) {
        this.outputChannel.appendLine(`\n✓ ${modelName} compiled successfully`);
        this.onStatusChange(modelName, 'success');

        // Show compiled SQL in a side panel
        await this.showCompiledSql(modelName);
      } else {
        this.diagnosticsParser.parseOutput(
          result.stdout + result.stderr,
          this.dbtProject.projectRoot
        );
        this.onStatusChange(modelName, 'error');
      }
    } catch (err: any) {
      this.outputChannel.appendLine(`\n✗ Error: ${err.message}`);
      this.onStatusChange(modelName, 'error');
    }
  }

  /**
   * Open the compiled SQL for a model in a read-only editor.
   */
  async showCompiledSql(modelName?: string): Promise<void> {
    if (!modelName) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        modelName = this.dbtProject.getModelName(editor.document.fileName);
      }
    }

    if (!modelName || !this.dbtProject.projectRoot) { return; }

    const targetPath = this.dbtProject.getTargetPath();
    const compiledDir = path.join(this.dbtProject.projectRoot, targetPath, 'compiled');

    // Search for compiled SQL file
    const compiledFile = await this.findCompiledFile(compiledDir, modelName);
    if (compiledFile && fs.existsSync(compiledFile)) {
      const doc = await vscode.workspace.openTextDocument(compiledFile);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: true,
      });
    } else {
      this.outputChannel.appendLine(`Could not find compiled SQL for ${modelName}`);
    }
  }

  private async findCompiledFile(compiledDir: string, modelName: string): Promise<string | undefined> {
    if (!fs.existsSync(compiledDir)) { return undefined; }

    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(compiledDir, `**/${modelName}.sql`),
      null,
      1
    );

    return files.length > 0 ? files[0].fsPath : undefined;
  }

  private getTarget(): string | undefined {
    const config = vscode.workspace.getConfiguration('dbtForge');
    return config.get<string>('defaultTarget') || this.dbtProject.getDefaultTarget();
  }
}

export type ModelStatus = 'idle' | 'compiling' | 'success' | 'error' | 'testing' | 'test-pass' | 'test-fail';
