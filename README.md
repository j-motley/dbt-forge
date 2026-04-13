# dbt Forge

**Zero-dependency dbt development for VS Code.** Compile, test, and validate your dbt models without installing dbt separately. Catch errors before deploying to your data warehouse.

---

## Features

### Bundled dbt Runtime
dbt Forge ships its own Python environment with dbt-core pre-installed. Open your dbt project and start working — no `pip install`, no virtual environments, no setup.

**Included adapters:**
- dbt-bigquery
- dbt-snowflake
- dbt-redshift

### Compile-Only Mode
Run `dbt compile`, `dbt test`, and `dbt run` without connecting to a target database. Catches errors early:

| What it catches                     | What requires a real DB        |
|-------------------------------------|-------------------------------|
| ✅ Jinja template errors            | ❌ Missing tables/columns     |
| ✅ Missing `ref()` / `source()` refs | ❌ Data type mismatches       |
| ✅ Macro argument errors             | ❌ Permission errors          |
| ✅ Invalid YAML schema definitions   | ❌ Query performance issues   |
| ✅ Circular dependencies             | ❌ Row-level data tests       |

### Inline Diagnostics
Compilation errors appear directly in the VS Code **Problems** panel with file locations, so you can click to jump to the issue.

### Model Status Indicators
See at-a-glance which models compiled successfully (✓), have errors (✗), or are currently compiling (⟳) — both in the dbt Forge sidebar and as badges in the File Explorer.

### Auto-Compile on Save
Enable `dbtForge.compileOnSave` (on by default) to automatically compile the current model every time you save a `.sql` file.

### Compiled SQL Preview
After compiling, open the rendered SQL side-by-side to see exactly what dbt generates — all Jinja resolved, all refs expanded.

### Jinja + SQL Syntax Highlighting
Full syntax highlighting for `.sql` files covering:
- Jinja2 blocks (`{% %}`, `{{ }}`, `{# #}`)
- dbt-specific functions (`ref()`, `source()`, `config()`, `var()`)
- SQL keywords, functions, and types across major dialects

---

## Getting Started

1. **Install the extension** from the VS Code Marketplace (or sideload the `.vsix`).
2. **Open a folder** containing a `dbt_project.yml`.
3. The extension will auto-detect the project and prompt you to initialize the Python environment on first use.
4. Use the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type `dbt Forge` to see all commands.

### Commands

| Command                                | Shortcut               | Description                               |
|----------------------------------------|------------------------|-------------------------------------------|
| `dbt Forge: Compile`                   |                        | Compile all models                        |
| `dbt Forge: Compile Current Model`     | `Ctrl+Shift+C`        | Compile the model open in the editor      |
| `dbt Forge: Test`                      | `Ctrl+Shift+T`        | Validate all test definitions             |
| `dbt Forge: Test Current Model`        |                        | Validate tests for the current model      |
| `dbt Forge: Run (Compile Only)`        |                        | Compile all models (dry-run)              |
| `dbt Forge: Run Current Model`         |                        | Compile current model (dry-run)           |
| `dbt Forge: Show Compiled SQL`         |                        | Open compiled SQL in a side panel         |
| `dbt Forge: Select Target Profile`     |                        | Choose which profiles.yml target to use   |
| `dbt Forge: Initialize Python Environment` |                    | (Re)create the bundled Python environment |

---

## Configuration

| Setting                         | Default                                       | Description                              |
|--------------------------------|-----------------------------------------------|------------------------------------------|
| `dbtForge.pythonPath`           | `""`                                          | Custom Python path (bypasses bundled env) |
| `dbtForge.dbtVersion`           | `"1.8.*"`                                     | dbt-core version to install              |
| `dbtForge.adapters`             | `["dbt-bigquery","dbt-snowflake","dbt-redshift"]` | Adapter packages to install          |
| `dbtForge.defaultTarget`        | `""`                                          | Default target from profiles.yml         |
| `dbtForge.compileOnSave`        | `true`                                        | Auto-compile on file save                |
| `dbtForge.showStatusInExplorer` | `true`                                        | Show status badges in File Explorer      |

---

## Architecture

```
dbt-forge/
├── src/
│   ├── extension.ts              # Entry point — wires everything together
│   ├── commands/
│   │   ├── compile.ts            # dbt compile integration
│   │   ├── test.ts               # dbt test (compile-only validation)
│   │   └── run.ts                # dbt run (compile-only, no DB execution)
│   ├── providers/
│   │   └── modelTreeProvider.ts  # Sidebar tree view + file decorations
│   ├── python/
│   │   └── pythonEnvironment.ts  # Manages bundled Python + dbt-core
│   └── utils/
│       ├── dbtProject.ts         # Parses dbt_project.yml and profiles.yml
│       └── diagnostics.ts        # Parses dbt output → VS Code diagnostics
├── syntaxes/
│   └── jinja-sql.tmLanguage.json # Jinja + SQL TextMate grammar
├── resources/icons/
│   └── dbt-forge.svg             # Sidebar icon
├── package.json                  # Extension manifest
└── README.md
```

---

## Development

```bash
# Clone and install dependencies
git clone <repo-url> && cd dbt-forge
npm install

# Compile TypeScript
npm run compile

# Launch in VS Code (press F5 with the project open)
# Or package a .vsix:
npx vsce package
```

---

## Requirements

- **VS Code** 1.85.0+
- **Python 3.9+** on the system (used to bootstrap the bundled environment)

The extension creates an isolated Python virtual environment inside its own storage — it will not interfere with your system Python or any existing dbt installations.

---

## License

MIT
