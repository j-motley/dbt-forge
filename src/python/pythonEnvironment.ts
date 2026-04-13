import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Manages a self-contained Python virtual environment bundled with the extension.
 * Installs dbt-core and configured adapters automatically so users never need
 * to install Python or dbt themselves.
 */
export class PythonEnvironment {
  private envPath: string;
  private pythonBin: string;
  private dbtBin: string;
  private _ready: boolean = false;
  private _initializing: boolean = false;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private extensionPath: string,
    outputChannel: vscode.OutputChannel
  ) {
    this.envPath = path.join(extensionPath, '.dbt-forge-env');
    this.pythonBin = process.platform === 'win32'
      ? path.join(this.envPath, 'Scripts', 'python.exe')
      : path.join(this.envPath, 'bin', 'python');
    this.dbtBin = process.platform === 'win32'
      ? path.join(this.envPath, 'Scripts', 'dbt.exe')
      : path.join(this.envPath, 'bin', 'dbt');
    this.outputChannel = outputChannel;
  }

  get isReady(): boolean {
    return this._ready;
  }

  get dbtPath(): string {
    return this.dbtBin;
  }

  get pythonPath(): string {
    return this.pythonBin;
  }

  /**
   * Find a working Python 3 interpreter on the system.
   */
  private async findSystemPython(): Promise<string | undefined> {
    const candidates = process.platform === 'win32'
      ? ['python', 'python3', 'py -3']
      : ['python3', 'python'];

    for (const candidate of candidates) {
      try {
        const { stdout } = await execFileAsync(candidate, ['--version']);
        if (stdout.includes('Python 3')) {
          this.outputChannel.appendLine(`Found system Python: ${candidate} -> ${stdout.trim()}`);
          return candidate;
        }
      } catch {
        // Try next candidate
      }
    }
    return undefined;
  }

  /**
   * Initialize the Python virtual environment and install dbt + adapters.
   * Shows progress notification to the user.
   */
  async initialize(): Promise<boolean> {
    if (this._ready) { return true; }
    if (this._initializing) { return false; }

    this._initializing = true;

    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'dbt Forge',
          cancellable: true,
        },
        async (progress, token) => {
          // Check for custom Python path first
          const config = vscode.workspace.getConfiguration('dbtForge');
          const customPython = config.get<string>('pythonPath');

          let pythonCmd: string;
          if (customPython && fs.existsSync(customPython)) {
            pythonCmd = customPython;
            this.outputChannel.appendLine(`Using custom Python: ${customPython}`);
          } else {
            const systemPython = await this.findSystemPython();
            if (!systemPython) {
              vscode.window.showErrorMessage(
                'dbt Forge: Python 3 not found. Please install Python 3.9+ or set dbtForge.pythonPath.',
                'Install Python'
              ).then(selection => {
                if (selection === 'Install Python') {
                  vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
                }
              });
              return false;
            }
            pythonCmd = systemPython;
          }

          if (token.isCancellationRequested) { return false; }

          // Step 1: Create virtual environment
          progress.report({ message: 'Creating Python environment...', increment: 10 });
          this.outputChannel.appendLine(`Creating venv at: ${this.envPath}`);

          if (!fs.existsSync(this.envPath)) {
            try {
              await execFileAsync(pythonCmd, ['-m', 'venv', this.envPath]);
            } catch (err: any) {
              this.outputChannel.appendLine(`Failed to create venv: ${err.message}`);
              vscode.window.showErrorMessage(`dbt Forge: Failed to create Python environment. ${err.message}`);
              return false;
            }
          }

          if (token.isCancellationRequested) { return false; }

          // Step 2: Upgrade pip
          progress.report({ message: 'Upgrading pip...', increment: 10 });
          try {
            await execFileAsync(this.pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip']);
          } catch (err: any) {
            this.outputChannel.appendLine(`Warning: Failed to upgrade pip: ${err.message}`);
          }

          if (token.isCancellationRequested) { return false; }

          // Step 3: Install dbt-core
          const dbtVersion = config.get<string>('dbtVersion') || '1.8.*';
          progress.report({ message: `Installing dbt-core ${dbtVersion}...`, increment: 20 });
          this.outputChannel.appendLine(`Installing dbt-core==${dbtVersion}`);

          try {
            await execFileAsync(this.pythonBin, [
              '-m', 'pip', 'install', '--quiet',
              `dbt-core==${dbtVersion}`
            ], { timeout: 300000 });
          } catch (err: any) {
            this.outputChannel.appendLine(`Failed to install dbt-core: ${err.message}`);
            vscode.window.showErrorMessage(`dbt Forge: Failed to install dbt-core. Check Output panel for details.`);
            return false;
          }

          if (token.isCancellationRequested) { return false; }

          // Step 4: Install adapters
          const adapters = config.get<string[]>('adapters') || [];
          if (adapters.length > 0) {
            progress.report({ message: `Installing adapters: ${adapters.join(', ')}...`, increment: 30 });
            this.outputChannel.appendLine(`Installing adapters: ${adapters.join(', ')}`);

            try {
              await execFileAsync(this.pythonBin, [
                '-m', 'pip', 'install', '--quiet',
                ...adapters
              ], { timeout: 600000 });
            } catch (err: any) {
              this.outputChannel.appendLine(`Warning: Failed to install some adapters: ${err.message}`);
              vscode.window.showWarningMessage(`dbt Forge: Some adapters failed to install. Check Output panel.`);
            }
          }

          if (token.isCancellationRequested) { return false; }

          // Step 5: Verify installation
          progress.report({ message: 'Verifying dbt installation...', increment: 20 });
          try {
            const { stdout } = await execFileAsync(this.dbtBin, ['--version']);
            this.outputChannel.appendLine(`dbt installed successfully:\n${stdout}`);
            progress.report({ message: 'Ready!', increment: 10 });
            this._ready = true;
            return true;
          } catch (err: any) {
            this.outputChannel.appendLine(`dbt verification failed: ${err.message}`);
            vscode.window.showErrorMessage('dbt Forge: dbt installation verification failed.');
            return false;
          }
        }
      );
    } finally {
      this._initializing = false;
    }
  }

  /**
   * Run a dbt command and return the output.
   */
  async runDbt(
    args: string[],
    cwd: string,
    token?: vscode.CancellationToken
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this._ready) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new Error('Python environment is not ready. Run "dbt Forge: Initialize Python Environment" first.');
      }
    }

    return new Promise((resolve, reject) => {
      this.outputChannel.appendLine(`\n> dbt ${args.join(' ')}`);
      this.outputChannel.appendLine(`  cwd: ${cwd}`);

      const proc: ChildProcess = spawn(this.dbtBin, args, {
        cwd,
        env: {
          ...process.env,
          VIRTUAL_ENV: this.envPath,
          PATH: path.dirname(this.dbtBin) + path.delimiter + (process.env.PATH || ''),
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        this.outputChannel.append(text);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        this.outputChannel.append(text);
      });

      if (token) {
        token.onCancellationRequested(() => {
          proc.kill('SIGTERM');
          reject(new Error('Command cancelled'));
        });
      }

      proc.on('close', (code: number | null) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  /**
   * Check if the environment already exists and is valid.
   */
  async checkExisting(): Promise<boolean> {
    if (!fs.existsSync(this.dbtBin)) {
      return false;
    }
    try {
      await execFileAsync(this.dbtBin, ['--version']);
      this._ready = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove the environment entirely (for reinstallation).
   */
  async destroy(): Promise<void> {
    if (fs.existsSync(this.envPath)) {
      fs.rmSync(this.envPath, { recursive: true, force: true });
    }
    this._ready = false;
  }
}
