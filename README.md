<p align="center">
  <svg viewBox="0 0 110 100" xmlns="http://www.w3.org/2000/svg" width="80" height="72" aria-label="Elliot Margot Logo">
    <path d="M15 15H30V85H15z M15 15H50V30H15z M15 42.5H45V57.5H15z M15 70H50V85H15z" fill="#F26F21"/>
    <path d="M55 85V15L75 50L95 15V85" stroke="#2A3B4E" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>
</p>

<h1 align="center">Power Platform Solution Explorer MCP</h1>

<p align="center">
  <strong>Parse exported Power Platform solution ZIPs and interrogate them via Copilot Studio, Claude, or any MCP-compatible client.</strong>
</p>

<p align="center">
  <a href="#tools">24 Tools</a> &bull;
  <a href="#quickstart">Quickstart</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#copilot-studio">Copilot Studio Integration</a> &bull;
  <a href="#demo">Demo Scenario</a>
</p>

---

## What is this?

An MCP (Model Context Protocol) server that reads exported Power Platform solution ZIP files and exposes their contents as tools. Drop a solution ZIP, start the server, and let any AI agent answer questions like:

- *"What does this solution do?"*
- *"What flows are in here and what triggers them?"*
- *"What connectors does the agent use?"*
- *"Show me the system prompt for the Copilot Studio agent"*
- *"Search the solution for anything related to email"*

No Dataverse access needed. No Power Platform license needed. Just the exported ZIP.

---

## Quickstart

```bash
# Clone
git clone https://github.com/OwnOptic/powerplatform-solution-mcp.git
cd powerplatform-solution-mcp

# Install
npm install

# Drop a solution ZIP
cp /path/to/MySolution_1_0_0_1.zip ./solutions/

# Start (auto-extracts ZIPs on boot)
npm run dev
```

The server starts at `http://localhost:3001/mcp` and auto-extracts any `.zip` files in the `solutions/` folder.

### Folder Structure

```
powerplatform-solution-mcp/
├── solutions/          <- DROP ZIP FILES HERE
│   └── MySolution.zip
├── extracted/          <- auto-extracted on startup
│   └── MySolution/
│       ├── solution.xml
│       ├── customizations.xml
│       ├── Workflows/
│       ├── botcomponents/
│       └── ...
├── src/
│   └── index.ts        <- the MCP server (single file, zero external deps beyond MCP SDK)
├── package.json
└── tsconfig.json
```

---

## Tools

24 tools organized by component type. Every tool accepts a `solution` parameter (the folder name of the extracted solution).

### Solution Overview

| Tool | Description |
|---|---|
| `list_solutions` | List all extracted solutions available for exploration |
| `get_solution_info` | Solution metadata with root component breakdown (60+ type codes) |
| `describe_solution` | Comprehensive natural-language summary of everything in the solution |
| `get_solution_structure` | Folder structure detection — reveals what component types are present |

### Power Automate Flows

| Tool | Description |
|---|---|
| `list_flows` | All flows with category (Cloud Flow, Business Rule, BPF), status, trigger type |
| `get_flow_details` | Deep dive: triggers, actions, connectors, prompts, execution order |

### Copilot Studio / Agents

| Tool | Description |
|---|---|
| `list_bot_topics` | All conversation topics (ConversationStart, Greeting, Fallback, custom...) |
| `list_bot_actions` | All actions with connector mappings (connector operations, MCP servers) |
| `get_agent_system_prompt` | Full system prompt / persona / instructions |
| `get_component_data` | Raw YAML/JSON for any bot component |
| `list_external_triggers` | Power Automate triggers that invoke the agent |

### Dataverse & Model-Driven

| Tool | Description |
|---|---|
| `list_entities` | Tables with forms, views, and charts count |
| `list_security_roles` | Security roles with privilege counts |
| `list_option_sets` | Global choices with all options/values |
| `list_app_modules` | Model-driven app definitions |
| `get_sitemap` | Navigation structure (areas, groups, sub-areas) |

### Canvas Apps & Web Resources

| Tool | Description |
|---|---|
| `list_canvas_apps` | Canvas Apps (.msapp files) |
| `list_web_resources` | HTML, JS, CSS, images, SVGs with file types and sizes |

### Connectors & Configuration

| Tool | Description |
|---|---|
| `list_connectors` | All connection references (Office 365, Planner, custom...) |
| `list_custom_connectors` | Custom connectors with OpenAPI definition, auth type, operation count |
| `list_environment_variables` | Env vars (String, Number, Boolean, JSON, Secret, Data Source) |

### Plugins & Extensions

| Tool | Description |
|---|---|
| `list_plugin_assemblies` | Plugin DLLs included in the solution |

### Search & Raw Access

| Tool | Description |
|---|---|
| `search_solution` | Full-text search across all solution files |
| `get_raw_file` | Read any file from the extracted solution by relative path |

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌──────────────┐
│  Copilot Studio │────>│  Streamable HTTP (POST)  │────>│  MCP Server  │
│  Claude Desktop │     │  /mcp endpoint           │     │  (stateless) │
│  Any MCP Client │     │  Port 3001               │     │              │
└─────────────────┘     └──────────────────────────┘     └──────┬───────┘
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

- **Stateless factory pattern** — each HTTP POST creates a fresh `McpServer` instance. Required for Copilot Studio's Streamable HTTP transport.
- **Zero external dependencies** beyond `@modelcontextprotocol/sdk` and `zod`. XML parsing uses regex (solution XMLs are well-structured and predictable).
- **Auto-extract on startup** — drop ZIPs in `solutions/`, restart, done. Invalid ZIPs (no `solution.xml`) are automatically cleaned up.
- **60+ component type codes** mapped from the Dataverse `solutioncomponent` entity (`componenttype` global choice).

