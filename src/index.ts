import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";

// ── Config ──────────────────────────────────────────────────────────
const PORT = 3001;
const BASE_DIR = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
  ".."
);
const SOLUTIONS_DIR = join(BASE_DIR, "solutions");  // Drop .zip files here
const EXTRACTED_DIR = join(BASE_DIR, "extracted");   // Auto-extracted output

// ── Auto-extract ZIPs on startup ────────────────────────────────────
function autoExtractZips(): string[] {
  mkdirSync(SOLUTIONS_DIR, { recursive: true });
  mkdirSync(EXTRACTED_DIR, { recursive: true });

  const extracted: string[] = [];

  if (!existsSync(SOLUTIONS_DIR)) return extracted;

  const zips = readdirSync(SOLUTIONS_DIR).filter((f) =>
    f.toLowerCase().endsWith(".zip")
  );

  for (const zipFile of zips) {
    const zipPath = join(SOLUTIONS_DIR, zipFile);
    const folderName = zipFile.replace(/\.zip$/i, "");
    const targetDir = join(EXTRACTED_DIR, folderName);

    if (existsSync(targetDir)) {
      // Already extracted — skip
      continue;
    }

    try {
      mkdirSync(targetDir, { recursive: true });
      // Use PowerShell to extract (works on Windows)
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`,
        { timeout: 30000 }
      );

      // Verify it's a valid PP solution (has solution.xml)
      if (existsSync(join(targetDir, "solution.xml"))) {
        extracted.push(folderName);
        console.log(`  ✓ Extracted: ${zipFile} → ${folderName}`);
      } else {
        // Not a valid solution — clean up
        execSync(`powershell -Command "Remove-Item -Path '${targetDir}' -Recurse -Force"`, { timeout: 10000 });
        console.log(`  ✗ Skipped: ${zipFile} (not a Power Platform solution)`);
      }
    } catch (err: any) {
      console.error(`  ✗ Failed to extract ${zipFile}: ${err.message}`);
    }
  }

  return extracted;
}

// ── Solution Parser ─────────────────────────────────────────────────

interface SolutionInfo {
  uniqueName: string;
  displayName: string;
  version: string;
  managed: boolean;
  publisher: { name: string; prefix: string; description: string };
  rootComponentCount: number;
}

interface FlowInfo {
  id: string;
  name: string;
  description: string;
  jsonFile: string;
  state: string;
}

interface BotComponent {
  folder: string;
  schemaName: string;
  type: "topic" | "action" | "trigger" | "gpt" | "unknown";
  name: string;
  hasData: boolean;
}

interface ConnectorRef {
  logicalName: string;
  connectorId: string;
  displayName: string;
}

function xmlAttr(xml: string, attr: string): string {
  const re = new RegExp(`${attr}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

function xmlTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function xmlTagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi");
  return xml.match(re) || [];
}

function xmlTagSelfClosing(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\s[^>]*/?>`, "gi");
  return xml.match(re) || [];
}

function listSolutionDirs(): string[] {
  if (!existsSync(EXTRACTED_DIR)) return [];
  return readdirSync(EXTRACTED_DIR).filter((d) =>
    statSync(join(EXTRACTED_DIR, d)).isDirectory()
  );
}

function parseSolutionXml(solDir: string): SolutionInfo | null {
  const xmlPath = join(EXTRACTED_DIR, solDir, "solution.xml");
  if (!existsSync(xmlPath)) return null;
  const xml = readFileSync(xmlPath, "utf-8");
  const manifest = xmlTag(xml, "SolutionManifest");
  return {
    uniqueName: xmlTag(manifest, "UniqueName"),
    displayName: xmlAttr(
      (xmlTagAll(manifest, "LocalizedName").find((t) => t.includes('languagecode="1033"')) || ""),
      "description"
    ),
    version: xmlTag(manifest, "Version"),
    managed: xmlTag(manifest, "Managed") === "1",
    publisher: {
      name: xmlTag(xmlTag(manifest, "Publisher"), "UniqueName"),
      prefix: xmlTag(xmlTag(manifest, "Publisher"), "CustomizationPrefix"),
      description: xmlAttr(
        (xmlTagAll(xmlTag(manifest, "Publisher"), "Description").find((t) =>
          t.includes('languagecode="1033"')
        ) || ""),
        "description"
      ),
    },
    rootComponentCount: xmlTagSelfClosing(manifest, "RootComponent").length,
  };
}

function parseFlows(solDir: string): FlowInfo[] {
  const custPath = join(EXTRACTED_DIR, solDir, "customizations.xml");
  if (!existsSync(custPath)) return [];
  const xml = readFileSync(custPath, "utf-8");
  const workflows = xmlTagAll(xml, "Workflow");
  return workflows.map((w) => ({
    id: xmlAttr(w, "WorkflowId"),
    name: xmlAttr(w, "Name"),
    description: xmlAttr(
      (xmlTagAll(w, "Description").find((d) => d.includes('languagecode="1033"')) || ""),
      "description"
    ),
    jsonFile: xmlTag(w, "JsonFileName"),
    state: xmlTag(w, "StateCode") === "1" ? "Active" : "Inactive",
  }));
}

function getFlowDefinition(solDir: string, flowJsonFile: string): object | null {
  const fpath = join(EXTRACTED_DIR, solDir, flowJsonFile.replace(/^\//, ""));
  if (!existsSync(fpath)) return null;
  return JSON.parse(readFileSync(fpath, "utf-8"));
}

function parseBotComponents(solDir: string): BotComponent[] {
  const bcDir = join(EXTRACTED_DIR, solDir, "botcomponents");
  if (!existsSync(bcDir)) return [];
  const dirs = readdirSync(bcDir).filter((d) =>
    statSync(join(bcDir, d)).isDirectory()
  );
  return dirs.map((folder) => {
    let type: BotComponent["type"] = "unknown";
    let name = folder;
    if (folder.includes(".topic.")) {
      type = "topic";
      name = folder.split(".topic.")[1] || folder;
    } else if (folder.includes(".action.")) {
      type = "action";
      name = folder.split(".action.")[1] || folder;
    } else if (folder.includes(".ExternalTriggerComponent.")) {
      type = "trigger";
      name = folder.split(".ExternalTriggerComponent.")[1]?.split(".")[0] || folder;
    } else if (folder.includes(".gpt.")) {
      type = "gpt";
      name = "GPT / System Prompt";
    }
    return {
      folder,
      schemaName: folder,
      type,
      name,
      hasData: existsSync(join(bcDir, folder, "data")),
    };
  });
}

function getBotComponentData(solDir: string, folder: string): string | null {
  const dataPath = join(EXTRACTED_DIR, solDir, "botcomponents", folder, "data");
  if (!existsSync(dataPath)) return null;
  return readFileSync(dataPath, "utf-8");
}

function parseConnectors(solDir: string): ConnectorRef[] {
  const custPath = join(EXTRACTED_DIR, solDir, "customizations.xml");
  if (!existsSync(custPath)) return [];
  const xml = readFileSync(custPath, "utf-8");
  const refs = xmlTagAll(xml, "connectionreference");
  return refs.map((r) => ({
    logicalName: xmlAttr(r, "connectionreferencelogicalname"),
    connectorId: xmlTag(r, "connectorid"),
    displayName: xmlTag(r, "connectionreferencedisplayname"),
  }));
}

function parseBotConnectionRefs(solDir: string): Array<{ action: string; connector: string }> {
  const assetPath = join(
    EXTRACTED_DIR,
    solDir,
    "Assets",
    "botcomponent_connectionreferenceset.xml"
  );
  if (!existsSync(assetPath)) return [];
  const xml = readFileSync(assetPath, "utf-8");
  const refs = xmlTagSelfClosing(xml, "botcomponent_connectionreference").concat(
    xmlTagAll(xml, "botcomponent_connectionreference")
  );
  return refs.map((r) => ({
    action: xmlAttr(r, "botcomponentid.schemaname"),
    connector: xmlAttr(r, "connectionreferenceid.connectionreferencelogicalname"),
  })).filter(r => r.action);
}

// De-duplicate since xmlTagSelfClosing and xmlTagAll may overlap
function uniqueByAction(arr: Array<{ action: string; connector: string }>) {
  const seen = new Set<string>();
  return arr.filter((r) => {
    if (seen.has(r.action)) return false;
    seen.add(r.action);
    return true;
  });
}

// ── Summarize the entire solution in natural language ────────────────
function summarizeSolution(solDir: string): string {
  const info = parseSolutionXml(solDir);
  if (!info) return "Solution not found.";
  const flows = parseFlows(solDir);
  const components = parseBotComponents(solDir);
  const connectors = parseConnectors(solDir);
  const topics = components.filter((c) => c.type === "topic");
  const actions = components.filter((c) => c.type === "action");
  const triggers = components.filter((c) => c.type === "trigger");
  const gpt = components.find((c) => c.type === "gpt");

  let systemPrompt = "";
  if (gpt) {
    const data = getBotComponentData(solDir, gpt.folder);
    if (data) {
      const instrMatch = data.match(/instructions:\s*\|?\-?\s*\n([\s\S]*?)(?=\n\w+:|$)/);
      if (instrMatch) systemPrompt = instrMatch[1].trim();
    }
  }

  const lines: string[] = [];
  lines.push(`# ${info.displayName || info.uniqueName}`);
  lines.push(`**Version:** ${info.version} | **Managed:** ${info.managed ? "Yes" : "No"} | **Publisher:** ${info.publisher.name} (prefix: ${info.publisher.prefix})`);
  if (info.publisher.description) lines.push(`**Publisher Info:** ${info.publisher.description}`);
  lines.push("");
  lines.push(`## Components Overview`);
  lines.push(`- **Power Automate Flows:** ${flows.length} (${flows.map((f) => f.name).join(", ")})`);
  lines.push(`- **Bot Topics:** ${topics.length} (${topics.map((t) => t.name).join(", ")})`);
  lines.push(`- **Bot Actions:** ${actions.length} (${actions.map((a) => a.name).join(", ")})`);
  lines.push(`- **External Triggers:** ${triggers.length} (${triggers.map((t) => t.name).join(", ")})`);
  lines.push(`- **Connectors:** ${connectors.length} (${[...new Set(connectors.map((c) => c.connectorId.split("/").pop()))].join(", ")})`);
  lines.push("");

  if (systemPrompt) {
    lines.push(`## Agent System Prompt (excerpt)`);
    lines.push(systemPrompt.substring(0, 1500) + (systemPrompt.length > 1500 ? "\n..." : ""));
    lines.push("");
  }

  lines.push(`## Flow Details`);
  for (const f of flows) {
    lines.push(`- **${f.name}** [${f.state}]: ${f.description}`);
  }

  return lines.join("\n");
}

// ── Flow detail extractor ───────────────────────────────────────────
function describeFlow(flowDef: any): object {
  const def = flowDef?.properties?.definition;
  if (!def) return { error: "No definition found" };

  const triggers = Object.entries(def.triggers || {}).map(([name, t]: [string, any]) => ({
    name,
    type: t.type,
    ...(t.recurrence ? { recurrence: t.recurrence } : {}),
    ...(t.inputs?.host?.operationId ? { operationId: t.inputs.host.operationId } : {}),
  }));

  const actions = Object.entries(def.actions || {}).map(([name, a]: [string, any]) => ({
    name,
    type: a.type,
    ...(a.inputs?.host?.operationId ? { operationId: a.inputs.host.operationId } : {}),
    ...(a.inputs?.host?.connectionName ? { connector: a.inputs.host.connectionName } : {}),
    ...(a.inputs?.parameters?.["body/message"] ? { promptMessage: a.inputs.parameters["body/message"] } : {}),
    ...(a.inputs?.parameters?.Copilot ? { targetCopilot: a.inputs.parameters.Copilot } : {}),
    runsAfter: Object.keys(a.runAfter || {}),
  }));

  const connRefs = flowDef?.properties?.connectionReferences
    ? Object.entries(flowDef.properties.connectionReferences).map(([key, cr]: [string, any]) => ({
        name: key,
        api: cr.api?.name,
        connectionRef: cr.connection?.connectionReferenceLogicalName,
      }))
    : [];

  return { triggers, actions, connectionReferences: connRefs };
}

// ── MCP Server Factory ──────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "Power Platform Solution Explorer",
    version: "1.0.0",
  });

  // ── Tool: list_solutions ──────────────────────────────────────────
  server.tool(
    "list_solutions",
    "List all extracted Power Platform solutions available for exploration",
    {},
    async () => {
      const dirs = listSolutionDirs();
      const solutions = dirs
        .map((d) => {
          const info = parseSolutionXml(d);
          return info
            ? { folder: d, name: info.displayName || info.uniqueName, version: info.version, managed: info.managed, publisher: info.publisher.name }
            : null;
        })
        .filter(Boolean);
      return {
        content: [{ type: "text", text: JSON.stringify(solutions, null, 2) }],
      };
    }
  );

  // ── Tool: get_solution_info ───────────────────────────────────────
  server.tool(
    "get_solution_info",
    "Get metadata about a Power Platform solution (name, version, publisher, component counts)",
    { solution: z.string().describe("Solution folder name (e.g. DEMOPersonalAssistant)") },
    async ({ solution }) => {
      const info = parseSolutionXml(solution);
      if (!info) return { content: [{ type: "text", text: "Solution not found." }] };
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
  );

  // ── Tool: describe_solution ───────────────────────────────────────
  server.tool(
    "describe_solution",
    "Get a comprehensive natural-language summary of what a Power Platform solution contains and does — great for answering 'what does this solution do?' or 'how can this agent help me?'",
    { solution: z.string().describe("Solution folder name") },
    async ({ solution }) => {
      const summary = summarizeSolution(solution);
      return { content: [{ type: "text", text: summary }] };
    }
  );

  // ── Tool: list_flows ──────────────────────────────────────────────
  server.tool(
    "list_flows",
    "List all Power Automate flows in the solution with their name, description, and status",
    { solution: z.string().describe("Solution folder name") },
    async ({ solution }) => {
      const flows = parseFlows(solution);
      return { content: [{ type: "text", text: JSON.stringify(flows, null, 2) }] };
    }
  );

  // ── Tool: get_flow_details ────────────────────────────────────────
  server.tool(
    "get_flow_details",
    "Get detailed trigger, action, and connector info for a specific Power Automate flow",
    {
      solution: z.string().describe("Solution folder name"),
      flow_name: z.string().describe("Flow name (as returned by list_flows)"),
    },
    async ({ solution, flow_name }) => {
      const flows = parseFlows(solution);
      const flow = flows.find(
        (f) => f.name.toLowerCase() === flow_name.toLowerCase()
      );
      if (!flow) return { content: [{ type: "text", text: `Flow "${flow_name}" not found. Available: ${flows.map((f) => f.name).join(", ")}` }] };

      const def = getFlowDefinition(solution, flow.jsonFile);
      if (!def) return { content: [{ type: "text", text: "Flow JSON definition not found." }] };

      const details = describeFlow(def);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...flow, details }, null, 2),
          },
        ],
      };
    }
  );

  // ── Tool: list_bot_topics ─────────────────────────────────────────
  server.tool(
    "list_bot_topics",
    "List all conversation topics defined in the Copilot Studio agent",
    { solution: z.string().describe("Solution folder name") },
    async ({ solution }) => {
      const components = parseBotComponents(solution).filter(
        (c) => c.type === "topic"
      );
      return { content: [{ type: "text", text: JSON.stringify(components, null, 2) }] };
    }
  );

  // ── Tool: list_bot_actions ────────────────────────────────────────
  server.tool(
    "list_bot_actions",
    "List all actions (connector operations, MCP servers) available to the Copilot Studio agent",
    { solution: z.string().describe("Solution folder name") },
    async ({ solution }) => {
      const components = parseBotComponents(solution).filter(
        (c) => c.type === "action"
      );
      // Enrich with connector mapping
      const botRefs = uniqueByAction(parseBotConnectionRefs(solution));
      const enriched = components.map((c) => {
        const ref = botRefs.find((r) => r.action === c.schemaName);
        return { ...c, connectorRef: ref?.connector || "N/A" };
      });
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  // ── Tool: get_agent_system_prompt ─────────────────────────────────
  server.tool(
    "get_agent_system_prompt",
    "Get the full system prompt / instructions configured for the Copilot Studio agent",
    { solution: z.string().describe("Solution folder name") },
    async ({ solution }) => {
      const gpt = parseBotComponents(solution).find((c) => c.type === "gpt");
      if (!gpt) return { content: [{ type: "text", text: "No GPT/system prompt component found." }] };
      const data = getBotComponentData(solution, gpt.folder);
      return { content: [{ type: "text", text: data || "No data file found." }] };
    }
  );

  // ── Tool: list_connectors ─────────────────────────────────────────
  server.tool(
    "list_connectors",
    "List all connection references (connectors) used by the solution — Office 365, Outlook, Planner, etc.",
    { solution: z.string().describe("Solution folder name") },
    async ({ solution }) => {
      const connectors = parseConnectors(solution);
      // Simplify connector IDs
      const simplified = connectors.map((c) => ({
        ...c,
        connector: c.connectorId.split("/").pop(),
      }));
      return { content: [{ type: "text", text: JSON.stringify(simplified, null, 2) }] };
    }
  );

  // ── Tool: get_component_data ──────────────────────────────────────
  server.tool(
    "get_component_data",
    "Get the raw YAML/JSON data for any bot component (topic, action, trigger, GPT config) by its folder name",
    {
      solution: z.string().describe("Solution folder name"),
      component: z.string().describe("Component folder name (from list_bot_topics, list_bot_actions, etc.)"),
    },
    async ({ solution, component }) => {
      const data = getBotComponentData(solution, component);
      if (!data) return { content: [{ type: "text", text: `Component "${component}" not found or has no data file.` }] };
      return { content: [{ type: "text", text: data }] };
    }
  );

  // ── Tool: list_external_triggers ──────────────────────────────────
  server.tool(
    "list_external_triggers",
    "List all external triggers (Power Automate flow triggers that invoke the Copilot Studio agent)",
    { solution: z.string().describe("Solution folder name") },
    async ({ solution }) => {
      const triggers = parseBotComponents(solution).filter(
        (c) => c.type === "trigger"
      );
      // Get trigger data for each
      const enriched = triggers.map((t) => {
        const data = getBotComponentData(solution, t.folder);
        return { ...t, data: data?.substring(0, 500) || "N/A" };
      });
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    }
  );

  // ── Tool: search_solution ─────────────────────────────────────────
  server.tool(
    "search_solution",
    "Search across all solution files (flows, topics, actions, prompts) for a keyword",
    {
      solution: z.string().describe("Solution folder name"),
      query: z.string().describe("Search keyword or phrase"),
    },
    async ({ solution, query }) => {
      const solPath = join(EXTRACTED_DIR, solution);
      if (!existsSync(solPath))
        return { content: [{ type: "text", text: "Solution not found." }] };

      const results: Array<{ file: string; matches: string[] }> = [];
      const q = query.toLowerCase();

      function searchDir(dir: string) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            searchDir(full);
          } else if (stat.isFile() && stat.size < 500_000) {
            try {
              const content = readFileSync(full, "utf-8");
              if (content.toLowerCase().includes(q)) {
                const lines = content.split("\n");
                const matchingLines = lines
                  .filter((l) => l.toLowerCase().includes(q))
                  .slice(0, 5)
                  .map((l) => l.trim().substring(0, 200));
                results.push({
                  file: full.replace(solPath, "").replace(/\\/g, "/"),
                  matches: matchingLines,
                });
              }
            } catch {}
          }
        }
      }

      searchDir(solPath);
      return {
        content: [
          {
            type: "text",
            text: results.length
              ? JSON.stringify(results, null, 2)
              : `No matches found for "${query}".`,
          },
        ],
      };
    }
  );

  return server;
}

