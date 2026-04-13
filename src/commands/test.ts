import * as vscode from 'vscode';
import { PythonEnvironment } from '../python/pythonEnvironment';
import { DbtProject } from '../utils/dbtProject';
import { DbtDiagnosticsParser } from '../utils/diagnostics';
import { ModelStatus } from './compile';

/**
 * Handles `dbt test` — validates schema tests and data tests.
 * In compile-only mode, this compiles the test SQL and validates
 * the test definitions without executing against a database.
 */
export class TestCommand {
  constructor(
    private pythonEnv: PythonEnvironment,
    private dbtProject: DbtProject,
    private diagnosticsParser: DbtDiagnosticsParser,
    private outputChannel: vscode.OutputChannel,
    private onStatusChange: (model: string, status: ModelStatus) => void
  ) {}

  /**
   * Run all tests in the project (compile-only — validates definitions).
   */
  async testAll(): Promise<void> {
    if (!this.dbtProject.projectRoot) {
      vscode.window.showErrorMessage('dbt Forge: No dbt project found.');
      return;
    }

    this.outputChannel.show(true);
    this.outputChannel.appendLine('\n═══ dbt test (compile-only validation) ═══\n');
    this.diagnosticsParser.clear();

    try {
      // Use `dbt compile --select test_type:*` to compile test SQL
      // This validates all test definitions, refs, and sources without executing
      const args = ['compile', '--select', 'test_type:schema', 'test_type:data'];

      const target = this.getTarget();
      if (target) {
        args.push('--target', target);
      }

      const result = await this.pythonEnv.runDbt(args, this.dbtProject.projectRoot);

      if (result.exitCode === 0) {
        this.outputChannel.appendLine('\n✓ All test definitions are valid');
        vscode.window.showInformationMessage('dbt Forge: All test definitions compiled successfully.');
      } else {
        const diagnostics = this.diagnosticsParser.parseOutput(
          result.stdout + result.stderr,
          this.dbtProject.projectRoot
        );

        const errorCount = diagnostics.length;
        vscode.window.showErrorMessage(
          `dbt Forge: ${errorCount} test definition error(s) found. Check Problems panel.`
        );
      }
    } catch (err: any) {
      this.outputChannel.appendLine(`\n✗ Error: ${err.message}`);
      vscode.window.showErrorMessage(`dbt Forge: ${err.message}`);
    }
  }

  /**
   * Test the model currently open in the editor.
   */
  async testCurrentModel(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith('.sql')) {
      vscode.window.showWarningMessage('dbt Forge: Open a .sql model file to test.');
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
    this.outputChannel.appendLine(`\n═══ dbt test --select ${modelName} (compile-only) ═══\n`);
    this.onStatusChange(modelName, 'testing');

    try {
      // Compile the tests for this specific model
      const args = ['compile', '--select', `${modelName},test_type:schema`, '--indirect-selection', 'eager'];

      const target = this.getTarget();
      if (target) {
        args.push('--target', target);
      }

      const result = await this.pythonEnv.runDbt(args, this.dbtProject.projectRoot);

      if (result.exitCode === 0) {
        this.outputChannel.appendLine(`\n✓ Tests for ${modelName} compiled successfully`);
        this.onStatusChange(modelName, 'test-pass');
        vscode.window.showInformationMessage(`dbt Forge: Test definitions for "${modelName}" are valid.`);
      } else {
        this.diagnosticsParser.parseOutput(
          result.stdout + result.stderr,
          this.dbtProject.projectRoot
        );
        this.onStatusChange(modelName, 'test-fail');
      }
    } catch (err: any) {
      this.outputChannel.appendLine(`\n✗ Error: ${err.message}`);
      this.onStatusChange(modelName, 'error');
    }
  }

  private getTarget(): string | undefined {
    const config = vscode.workspace.getConfiguration('dbtForge');
    return config.get<string>('defaultTarget') || this.dbtProject.getDefaultTarget();
  }
}
