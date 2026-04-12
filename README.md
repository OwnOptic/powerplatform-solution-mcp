<p align="center">
  <svg viewBox="0 0 110 100" xmlns="http://www.w3.org/2000/svg" width="80" height="72" aria-label="Elliot Margot Logo">
    <path d="M15 15H30V85H15z M15 15H50V30H15z M15 42.5H45V57.5H15z M15 70H50V85H15z" fill="#F26F21"/>
    <path d="M55 85V15L75 50L95 15V85" stroke="#2A3B4E" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>
</p>

<h1 align="center">Power Platform Solution Explorer MCP</h1>

<p align="center">
  <strong>Export a Power Platform solution, drop the ZIP, let any AI agent answer questions about it.</strong>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#copilot-studio-integration">Copilot Studio</a> &bull;
  <a href="#tools">13 Tools</a> &bull;
  <a href="#resources">MCP Resources</a> &bull;
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

## What is this?

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that reads exported Power Platform solution ZIP files and exposes their contents as tools and resources. Connect it to **Copilot Studio**, **Claude Desktop**, or **any MCP-compatible client** and ask questions like:

- *"What does this solution do?"*
- *"What flows are in here and what triggers them?"*
- *"What connectors does the agent use?"*
- *"Show me the system prompt for the Copilot Studio agent"*
- *"Search the solution for anything related to email"*

**No Dataverse access needed. No Power Platform license needed. Just the exported ZIP.**

---

## Quickstart

### Prerequisites

