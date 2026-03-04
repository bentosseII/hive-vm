# Task: Ship HiveVM

## Context
HiveVM at ~/workspace/hive-vm is a working Bun+TypeScript CLI + control plane for agent-native compute. 6 tests pass. Needs packaging and shipping.

## What to do

### 1. Package.json cleanup
- Name: `hive-vm`
- Version: 0.1.0
- Description: "Agent-native compute marketplace. CLI + control plane for scheduling, metering, and billing agent workloads."
- Keywords: agent, compute, marketplace, vm, scheduling, billing
- License: MIT, author: Ben Tossell
- bin: `{ "hive": "./bin/hive.js", "hived": "./bin/hived.js" }` (check existing entry points)
- engines: node >=18

### 2. Build pipeline
- Add build step (bun build or similar)
- Ensure bin entry points work with shebangs
- Test `bun run dev -- --help` works

### 3. README.md
- Clear, punchy. "Airbnb for agent compute."
- Quick start: install, register as host, submit a workload
- Architecture section: scheduler, metering, billing, pools
- CLI command reference
- Not a wall of text

### 4. Polish
- `hive --version` and `hived --version` should work
- All commands have --help
- Clean up any TODO/FIXME comments

### 5. .gitignore, LICENSE (MIT), .npmignore
- Exclude: tests, .hivevm, coverage, node_modules

### 6. Git + GitHub
- git init if needed
- Clean .gitignore
- Initial commit
- Create repo: `gh repo create bentossell/hive-vm --public --description "Agent-native compute marketplace. Schedule, meter, and bill agent workloads." --source . --push`

### 7. Verify
- `bun run verify` passes
- README looks good

When completely finished, run: openclaw system event --text "Done: HiveVM shipped to GitHub" --mode now
