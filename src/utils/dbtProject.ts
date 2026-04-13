import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface DbtProjectConfig {
  name: string;
  version: string;
  'config-version': number;
  profile: string;
  'model-paths'?: string[];
  'test-paths'?: string[];
  'macro-paths'?: string[];
  'target-path'?: string;
  'clean-targets'?: string[];
}

export interface DbtProfile {
  target: string;
  outputs: Record<string, Record<string, any>>;
}

/**
 * Discovers and parses dbt project configuration from the workspace.
 */
export class DbtProject {
  private _projectRoot: string | undefined;
  private _config: DbtProjectConfig | undefined;
  private _profiles: Record<string, DbtProfile> | undefined;

  constructor() {}

  get projectRoot(): string | undefined {
    return this._projectRoot;
  }

  get config(): DbtProjectConfig | undefined {
    return this._config;
  }

  get profileName(): string | undefined {
    return this._config?.profile;
  }

  /**
   * Find dbt_project.yml in the workspace and load configuration.
   */
  async discover(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return false;
    }

    for (const folder of workspaceFolders) {
      const ymlPath = path.join(folder.uri.fsPath, 'dbt_project.yml');
      const yamlPath = path.join(folder.uri.fsPath, 'dbt_project.yaml');

      const projectFile = fs.existsSync(ymlPath) ? ymlPath
        : fs.existsSync(yamlPath) ? yamlPath
        : undefined;

      if (projectFile) {
        try {
          const content = fs.readFileSync(projectFile, 'utf-8');
          this._config = yaml.load(content) as DbtProjectConfig;
          this._projectRoot = folder.uri.fsPath;
          await this.loadProfiles();
          return true;
        } catch (err: any) {
          vscode.window.showWarningMessage(`dbt Forge: Failed to parse ${projectFile}: ${err.message}`);
        }
      }
    }

    return false;
  }

  /**
   * Load profiles.yml from standard locations.
   */
  private async loadProfiles(): Promise<void> {
    if (!this._projectRoot) { return; }

    const profileLocations = [
      path.join(this._projectRoot, 'profiles.yml'),
      path.join(this._projectRoot, 'profiles.yaml'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.dbt', 'profiles.yml'),
    ];

    for (const profilePath of profileLocations) {
      if (fs.existsSync(profilePath)) {
        try {
          const content = fs.readFileSync(profilePath, 'utf-8');
          this._profiles = yaml.load(content) as Record<string, DbtProfile>;
          return;
        } catch {
          // Try next location
        }
      }
    }
  }

  /**
   * Get available target names for the current profile.
   */
  getTargets(): string[] {
    if (!this._profiles || !this._config?.profile) {
      return [];
    }
    const profile = this._profiles[this._config.profile];
    if (!profile?.outputs) {
      return [];
    }
    return Object.keys(profile.outputs);
  }

  /**
   * Get the default target for the current profile.
   */
  getDefaultTarget(): string | undefined {
    if (!this._profiles || !this._config?.profile) {
      return undefined;
    }
    return this._profiles[this._config.profile]?.target;
  }

  /**
   * Get the model paths, defaulting to ['models'].
   */
  getModelPaths(): string[] {
    return this._config?.['model-paths'] || ['models'];
  }

  /**
   * Get the test paths, defaulting to ['tests'].
   */
  getTestPaths(): string[] {
    return this._config?.['test-paths'] || ['tests'];
  }

  /**
   * Get the target path for compiled output.
   */
  getTargetPath(): string {
    return this._config?.['target-path'] || 'target';
  }

  /**
   * Resolve a model name from a file path.
   */
  getModelName(filePath: string): string | undefined {
    if (!this._projectRoot) { return undefined; }

    const relative = path.relative(this._projectRoot, filePath);
    const modelPaths = this.getModelPaths();

    for (const modelPath of modelPaths) {
      if (relative.startsWith(modelPath)) {
        const modelFile = path.relative(modelPath, relative);
        return path.basename(modelFile, path.extname(modelFile));
      }
    }

    return undefined;
  }

  /**
   * Check if a file is a dbt model file.
   */
  isModelFile(filePath: string): boolean {
    if (!this._projectRoot) { return false; }
    if (!filePath.endsWith('.sql')) { return false; }

    const relative = path.relative(this._projectRoot, filePath);
    const modelPaths = this.getModelPaths();

    return modelPaths.some(mp => relative.startsWith(mp));
  }
}