| Requirement | Why | How to check |
|---|---|---|
| **Node.js 18+** | Runtime for the MCP server | `node --version` |
| **npm** | Package manager (comes with Node.js) | `npm --version` |
| **Git** | Clone the repo | `git --version` |
| **A Power Platform solution ZIP** | The thing you want to explore | Export from [make.powerapps.com](https://make.powerapps.com) |

> **Don't have Node.js?** Download it from [nodejs.org](https://nodejs.org). Pick the LTS version. Install it. Restart your terminal.

### Step 1: Clone the repo

```bash
git clone https://github.com/OwnOptic/powerplatform-solution-mcp.git
cd powerplatform-solution-mcp
```

### Step 2: Install dependencies

```bash
npm install
```

This installs exactly 2 dependencies: the MCP SDK and Zod (validation). Nothing else.

### Step 3: Drop your solution ZIP

Copy your exported Power Platform solution `.zip` file into the `solutions/` folder:

**Windows (PowerShell):**
```powershell
copy C:\Users\you\Downloads\MySolution_1_0_0_1.zip .\solutions\
```

**Windows (File Explorer):**
Just drag and drop the ZIP into the `solutions` folder.

**Mac / Linux:**
```bash
cp ~/Downloads/MySolution_1_0_0_1.zip ./solutions/
```

> **You can drop multiple ZIPs.** The server handles them all. Each one becomes a separate solution you can explore.

### Step 4: Start the server

```bash
npm run dev
```

You'll see output like:

```
  Power Platform Solution Explorer MCP Server
  ──────────────────────────────────────────
  ZIP drop folder: /path/to/solutions
  Extracted to:    /path/to/extracted
  New extractions: MySolution_1_0_0_1
  MCP endpoint:    http://localhost:3001/mcp
  Health check:    http://localhost:3001/health
  Auth:            API key via "contoso-hr-demo-2026" header
  Tools:           9
  Solutions:       MySolution_1_0_0_1

  Drop .zip files into /path/to/solutions and restart.
```

**That's it.** The server auto-extracts every ZIP, validates it's a real Power Platform solution (checks for `solution.xml`), and exposes 9 tools + dynamic resources.

### Step 5: Verify it works

Open a browser or run:

```bash
curl http://localhost:3001/health
```

You should see:
```json
{"status":"ok","server":"Power Platform Solution Explorer MCP","version":"2.0.0","tools":9,"solutions":["MySolution_1_0_0_1"]}
```

---

## How It Works

```
┌─────────────────────┐
│  1. EXPORT           │    Go to make.powerapps.com > Solutions > select solution
│     from Power       │    > Export > Unmanaged (or Managed) > Download ZIP
│     Platform         │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  2. DROP ZIP         │    Copy the .zip file into the solutions/ folder
│     into solutions/  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  3. START SERVER     │    npm run dev
│     (auto-extracts)  │    > validates solution.xml exists
│                      │    > parses all components
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  4. CONNECT CLIENT   │    Copilot Studio, Claude Desktop, or any MCP client
│     via /mcp         │    > discovers 9 tools + resources
│     endpoint         │    > user asks questions in natural language
└─────────────────────┘
```

### Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐
│  Copilot Studio │────>│  Streamable HTTP (POST)  │────>│  MCP Server      │
│  Claude Desktop │     │  /mcp endpoint           │     │  9 tools         │
│  Any MCP Client │     │  Port 3001               │     │  15 component    │
└─────────────────┘     └──────────────────────────┘     │  types via enum  │
                                                         └────────┬─────────┘
                                                                  │
                                                       ┌──────────▼──────────┐
                                                       │  Solution Parser    │
                                                       │  ─────────────────  │
                                                       │  solution.xml       │
                                                       │  customizations.xml │
                                                       │  Workflows/*.json   │
                                                       │  botcomponents/     │
                                                       │  WebResources/      │
                                                       │  ...30+ folders     │
                                                       └─────────────────────┘
```

### Key Design Decisions

- **Stateless factory pattern** -- each HTTP POST creates a fresh `McpServer` instance. This is required for Copilot Studio's Streamable HTTP transport.
- **9 tools instead of 27** -- consolidated using enum parameters. `list_components` handles 15 component types through a single `component_type` enum, making it much easier for LLMs to pick the right tool.
- **Zero external dependencies** beyond `@modelcontextprotocol/sdk` and `zod`. XML parsing uses regex (Power Platform solution XMLs are well-structured and predictable).
- **Auto-extract on startup** -- drop ZIPs in `solutions/`, start server, done. Invalid ZIPs (no `solution.xml`) are automatically cleaned up.
- **Cross-platform** -- works on Windows (PowerShell `Expand-Archive`), Mac, and Linux (`unzip`).
- **70+ component type codes** mapped from the Dataverse `solutioncomponent` entity.

---

## Copilot Studio Integration

This is the primary use case: connect the MCP server to a Copilot Studio agent so end users can ask questions about the solution through a chat interface.

### What you need

| Requirement | Why |
|---|---|
| Copilot Studio license | To create an agent |
| Dev tunnel (or public URL) | Copilot Studio can't reach `localhost` |
| The MCP server running | Obviously |

### Step 1: Start the MCP server

```bash
cd powerplatform-solution-mcp
npm run dev
```

### Step 2: Expose with a dev tunnel

Copilot Studio needs a public URL to reach your server. The easiest way is Microsoft's [Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

**Install dev tunnel CLI** (one-time):
```bash
# Windows (winget)
winget install Microsoft.devtunnel

# Mac
brew install --cask devtunnel

# Linux
curl -sL https://aka.ms/DevTunnelCliInstall | bash
```

**Login** (one-time):
```bash
devtunnel user login -g    # Login with GitHub
# OR
devtunnel user login -d    # Login with Microsoft account
```

**Start the tunnel:**
```bash
devtunnel host -p 3001 --allow-anonymous
```

You'll get a URL like:
```
https://abc123-3001.euw.devtunnels.ms
```

Your MCP endpoint is: `https://abc123-3001.euw.devtunnels.ms/mcp`

> **Keep both terminals open** -- one for the MCP server, one for the dev tunnel.

### Step 3: Register in Copilot Studio

1. Go to [copilotstudio.microsoft.com](https://copilotstudio.microsoft.com)
2. Open your agent (or create a new one)
3. Go to **Tools** in the left sidebar
4. Click **Add a tool** > **New tool** > **Model Context Protocol**
5. Fill in:
   - **Server name:** `Power Platform Solution Explorer`
   - **Server description:** `Parses exported Power Platform solution ZIPs and exposes components as tools`
   - **Server URL:** `https://<your-tunnel-id>-3001.euw.devtunnels.ms/mcp`
   - **Authentication:** API Key (Header type)
   - **Header name:** `contoso-hr-demo-2026` (or your custom `MCP_API_KEY_HEADER`)
   - **API key value:** `sol-explorer-2026` (or your custom `MCP_API_KEY`)
6. Click **Next** -- Copilot Studio will connect and discover all 9 tools
7. Select which tools to enable (recommend: enable all)
8. Click **Add**

### Step 4: Enable Generative Orchestration

For the agent to automatically pick the right tool based on user questions:

1. Go to your agent's **Settings** > **Generative AI**
2. Enable **Generative orchestration** (or "Classic + Generative")
3. Save

### Step 5: Test it

In the Copilot Studio test pane, ask:

| Question | What happens |
|---|---|
| *"What solutions are available?"* | Calls `list_solutions` |
| *"Describe this solution"* | Calls `get_solution_info` > metadata + natural-language summary |
| *"What flows are in the solution?"* | Calls `list_components(component_type=flows)` |
| *"Show me the agent's system prompt"* | Calls `get_component_detail(component_type=bot_component, name=system_prompt)` |
| *"What connectors does it use?"* | Calls `list_components(component_type=connectors)` |
| *"Search for anything about email"* | Calls `search_solution` > full-text search across all files |
| *"Give me everything about this solution"* | Calls `load_solution_context` > full context in one call |

---

## Tools

13 tools that cover every aspect of a Power Platform solution. Every tool accepts a `solution` parameter (the folder name of the extracted solution).

### Solution Overview

| Tool | Description |
|---|---|
| `list_solutions` | List all extracted solutions available for exploration |
| `get_solution_info` | Solution metadata + component counts + natural-language summary |
| `get_solution_structure` | Folder tree detection -- reveals what component types are present |

### Component Listing

| Tool | Description |
|---|---|
| `list_components` | List any component type using the `component_type` enum parameter |

The `component_type` parameter accepts these values:

| Value | What it returns |
|---|---|
| `bots` | Bot definitions with auth config, icon status, language, template |
| `flows` | Power Automate flows with category, status, trigger type |
| `bot_topics` | Copilot Studio conversation topics with parent bot mapping |
| `bot_actions` | Copilot Studio actions with connector mappings |
| `connectors` | Connection references (Office 365, Outlook, Planner, etc.) |
| `custom_connectors` | Custom connectors with OpenAPI definition, auth type, operation count |
| `external_triggers` | Power Automate flow triggers that invoke the agent |
| `sub_agent_delegations` | Sub-agent invocations (parent bot, target bot, description) |
| `entities` | Dataverse tables with column, relationship, and key counts |
| `security_roles` | Security roles with privilege counts |
| `web_resources` | HTML, JS, CSS, images with file types and sizes |
| `canvas_apps` | Canvas Apps (.msapp files) |
| `environment_variables` | Environment variables (String, Number, Boolean, JSON, Secret, Data Source) |
| `plugins` | Plugin assemblies (DLLs) |
| `model_driven_apps` | Model-driven app definitions |
| `option_sets` | Global choices with options and integer values |
| `knowledge_sources` | Copilot Studio knowledge sources and files |

### Component Details

| Tool | Description |
|---|---|
| `get_component_detail` | Deep dive into a single component by type and name |

The `component_type` parameter accepts:

| Value | What it returns |
|---|---|
| `flow` | Trigger details, every action in order, connection references, prompts |
| `entity` | Full Dataverse schema: columns, relationships (1:N, N:N), keys, forms, views |
| `bot_component` | Raw YAML/JSON data for any bot component by folder name, or `system_prompt` for agent instructions. Multi-bot: use `system_prompt:BotName` to get a specific bot's prompt, or just `system_prompt` to get all prompts labeled by bot. |

### Navigation, Search & Raw Access

| Tool | Description |
|---|---|
| `get_sitemap` | Sitemap navigation structure (areas, groups, sub-areas) for model-driven apps |
| `search_solution` | Full-text search across ALL files in the solution (XML, JSON, YAML, everything) |
| `get_raw_file` | Read any file by relative path (e.g. `solution.xml`, `Workflows/MyFlow.json`) |

### Multi-Bot Analysis

| Tool | Description |
|---|---|
| `get_bot_tree` | Multi-bot component tree: each bot with its system topics (14 required), custom topics, actions, GPT config, triggers, sub-agent delegations, and knowledge sources grouped by parent bot. Essential for multi-agent solutions. |

### Validation & Comparison

| Tool | Description |
|---|---|
| `validate_solution` | Check solution for common issues: missing system topics, wrong auth config, empty icon, missing connection references, entity root component entries. Returns errors, warnings, and info with rule names. |
| `compare_solutions` | Diff two extracted solutions: files added/removed/changed, version differences, component-level additions and removals. Parameters: `solution_a`, `solution_b`. |

### Dependency Graph

| Tool | Description |
|---|---|
| `get_dependency_graph` | Relationship graph across the entire solution. Nodes: bots, connectors, entities, flows. Edge types: `delegates_to` (sub-agent invocations), `uses_connector`, `accesses_entity`, `triggers_bot`, `invokes_via_connector` (flows calling bots through Copilot Studio connector). |

### Full Context

| Tool | Description |
|---|---|
| `load_solution_context` | Load everything in one call: metadata, multi-bot tree with all system prompts, sub-agent delegations, flows with trigger/action details, connectors, entities, roles, env vars, sitemap, knowledge sources, validation issues, dependency graph, and folder structure. Call this first to deeply understand a solution. |

---

## Resources

The server also exposes **MCP Resources** -- structured data that MCP clients can read automatically without a tool call. Copilot Studio shows these in the **Resources** tab (Preview feature).

Resources are registered dynamically for the **5 most recently extracted solutions** (sorted by modification time):

| Resource | URI Pattern | Content |
|---|---|---|
| **Solution Overview** | `solution://{name}/overview` | Full markdown summary of the solution |
| **Solution Manifest** | `solution://{name}/manifest` | Raw `solution.xml` (metadata, publisher, root components) |
| **Agent System Prompt** | `solution://{name}/agent-prompt` | Copilot Studio agent persona/instructions (YAML) |
| **Flow Definitions** | `solution://{name}/flow/{flowName}` | Individual Power Automate flow JSON definitions |
| **Connectors** | `solution://{name}/connectors` | All connection references as JSON |

> Resources give the AI agent passive context. Instead of calling a tool to "get the solution overview", the agent already has it loaded. This makes responses faster and richer.

---

## How to Export a Solution from Power Platform

If you've never exported a solution before, here's how:

1. Go to [make.powerapps.com](https://make.powerapps.com)
2. Select your **Environment** (top-right dropdown)
3. Click **Solutions** in the left sidebar
4. Click the solution you want to explore
5. Click **Export** in the top toolbar
6. Choose **Unmanaged** (recommended -- includes full source) or **Managed**
7. Click **Export** and wait for the download
8. Save the `.zip` file -- **do not extract it yourself**, the server does that

> **Unmanaged vs Managed:** Unmanaged exports include all source files (flow definitions, bot components, etc.). Managed exports may have some files compiled/packaged. For best results with this tool, use **Unmanaged**.

---

## Supported Solution Components

The server parses the complete Power Platform solution anatomy:

| Component | Source File(s) | Tool |
|---|---|---|
| Solution metadata | `solution.xml` | `get_solution_info` |
| Root components (70+ types) | `solution.xml` | `get_solution_info` |
| Cloud Flows / Business Rules / BPFs | `customizations.xml` + `Workflows/*.json` | `list_components(flows)`, `get_component_detail(flow)` |
| Copilot Studio topics | `botcomponents/*.topic.*/data` | `list_components(bot_topics)` |
| Copilot Studio actions | `botcomponents/*.action.*/data` | `list_components(bot_actions)` |
| Bot definitions | `bots/*/bot.xml` + `configuration.json` | `list_components(bots)`, `get_bot_tree` |
| Agent system prompt | `botcomponents/*.gpt.*/data` | `get_component_detail(bot_component, system_prompt)` |
| Sub-agent delegations | `botcomponents/*.InvokeConnectedAgentTaskAction.*` | `list_components(sub_agent_delegations)`, `get_bot_tree` |
| Knowledge sources | `botcomponents/*.knowledge.*/data` | `list_components(knowledge_sources)` |
| Knowledge files | `botcomponents/*.file.*/data` | `list_components(knowledge_sources)` |
| External triggers | `botcomponents/*.ExternalTriggerComponent.*` | `list_components(external_triggers)` |
| Connection references | `customizations.xml` | `list_components(connectors)` |
| Bot-connector mappings | `Assets/botcomponent_connectionreferenceset.xml` | `list_components(bot_actions)` |
| Dataverse entities/tables | `customizations.xml` > `<Entities>` | `list_components(entities)`, `get_component_detail(entity)` |
| Entity schemas (columns, relationships, keys) | `customizations.xml` | `get_component_detail(entity)` |
| Security roles | `customizations.xml` > `<Roles>` | `list_components(security_roles)` |
| Web resources | `WebResources/` folder | `list_components(web_resources)` |
| Canvas apps | `CanvasApps/*.msapp` | `list_components(canvas_apps)` |
| Environment variables | `environmentvariabledefinitions/` | `list_components(environment_variables)` |
| Custom connectors | `Connectors/` or `connectors/` | `list_components(custom_connectors)` |
| Plugin assemblies | `PluginAssemblies/` | `list_components(plugins)` |
| Model-driven apps | `customizations.xml` > `<AppModules>` | `list_components(model_driven_apps)` |
| Global option sets | `customizations.xml` > `<optionsets>` | `list_components(option_sets)` |
| Sitemap navigation | `customizations.xml` > `<SiteMap>` | `get_sitemap` |

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `MCP_API_KEY` | `sol-explorer-2026` | API key for authenticating requests to `/mcp`. Set to empty string for open access. |
| `MCP_API_KEY_HEADER` | `contoso-hr-demo-2026` | Header name the server checks for the API key. Must match the header name configured in Copilot Studio. |

Examples:
```bash
# Default auth (API key = sol-explorer-2026, header = contoso-hr-demo-2026)
npm run dev

# Custom port
PORT=8080 npm run dev

# Custom API key and header
MCP_API_KEY=my-secret-key MCP_API_KEY_HEADER=x-my-auth npm run dev

# Open access (no auth)
MCP_API_KEY= npm run dev
```

### Copilot Studio API Key Setup

When registering the MCP tool in Copilot Studio with API key auth:

1. Go to **Tools** > **Add a tool** > **MCP**
2. Under **Authentication**, select **API key**
3. Set **Type** to **Header**
4. Set **Header name** to `contoso-hr-demo-2026` (or whatever you set in `MCP_API_KEY_HEADER`)
5. Paste your API key value (must match `MCP_API_KEY`)

> **Important:** Copilot Studio uses the header name field as the actual HTTP header name. The value you type in the "Header name" field becomes the header key in the request. Make sure it matches exactly.

The health endpoint (`/health`) is always open, so you can verify the server is running without auth.

---

## Folder Structure

After cloning and running, your project looks like this:

```
powerplatform-solution-mcp/
├── solutions/                  <-- DROP YOUR ZIP FILES HERE
│   ├── .gitkeep
│   └── MySolution_1_0_0_1.zip <-- your exported solution
├── extracted/                  <-- auto-created on startup
│   └── MySolution_1_0_0_1/    <-- auto-extracted from ZIP
│       ├── solution.xml
│       ├── customizations.xml
│       ├── [Content_Types].xml
│       ├── Workflows/          <-- Cloud Flows, Business Rules
│       ├── botcomponents/      <-- Copilot Studio topics, actions, prompts
│       ├── bots/               <-- Bot definitions
│       ├── Assets/             <-- Bot-connector mappings
│       ├── WebResources/       <-- HTML, JS, CSS, images
│       ├── CanvasApps/         <-- .msapp files
│       ├── PluginAssemblies/   <-- .dll files
│       ├── Connectors/         <-- Custom connector definitions
│       ├── environmentvariabledefinitions/
│       └── ...                 <-- 30+ possible component folders
├── src/
│   └── index.ts               <-- THE server (single file, ~1550 lines)
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Troubleshooting

### "npm run dev" fails with "tsx not found"

Run `npm install` first. `tsx` is a dev dependency.

### Server starts but shows "Solutions: none"

You haven't dropped any ZIP files in `solutions/` yet, or the ZIPs aren't valid Power Platform solutions (they must contain a `solution.xml` at the root).

### "EADDRINUSE: address already in use :::3001"

Another process is using port 3001. Either:
- Kill it: `npx kill-port 3001`
- Or use a different port: `PORT=3002 npm run dev`

### ZIP was extracted but shows "Skipped: not a Power Platform solution"

The ZIP doesn't contain a `solution.xml` at the root. This means it's not a Power Platform solution export. Make sure you're exporting from **Solutions** in make.powerapps.com, not downloading something else.

### Dev tunnel not working

- Make sure the MCP server is running (`curl http://localhost:3001/health`)
- Make sure the tunnel is running and shows "Ready to accept connections"
- Use the full tunnel URL with `/mcp` at the end
- If you get "Forbidden", make sure you used `--allow-anonymous`

### Copilot Studio can't discover tools

- Check the server URL ends with `/mcp` (not `/health`, not just the domain)
- Verify the tunnel is working: open `https://<tunnel-url>/health` in your browser
- Make sure you selected **Model Context Protocol** (not REST API or OpenAPI) when adding the tool
- If using API key auth, verify the header name and key match exactly

### Copilot Studio discovers tools but doesn't use them

- Enable **Generative orchestration** in your agent's settings
- Make sure the tools are enabled (checkboxes in the Tools panel)
- Try being explicit: *"Use the list_components tool to show me all flows"*

### 401 Unauthorized

- Verify your API key matches `MCP_API_KEY`
- Verify the header name in Copilot Studio matches `MCP_API_KEY_HEADER` exactly
- The health endpoint (`/health`) bypasses auth, so you can always check if the server is running

---

## Tech Stack

| Component | Technology |
|---|---|
| **Runtime** | Node.js 18+ (ES2022) |
| **MCP SDK** | `@modelcontextprotocol/sdk` (Streamable HTTP transport) |
| **Validation** | `zod` |
| **XML parsing** | Regex-based (no external parser -- PP solution XMLs are predictable) |
| **Transport** | Stateless Streamable HTTP (one `McpServer` per request -- required by Copilot Studio) |
| **Platforms** | Windows, Mac, Linux |

---

## Contributing

PRs welcome. The server is a single file (`src/index.ts`) -- easy to read, easy to extend.

To add support for a new component type:
1. Add a parser function (follow the pattern of existing parsers)
2. Add a new enum value to the `list_components` handler in `createMcpServer()`
3. Optionally add a resource for automatic context

---

## License

MIT

---

<p align="center">
  Built by <a href="https://www.e-margot.ch">Elliot Margot</a> &bull; <a href="https://github.com/OwnOptic">@OwnOptic</a>
</p>