// ── HTTP Server (Streamable HTTP, stateless, factory pattern) ───────

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        server: "Power Platform Solution Explorer MCP",
        solutions: listSolutionDirs(),
      })
    );
    return;
  }

  // MCP endpoint
  if (req.url === "/mcp") {
    if (req.method === "GET" || req.method === "DELETE") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed. Use POST." }));
      return;
    }

    if (req.method === "POST") {
      try {
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err: any) {
        console.error("MCP error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── Auto-extract on startup, then listen ────────────────────────────
console.log(`\n  Power Platform Solution Explorer MCP Server`);
console.log(`  ──────────────────────────────────────────`);
console.log(`  ZIP drop folder: ${SOLUTIONS_DIR}`);
console.log(`  Extracted to:    ${EXTRACTED_DIR}`);

const newlyExtracted = autoExtractZips();
if (newlyExtracted.length) {
  console.log(`  New extractions: ${newlyExtracted.join(", ")}`);
}

httpServer.listen(PORT, () => {
  console.log(`  MCP endpoint:    http://localhost:${PORT}/mcp`);
  console.log(`  Health check:    http://localhost:${PORT}/health`);
  console.log(`  Solutions:       ${listSolutionDirs().join(", ") || "none"}`);
  console.log(`\n  Drop .zip files into ${SOLUTIONS_DIR} and restart.\n`);
});