---

## Copilot Studio Integration

### 1. Start the server + dev tunnel

```bash
# Terminal 1: Start MCP server
npm run dev

# Terminal 2: Expose via dev tunnel
devtunnel host -p 3001 --allow-anonymous
```

### 2. Register in Copilot Studio

1. Go to your agent in Copilot Studio
2. **Tools** > **Add a tool** > **New tool** > **Model Context Protocol**
3. Fill in:
   - **Server name:** Power Platform Solution Explorer
   - **Server description:** Parses exported Power Platform solution ZIPs
   - **Server URL:** `https://<your-tunnel-id>-3001.euw.devtunnels.ms/mcp`
   - **Authentication:** None (or API Key for production)
4. Click **Next** — Copilot Studio discovers all 24 tools
5. Enable **Generative orchestration** on your agent

### 3. Test it

Ask your agent:

> *"What solutions are available?"*
> *"Describe the DEMOPersonalAssistant solution"*
> *"What flows are in the solution and what do they do?"*
> *"Show me the agent's system prompt"*
> *"Search for anything related to email"*

---

## Demo Scenario

This project was built as a community call demo showing two sides of the same MCP:

### Side 1: Developer / Admin

1. Export a Power Platform solution ZIP from make.powerapps.com
2. Drop it in the `solutions/` folder
3. Start the MCP server → it auto-extracts and parses everything
4. Connect to Copilot Studio via dev tunnel

### Side 2: End User

The user opens a Copilot Studio chat and asks:

> *"How can you help me?"*

The agent calls `describe_solution` and explains:

> *"This solution contains a Personal Intern agent with 13 actions for managing emails, calendar, contacts, and tasks via Office 365, Outlook, and Planner. It has 4 automated Power Automate flows that trigger on new emails, daily task reminders, and meeting summaries..."*

The user can then drill down into any component — flows, topics, actions, connectors, system prompt — all through natural conversation.

---

## Supported Solution Components

The server parses the complete Power Platform solution anatomy:

| Component | Source File(s) | Tool(s) |
|---|---|---|
| Solution metadata | `solution.xml` | `get_solution_info`, `describe_solution` |
| Root components (60+ types) | `solution.xml` | `get_solution_info` |
| Cloud Flows / Business Rules / BPFs | `customizations.xml` + `Workflows/*.json` | `list_flows`, `get_flow_details` |
| Copilot Studio topics | `botcomponents/*.topic.*/data` | `list_bot_topics` |
| Copilot Studio actions | `botcomponents/*.action.*/data` | `list_bot_actions` |
| Agent system prompt | `botcomponents/*.gpt.*/data` | `get_agent_system_prompt` |
| External triggers | `botcomponents/*.ExternalTriggerComponent.*` | `list_external_triggers` |
| Connection references | `customizations.xml` | `list_connectors` |
| Bot-connector mappings | `Assets/botcomponent_connectionreferenceset.xml` | `list_bot_actions` |
| Dataverse entities/tables | `customizations.xml` > `<Entities>` | `list_entities` |
| Forms, views, charts | `customizations.xml` (nested in Entity) | `list_entities` |
| Security roles | `customizations.xml` > `<Roles>` | `list_security_roles` |
| Web resources | `WebResources/` folder | `list_web_resources` |
| Canvas apps | `CanvasApps/*.msapp` | `list_canvas_apps` |
| Environment variables | `environmentvariabledefinitions/` | `list_environment_variables` |
| Custom connectors | `Connectors/` or `connectors/` | `list_custom_connectors` |
| Plugin assemblies | `PluginAssemblies/` | `list_plugin_assemblies` |
| Model-driven apps | `customizations.xml` > `<AppModules>` | `list_app_modules` |
| Global option sets | `customizations.xml` > `<optionsets>` | `list_option_sets` |
| Sitemap navigation | `customizations.xml` > `<SiteMap>` | `get_sitemap` |

---

## Component Type Codes

The server maps all 70+ Dataverse `solutioncomponent.componenttype` values. Key types:

| Code | Type | Code | Type |
|---|---|---|---|
| 1 | Entity (Table) | 61 | Web Resource |
| 9 | Option Set (Choice) | 62 | Site Map |
| 20 | Security Role | 66 | Custom Control (PCF) |
| 24 | Form | 91 | Plugin Assembly |
| 26 | View | 92 | SDK Message Processing Step |
| 29 | Workflow / Cloud Flow | 300 | Canvas App |
| 31 | Report | 371 | Custom Connector |
| 36 | Email Template | 380 | Environment Variable Definition |
| 44 | Duplicate Rule | 381 | Environment Variable Value |
| 59 | Chart | 400-402 | AI Builder |
| 60 | System Form | 10150 | Connection Reference |

---

## Tech Stack

- **Runtime:** Node.js (ES2022)
- **MCP SDK:** `@modelcontextprotocol/sdk` (Streamable HTTP transport)
- **Validation:** `zod`
- **XML parsing:** Regex-based (no external XML parser needed — PP solution XMLs are predictable)
- **Transport:** Stateless Streamable HTTP (one `McpServer` instance per request — required by Copilot Studio)

---

## License

MIT

---

<p align="center">
  Built by <a href="https://www.e-margot.ch">Elliot Margot</a> &bull; <a href="https://github.com/OwnOptic">@OwnOptic</a>
</p>
