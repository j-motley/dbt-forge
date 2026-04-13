import * as vscode from 'vscode';
import { PythonEnvironment } from '../python/pythonEnvironment';
import { DbtProject } from '../utils/dbtProject';
import { DbtDiagnosticsParser } from '../utils/diagnostics';
import { ModelStatus } from './compile';

/**
 * Handles `dbt run` in compile-only mode.
 * This compiles the models (resolves all refs, sources, macros, Jinja)
 * and validates them, but does NOT execute SQL against any database.
 *
 * This catches:
 * - Jinja template errors
 * - Missing ref() / source() references
 * - Macro argument errors
 * - Invalid YAML schema definitions
 * - Circular dependencies
 *
 * It will NOT catch:
 * - SQL syntax errors specific to a database dialect
 * - Missing columns/tables at runtime
 * - Data type mismatches
 */
export class RunCommand {
  constructor(
    private pythonEnv: PythonEnvironment,
    private dbtProject: DbtProject,
    private diagnosticsParser: DbtDiagnosticsParser,
    private outputChannel: vscode.OutputChannel,
    private onStatusChange: (model: string, status: ModelStatus) => void
  ) {}

  /**
   * Run (compile-only) all models.
   */
  async runAll(): Promise<void> {
    if (!this.dbtProject.projectRoot) {
      vscode.window.showErrorMessage('dbt Forge: No dbt project found.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine('\n═══ dbt run (compile-only mode) ═══\n');
    this.outputChannel.appendLine('Note: Models are compiled but NOT executed against any database.\n');
    this.diagnosticsParser.clear();

    try {
      const args = ['compile', '--no-partial-parse'];

      const target = this.getTarget();
      if (target) {
        args.push('--target', target);
      }

      const result = await this.pythonEnv.runDbt(args, this.dbtProject.projectRoot);

      if (result.exitCode === 0) {
        // Parse the output to count models
        const modelCount = this.countCompiledModels(result.stdout);
        this.outputChannel.appendLine(`\n✓ ${modelCount} model(s) compiled successfully (dry run)`);
        vscode.window.showInformationMessage(
          `dbt Forge: ${modelCount} model(s) compiled successfully. No database execution performed.`
        );
      } else {
        const diagnostics = this.diagnosticsParser.parseOutput(
          result.stdout + result.stderr,
          this.dbtProject.projectRoot
        );

        const errorCount = diagnostics.length;
        vscode.window.showErrorMessage(
          `dbt Forge: Compilation failed with ${errorCount} error(s). Check Problems panel.`
        );
      }
    } catch (err: any) {
      this.outputChannel.appendLine(`\n✗ Error: ${err.message}`);
      vscode.window.showErrorMessage(`dbt Forge: ${err.message}`);
    }
  }

  /**
   * Run (compile-only) the current model.
   */
  async runCurrentModel(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.sql')) {
      vscode.window.showWarningMessage('dbt Forge: Open a .sql model file to run.');
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
    this.outputChannel.appendLine(`\n═══ dbt run --select ${modelName} (compile-only) ═══\n`);
    this.onStatusChange(modelName, 'compiling');

    try {
      const args = ['compile', '--select', modelName];

      const target = this.getTarget();
      if (target) {
        args.push('--target', target);
      }

      const result = await this.pythonEnv.runDbt(args, this.dbtProject.projectRoot);

      if (result.exitCode === 0) {
        this.outputChannel.appendLine(`\n✓ ${modelName} compiled successfully (dry run)`);
        this.onStatusChange(modelName, 'success');
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

  private countCompiledModels(output: string): number {
    // dbt outputs "Found N models, N tests, ..." at the start
    const foundMatch = output.match(/Found (\d+) model/);
    return foundMatch ? parseInt(foundMatch[1], 10) : 0;
  }

  private getTarget(): string | undefined {
    const config = vscode.workspace.getConfiguration('dbtForge');
    return config.get<string>('defaultTarget') || this.dbtProject.getDefaultTarget();
  }
}
