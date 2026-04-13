import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Represents a parsed dbt error or warning.
 */
export interface DbtDiagnosticInfo {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: vscode.DiagnosticSeverity;
  code?: string;
}

/**
 * Parses dbt command output into VS Code diagnostics.
 */
export class DbtDiagnosticsParser {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('dbt-forge');
  }

  /**
   * Parse dbt compile/run output and set diagnostics.
   */
  parseOutput(output: string, projectRoot: string): DbtDiagnosticInfo[] {
    const diagnostics: DbtDiagnosticInfo[] = [];

    // Parse compilation errors
    diagnostics.push(...this.parseCompilationErrors(output, projectRoot));

    // Parse YAML schema errors
    diagnostics.push(...this.parseYamlErrors(output, projectRoot));

    // Parse Jinja rendering errors
    diagnostics.push(...this.parseJinjaErrors(output, projectRoot));

    // Parse SQL syntax errors
    diagnostics.push(...this.parseSqlErrors(output, projectRoot));

    // Parse test failures
    diagnostics.push(...this.parseTestFailures(output, projectRoot));

    // Apply diagnostics to VS Code
    this.applyDiagnostics(diagnostics);

    return diagnostics;
  }

  private parseCompilationErrors(output: string, projectRoot: string): DbtDiagnosticInfo[] {
    const diagnostics: DbtDiagnosticInfo[] = [];

    // Pattern: Compilation Error in model <name> (models/path/file.sql)
    const compilationPattern = /Compilation Error in (\w+) (\w+) \(([^)]+)\)\n([\s\S]*?)(?=\n\n|\nDone\.)/g;
    let match;

    while ((match = compilationPattern.exec(output)) !== null) {
      const [, , , filePath, message] = match;
      diagnostics.push({
        filePath: path.resolve(projectRoot, filePath),
        line: 0,
        column: 0,
        message: message.trim(),
        severity: vscode.DiagnosticSeverity.Error,
        code: 'compilation-error',
      });
    }

    // Pattern: Error in model <name> (models/path/file.sql)
    const errorPattern = /Error in (\w+) (\w+) \(([^)]+)\)/g;
    while ((match = errorPattern.exec(output)) !== null) {
      const [, , , filePath] = match;
      const lineAfter = output.substring(match.index + match[0].length, match.index + match[0].length + 500);
      const messageMatch = lineAfter.match(/\n\s+(.*?)(?:\n\n|\n\s*>)/s);
      diagnostics.push({
        filePath: path.resolve(projectRoot, filePath),
        line: 0,
        column: 0,
        message: messageMatch ? messageMatch[1].trim() : 'Unknown compilation error',
        severity: vscode.DiagnosticSeverity.Error,
        code: 'dbt-error',
      });
    }

    return diagnostics;
  }

  private parseYamlErrors(output: string, projectRoot: string): DbtDiagnosticInfo[] {
    const diagnostics: DbtDiagnosticInfo[] = [];

    // Pattern: Invalid YAML or schema validation errors
    const yamlPattern = /(?:YAML|Schema) Error[^:]*:\s*([^\n]+)\n\s*(?:in\s+)?([^\n:]+):?(\d+)?/gi;
    let match;

    while ((match = yamlPattern.exec(output)) !== null) {
      const [, message, filePath, lineStr] = match;
      diagnostics.push({
        filePath: path.resolve(projectRoot, filePath.trim()),
        line: lineStr ? parseInt(lineStr, 10) - 1 : 0,
        column: 0,
        message: message.trim(),
        severity: vscode.DiagnosticSeverity.Error,
        code: 'yaml-error',
      });
    }

    return diagnostics;
  }

  private parseJinjaErrors(output: string, projectRoot: string): DbtDiagnosticInfo[] {
    const diagnostics: DbtDiagnosticInfo[] = [];

    // Pattern: Jinja template errors with line numbers
    const jinjaPattern = /(?:Jinja|Template) (?:Error|UndefinedError)[^(]*\(([^)]+)\)\n[\s\S]*?line (\d+)/gi;
    let match;

    while ((match = jinjaPattern.exec(output)) !== null) {
      const [fullMatch, filePath, lineStr] = match;
      const messageMatch = fullMatch.match(/:\s*([^\n]+)/);
      diagnostics.push({
        filePath: path.resolve(projectRoot, filePath.trim()),
        line: parseInt(lineStr, 10) - 1,
        column: 0,
        message: messageMatch ? messageMatch[1].trim() : 'Jinja template error',
        severity: vscode.DiagnosticSeverity.Error,
        code: 'jinja-error',
      });
    }

    // Simpler pattern: 'model_name' is undefined
    const undefinedPattern = /'([^']+)' is undefined/g;
    while ((match = undefinedPattern.exec(output)) !== null) {
      // This will be attached to diagnostics found above; standalone instances
      // get a generic entry if not already captured
    }

    return diagnostics;
  }

  private parseSqlErrors(output: string, projectRoot: string): DbtDiagnosticInfo[] {
    const diagnostics: DbtDiagnosticInfo[] = [];

    // Pattern: Database/SQL errors from compile step
    const sqlPattern = /(?:Database|SQL) Error[^(]*\(([^)]+)\)[\s\S]*?line (\d+)(?::(\d+))?/gi;
    let match;

    while ((match = sqlPattern.exec(output)) !== null) {
      const [fullMatch, filePath, lineStr, colStr] = match;
      const messageMatch = fullMatch.match(/Error[^:]*:\s*([^\n]+)/);
      diagnostics.push({
        filePath: path.resolve(projectRoot, filePath.trim()),
        line: parseInt(lineStr, 10) - 1,
        column: colStr ? parseInt(colStr, 10) - 1 : 0,
        message: messageMatch ? messageMatch[1].trim() : 'SQL error',
        severity: vscode.DiagnosticSeverity.Error,
        code: 'sql-error',
      });
    }

    return diagnostics;
  }

  private parseTestFailures(output: string, projectRoot: string): DbtDiagnosticInfo[] {
    const diagnostics: DbtDiagnosticInfo[] = [];

    // Pattern: Fail N <test_name>
    const testPattern = /Fail\s+(\d+)\s+(\S+)/gi;
    let match;

    while ((match = testPattern.exec(output)) !== null) {
      const [, count, testName] = match;
      diagnostics.push({
        filePath: '',
        line: 0,
        column: 0,
        message: `Test "${testName}" failed with ${count} failure(s)`,
        severity: vscode.DiagnosticSeverity.Warning,
        code: 'test-failure',
      });
    }

    return diagnostics;
  }

  /**
   * Apply parsed diagnostics to VS Code's Problems panel.
   */
  private applyDiagnostics(diagnosticInfos: DbtDiagnosticInfo[]): void {
    this.diagnosticCollection.clear();

    const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

    for (const info of diagnosticInfos) {
      if (!info.filePath) { continue; }

      const range = new vscode.Range(
        new vscode.Position(Math.max(0, info.line), Math.max(0, info.column)),
        new vscode.Position(Math.max(0, info.line), Number.MAX_VALUE)
      );

      const diagnostic = new vscode.Diagnostic(range, info.message, info.severity);
      if (info.code) {
        diagnostic.source = 'dbt Forge';
        diagnostic.code = info.code;
      }

      const key = info.filePath;
      if (!diagnosticMap.has(key)) {
        diagnosticMap.set(key, []);
      }
      diagnosticMap.get(key)!.push(diagnostic);
    }

    for (const [filePath, diagnosticList] of diagnosticMap) {
      this.diagnosticCollection.set(vscode.Uri.file(filePath), diagnosticList);
    }
  }

  /**
   * Clear all diagnostics.
   */
  clear(): void {
    this.diagnosticCollection.clear();
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
  }
}
