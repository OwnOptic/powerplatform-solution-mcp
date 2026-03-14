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
const SOLUTIONS_DIR = join(BASE_DIR, "solutions");
const EXTRACTED_DIR = join(BASE_DIR, "extracted");

// ── Component Type Code Map (from Dataverse solutioncomponent entity) ──
const COMPONENT_TYPES: Record<number, string> = {
  1: "Entity (Table)", 2: "Attribute (Column)", 3: "Relationship",
  4: "Attribute Picklist Value", 5: "Attribute Lookup Value",
  6: "View Attribute", 7: "Localized Label", 8: "Relationship Extra Condition",
  9: "Option Set (Choice)", 10: "Entity Relationship", 11: "Entity Relationship Role",
  13: "Managed Property", 14: "Entity Key", 16: "Privilege",
  20: "Role (Security Role)", 21: "Role Privilege", 22: "Display String",
  24: "Form", 25: "Organization", 26: "Saved Query (View)",
  29: "Workflow (Process / Cloud Flow)", 31: "Report",
  32: "Report Entity", 33: "Report Category", 34: "Report Visibility",
  36: "Email Template", 37: "Contract Template", 38: "KB Article Template",
  39: "Mail Merge Template", 44: "Duplicate Rule", 45: "Duplicate Rule Condition",
  46: "Entity Map", 47: "Attribute Map", 48: "Ribbon Command",
  49: "Ribbon Context Group", 50: "Ribbon Customization",
  52: "Ribbon Rule", 53: "Ribbon Tab To Command Map", 55: "Ribbon Diff",
  59: "Saved Query Visualization (Chart)", 60: "System Form",
  61: "Web Resource", 62: "Site Map", 63: "Connection Role",
  64: "Complex Control", 65: "Hierarchy Rule",
  66: "Custom Control (PCF)", 68: "Custom Control Default Config",
  70: "Field Security Profile", 71: "Field Permission",
  80: "App Module (Model-Driven App)",
  90: "Plugin Type", 91: "Plugin Assembly",
  92: "SDK Message Processing Step", 93: "SDK Message Processing Step Image",
  95: "Service Endpoint", 150: "Routing Rule", 151: "Routing Rule Item",
  152: "SLA", 153: "SLA Item",
  154: "Convert Rule (Automatic Record Creation)", 155: "Convert Rule Item",
  161: "Mobile Offline Profile", 162: "Mobile Offline Profile Item",
  165: "Similarity Rule", 166: "Data Source Mapping",
  201: "SDK Message", 202: "SDK Message Filter",
  300: "Canvas App", 371: "Connector (Custom Connector)",
  380: "Environment Variable Definition", 381: "Environment Variable Value",
  400: "AI Project Type", 401: "AI Project", 402: "AI Configuration",
  430: "Entity Analytics Configuration", 431: "Attribute Image Configuration",
  432: "Entity Image Configuration",
  10150: "Connection Reference", 10192: "App Action",
};

// ── Auto-extract ZIPs on startup ────────────────────────────────────
function autoExtractZips(): string[] {
  mkdirSync(SOLUTIONS_DIR, { recursive: true });
  mkdirSync(EXTRACTED_DIR, { recursive: true });
  const extracted: string[] = [];
  const zips = readdirSync(SOLUTIONS_DIR).filter((f) => f.toLowerCase().endsWith(".zip"));
  for (const zipFile of zips) {
    const zipPath = join(SOLUTIONS_DIR, zipFile);
    const folderName = zipFile.replace(/\.zip$/i, "");
    const targetDir = join(EXTRACTED_DIR, folderName);
    if (existsSync(targetDir)) continue;
    try {
      mkdirSync(targetDir, { recursive: true });
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`, { timeout: 30000 });
      if (existsSync(join(targetDir, "solution.xml"))) {
        extracted.push(folderName);
        console.log(`  ✓ Extracted: ${zipFile} → ${folderName}`);
      } else {
        execSync(`powershell -Command "Remove-Item -Path '${targetDir}' -Recurse -Force"`, { timeout: 10000 });
        console.log(`  ✗ Skipped: ${zipFile} (not a Power Platform solution)`);
      }
    } catch (err: any) {
      console.error(`  ✗ Failed to extract ${zipFile}: ${err.message}`);
    }
  }
  return extracted;
}

// ── XML Helpers ─────────────────────────────────────────────────────
function xmlAttr(xml: string, attr: string): string {
  const re = new RegExp(`${attr}="([^"]*)"`, "i");
  return xml.match(re)?.[1] || "";
}

function xmlTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() || "";
}

function xmlTagAll(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi")) || [];
}

function xmlTagSelfClosing(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}\\s[^>]*/?>`, "gi")) || [];
}

function xmlTagBoth(xml: string, tag: string): string[] {
  const full = xmlTagAll(xml, tag);
  const self = xmlTagSelfClosing(xml, tag);
  const seen = new Set(full);
  return [...full, ...self.filter((s) => !seen.has(s))];
}

// ── File system helpers ─────────────────────────────────────────────
function listSolutionDirs(): string[] {
  if (!existsSync(EXTRACTED_DIR)) return [];
  return readdirSync(EXTRACTED_DIR).filter((d) => statSync(join(EXTRACTED_DIR, d)).isDirectory());
}

function solPath(solDir: string, ...parts: string[]): string {
  return join(EXTRACTED_DIR, solDir, ...parts);
}

function readSolFile(solDir: string, ...parts: string[]): string | null {
  const p = solPath(solDir, ...parts);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

function readSolJson(solDir: string, ...parts: string[]): any | null {
  const content = readSolFile(solDir, ...parts);
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

function listSubDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory());
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
}

// ── Solution Parsers ────────────────────────────────────────────────

function parseSolutionXml(solDir: string) {
  const xml = readSolFile(solDir, "solution.xml");
  if (!xml) return null;
  const manifest = xmlTag(xml, "SolutionManifest");
  const rootComponents = xmlTagSelfClosing(manifest, "RootComponent").map((rc) => {
    const typeCode = parseInt(xmlAttr(rc, "type"), 10);
    return {
      type: typeCode,
      typeName: COMPONENT_TYPES[typeCode] || `Unknown (${typeCode})`,
      id: xmlAttr(rc, "id"),
      schemaName: xmlAttr(rc, "schemaName"),
      behavior: xmlAttr(rc, "behavior"),
    };
  });
  return {
    uniqueName: xmlTag(manifest, "UniqueName"),
    displayName: xmlAttr(xmlTagAll(manifest, "LocalizedName").find((t) => t.includes('languagecode="1033"')) || "", "description"),
    version: xmlTag(manifest, "Version"),
    managed: xmlTag(manifest, "Managed") === "1",
    publisher: {
      name: xmlTag(xmlTag(manifest, "Publisher"), "UniqueName"),
      prefix: xmlTag(xmlTag(manifest, "Publisher"), "CustomizationPrefix"),
      description: xmlAttr(xmlTagAll(xmlTag(manifest, "Publisher"), "Description").find((t) => t.includes('languagecode="1033"')) || "", "description"),
    },
    rootComponents,
    rootComponentCount: rootComponents.length,
  };
}

function parseFlows(solDir: string) {
  const xml = readSolFile(solDir, "customizations.xml");
  if (!xml) return [];
  return xmlTagAll(xml, "Workflow").map((w) => ({
    id: xmlAttr(w, "WorkflowId"),
    name: xmlAttr(w, "Name"),
    description: xmlAttr(xmlTagAll(w, "Description").find((d) => d.includes('languagecode="1033"')) || "", "description"),
    jsonFile: xmlTag(w, "JsonFileName"),
    category: xmlTag(w, "Category"),
    categoryName: ({ "0": "Classic Workflow", "2": "Business Rule", "4": "Business Process Flow", "5": "Cloud Flow", "6": "Desktop Flow" } as any)[xmlTag(w, "Category")] || "Other",
    state: xmlTag(w, "StateCode") === "1" ? "Active" : "Inactive",
    type: xmlTag(w, "ModernFlowType") === "0" ? "Automated/Instant" : xmlTag(w, "ModernFlowType") === "1" ? "Scheduled" : "Other",
  }));
}

function getFlowDefinition(solDir: string, flowJsonFile: string) {
  return readSolJson(solDir, flowJsonFile.replace(/^\//, ""));
}

function describeFlow(flowDef: any) {
  const def = flowDef?.properties?.definition;
  if (!def) return { error: "No definition found" };
  const triggers = Object.entries(def.triggers || {}).map(([name, t]: [string, any]) => ({
    name, type: t.type,
    ...(t.recurrence ? { recurrence: t.recurrence } : {}),
    ...(t.inputs?.host?.operationId ? { operationId: t.inputs.host.operationId } : {}),
    ...(t.inputs?.host?.connectionName ? { connector: t.inputs.host.connectionName } : {}),
  }));
  const actions = Object.entries(def.actions || {}).map(([name, a]: [string, any]) => ({
    name, type: a.type,
    ...(a.inputs?.host?.operationId ? { operationId: a.inputs.host.operationId } : {}),
    ...(a.inputs?.host?.connectionName ? { connector: a.inputs.host.connectionName } : {}),
    ...(a.inputs?.parameters?.["body/message"] ? { promptMessage: a.inputs.parameters["body/message"] } : {}),
    ...(a.inputs?.parameters?.Copilot ? { targetCopilot: a.inputs.parameters.Copilot } : {}),
    runsAfter: Object.keys(a.runAfter || {}),
  }));
  const connRefs = flowDef?.properties?.connectionReferences
    ? Object.entries(flowDef.properties.connectionReferences).map(([key, cr]: [string, any]) => ({
        name: key, api: cr.api?.name, connectionRef: cr.connection?.connectionReferenceLogicalName,
      }))
    : [];
  return { triggers, actions, connectionReferences: connRefs };
}

function parseBotComponents(solDir: string) {
  const bcDir = solPath(solDir, "botcomponents");
  if (!existsSync(bcDir)) return [];
  return listSubDirs(bcDir).map((folder) => {
    let type = "unknown";
    let name = folder;
    if (folder.includes(".topic.")) { type = "topic"; name = folder.split(".topic.")[1] || folder; }
    else if (folder.includes(".action.")) { type = "action"; name = folder.split(".action.")[1] || folder; }
    else if (folder.includes(".ExternalTriggerComponent.")) { type = "trigger"; name = folder.split(".ExternalTriggerComponent.")[1]?.split(".")[0] || folder; }
    else if (folder.includes(".gpt.")) { type = "gpt"; name = "GPT / System Prompt"; }
    else if (folder.includes(".skill.")) { type = "skill"; name = folder.split(".skill.")[1] || folder; }
    else if (folder.includes(".dialog.")) { type = "dialog"; name = folder.split(".dialog.")[1] || folder; }
    else if (folder.includes(".entity.")) { type = "entity"; name = folder.split(".entity.")[1] || folder; }
    else if (folder.includes(".variable.")) { type = "variable"; name = folder.split(".variable.")[1] || folder; }
    return { folder, schemaName: folder, type, name, hasData: existsSync(join(bcDir, folder, "data")) };
  });
}

function getBotComponentData(solDir: string, folder: string): string | null {
  return readSolFile(solDir, "botcomponents", folder, "data");
}

function parseConnectors(solDir: string) {
  const xml = readSolFile(solDir, "customizations.xml");
  if (!xml) return [];
  return xmlTagAll(xml, "connectionreference").map((r) => ({
    logicalName: xmlAttr(r, "connectionreferencelogicalname"),
    connectorId: xmlTag(r, "connectorid"),
    connector: xmlTag(r, "connectorid").split("/").pop() || "",
    displayName: xmlTag(r, "connectionreferencedisplayname"),
  }));
}

function parseBotConnectionRefs(solDir: string) {
  const xml = readSolFile(solDir, "Assets", "botcomponent_connectionreferenceset.xml");
  if (!xml) return [];
  const seen = new Set<string>();
  return xmlTagBoth(xml, "botcomponent_connectionreference")
    .map((r) => ({ action: xmlAttr(r, "botcomponentid.schemaname"), connector: xmlAttr(r, "connectionreferenceid.connectionreferencelogicalname") }))
    .filter((r) => r.action && !seen.has(r.action) && seen.add(r.action));
}

// ── NEW: Parse Entities from customizations.xml ─────────────────────
function parseEntities(solDir: string) {
  const xml = readSolFile(solDir, "customizations.xml");
  if (!xml) return [];
  const entitiesBlock = xmlTag(xml, "Entities");
  if (!entitiesBlock) return [];
  return xmlTagAll(entitiesBlock, "Entity").map((e) => {
    const name = xmlTag(e, "Name");
    const localizedNames = xmlTagAll(e, "LocalizedName");
    const displayName = xmlAttr(localizedNames.find((l) => l.includes('languagecode="1033"')) || "", "description") || name;
    const forms = xmlTagAll(e, "systemform").length;
    const views = xmlTagAll(e, "savedquery").length;
    const charts = xmlTagAll(e, "savedqueryvisualization").length;
    const hasRibbon = e.includes("<RibbonDiffXml>");
    return { name, displayName, forms, views, charts, hasRibbon };
  });
}

// ── NEW: Parse Security Roles ───────────────────────────────────────
function parseRoles(solDir: string) {
  const xml = readSolFile(solDir, "customizations.xml");
  if (!xml) return [];
  const rolesBlock = xmlTag(xml, "Roles");
  if (!rolesBlock) return [];
  return xmlTagAll(rolesBlock, "Role").map((r) => ({
    id: xmlAttr(r, "id"),
    name: xmlAttr(r, "name"),
    privileges: xmlTagAll(r, "RolePrivilege").length,
  }));
}

// ── NEW: Parse Web Resources ────────────────────────────────────────
function parseWebResources(solDir: string) {
  const wrDir = solPath(solDir, "WebResources");
  if (!existsSync(wrDir)) return [];
  const results: Array<{ path: string; type: string; size: number }> = [];
  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, `${prefix}${entry}/`);
      else {
        const ext = entry.split(".").pop()?.toLowerCase() || "";
        const typeMap: Record<string, string> = {
          html: "HTML", htm: "HTML", js: "JavaScript", css: "CSS",
          png: "Image (PNG)", jpg: "Image (JPG)", jpeg: "Image (JPG)",
          gif: "Image (GIF)", svg: "Image (SVG)", ico: "Icon",
          xml: "XML", xsl: "XSL", resx: "RESX (Localization)",
          xap: "Silverlight (legacy)",
        };
        results.push({ path: `${prefix}${entry}`, type: typeMap[ext] || ext.toUpperCase(), size: stat.size });
      }
    }
  }
  walk(wrDir, "");
  return results;
}

// ── NEW: Parse Canvas Apps ──────────────────────────────────────────
function parseCanvasApps(solDir: string) {
  const caDir = solPath(solDir, "CanvasApps");
  if (!existsSync(caDir)) return [];
  return listFiles(caDir)
    .filter((f) => f.toLowerCase().endsWith(".msapp"))
    .map((f) => ({ file: f, size: statSync(join(caDir, f)).size }));
}

// ── NEW: Parse Environment Variables ────────────────────────────────
function parseEnvironmentVariables(solDir: string) {
  const evDir = solPath(solDir, "environmentvariabledefinitions");
  if (!existsSync(evDir)) return [];
  return listSubDirs(evDir).map((folder) => {
    const defXml = readSolFile(solDir, "environmentvariabledefinitions", folder, "environmentvariabledefinition.xml");
    const valJson = readSolJson(solDir, "environmentvariabledefinitions", folder, "environmentvariablevalues.json");
    let displayName = folder;
    let type = "unknown";
    let defaultValue = "";
    if (defXml) {
      displayName = xmlTag(defXml, "displayname") || xmlAttr(defXml, "schemaname") || folder;
      const typeCode = xmlTag(defXml, "type");
      type = ({ "100000000": "String", "100000001": "Number", "100000002": "Boolean", "100000003": "JSON", "100000004": "Data Source", "100000005": "Secret" } as any)[typeCode] || typeCode;
      defaultValue = xmlTag(defXml, "defaultvalue") || "";
    }
    return { schemaName: folder, displayName, type, defaultValue, hasValue: !!valJson };
  });
}

// ── NEW: Parse Custom Connectors ────────────────────────────────────
function parseCustomConnectors(solDir: string) {
  for (const dirName of ["Connectors", "connectors"]) {
    const ccDir = solPath(solDir, dirName);
    if (!existsSync(ccDir)) continue;
    return listSubDirs(ccDir).map((folder) => {
      const swagger = readSolJson(solDir, dirName, folder, "apiDefinition.swagger.json");
      const props = readSolJson(solDir, dirName, folder, "apiProperties.json");
      return {
        folder,
        title: swagger?.info?.title || folder,
        description: swagger?.info?.description || "",
        host: swagger?.host || "",
        basePath: swagger?.basePath || "",
        operationCount: swagger?.paths ? Object.keys(swagger.paths).length : 0,
        authType: props?.properties?.connectionParameters ? Object.keys(props.properties.connectionParameters).join(", ") : "none",
        hasIcon: existsSync(join(ccDir, folder, "icon.png")),
      };
    });
  }
  return [];
}

// ── NEW: Parse Plugin Assemblies ────────────────────────────────────
function parsePluginAssemblies(solDir: string) {
  const paDir = solPath(solDir, "PluginAssemblies");
  if (!existsSync(paDir)) return [];
  return listSubDirs(paDir).map((folder) => {
    const dlls = listFiles(join(paDir, folder)).filter((f) => f.endsWith(".dll"));
    return { folder, assemblies: dlls };
  });
}

// ── NEW: Parse App Modules (Model-Driven Apps) ──────────────────────
function parseAppModules(solDir: string) {
  const xml = readSolFile(solDir, "customizations.xml");
  if (!xml) return [];
  return xmlTagAll(xml, "AppModule").map((am) => ({
    uniqueName: xmlTag(am, "UniqueName"),
    name: xmlAttr(xmlTagAll(am, "LocalizedName").find((l) => l.includes('languagecode="1033"')) || "", "description") || xmlTag(am, "UniqueName"),
    componentCount: xmlTagAll(am, "AppModuleComponent").length,
  }));
}

// ── NEW: Parse Option Sets (Choices) ────────────────────────────────
function parseOptionSets(solDir: string) {
  const xml = readSolFile(solDir, "customizations.xml");
  if (!xml) return [];
  const osBlock = xmlTag(xml, "optionsets") || xmlTag(xml, "OptionSets");
  if (!osBlock) return [];
  return xmlTagAll(osBlock, "optionset").map((os) => {
    const name = xmlAttr(os, "Name") || xmlTag(os, "Name");
    const displayName = xmlAttr(xmlTagAll(os, "displayname").find((l) => l.includes('languagecode="1033"')) || "", "description") || name;
    const options = xmlTagAll(os, "option").map((o) => ({
      value: xmlAttr(o, "value"),
      label: xmlAttr(xmlTagAll(o, "label").find((l) => l.includes('languagecode="1033"')) || "", "description"),
    }));
    return { name, displayName, optionCount: options.length, options };
  });
}

// ── NEW: Parse SiteMap ──────────────────────────────────────────────
function parseSiteMap(solDir: string) {
  const xml = readSolFile(solDir, "customizations.xml");
  if (!xml) return null;
  const sm = xmlTag(xml, "SiteMap");
  if (!sm) return null;
  const areas = xmlTagAll(sm, "Area").map((a) => ({
    id: xmlAttr(a, "Id"),
    title: xmlAttr(a, "Title") || xmlAttr(a, "ResourceId"),
    groups: xmlTagAll(a, "Group").map((g) => ({
      id: xmlAttr(g, "Id"),
      title: xmlAttr(g, "Title") || xmlAttr(g, "ResourceId"),
      subAreas: xmlTagAll(g, "SubArea").map((sa) => ({
        id: xmlAttr(sa, "Id"),
        entity: xmlAttr(sa, "Entity"),
        url: xmlAttr(sa, "Url"),
      })),
    })),
  }));
  return { areas };
}

// ── NEW: Detect all present folder types ────────────────────────────
function detectFolders(solDir: string) {
  const base = solPath(solDir);
  if (!existsSync(base)) return [];
  const known: Record<string, string> = {
    Workflows: "Power Automate Flows", botcomponents: "Copilot Studio Bot Components",
    bots: "Bot Definitions", Assets: "Bot Assets (connection refs, workflow sets)",
    WebResources: "Web Resources (HTML, JS, CSS, images)",
    PluginAssemblies: "Plugin Assemblies (DLLs)", pluginpackages: "Plugin Packages (NuGet)",
    Entities: "Entity/Table Definitions", Roles: "Security Roles",
    CanvasApps: "Canvas Apps (.msapp)", AppModules: "Model-Driven App Definitions",
    AppModuleSiteMaps: "Model-Driven App Sitemaps",
    Connectors: "Custom Connectors", connectors: "Custom Connectors",
    environmentvariabledefinitions: "Environment Variable Definitions",
    environmentvariablevalues: "Environment Variable Values",
    Controls: "PCF Custom Controls", OptionSets: "Global Option Sets (Choices)",
    Reports: "SSRS Reports", Templates: "Email/KB/Contract Templates",
    connectionreferences: "Connection References",
    customapis: "Custom APIs", customapirequestparameters: "Custom API Request Params",
    customapiresponseproperty: "Custom API Response Properties",
    aiplugins: "AI Plugins", aipluginoperations: "AI Plugin Operations",
    aimodels: "AI Builder Models", aibuilderfeedbackloop: "AI Builder Feedback Loop",
    DuplicateRules: "Duplicate Detection Rules", FieldSecurityProfiles: "Field Security Profiles",
    ServiceEndpoints: "Service Endpoints (Webhooks)",
    SdkMessageProcessingSteps: "SDK Message Processing Steps",
    EntityRelationships: "N:N Relationships", ConnectionRoles: "Connection Roles",
    appactions: "App Actions", pluginpackages: "Plugin Packages (NuGet)",
    ImportMaps: "Import Maps", SLAs: "SLAs",
    RoutingRules: "Routing Rules", ConvertRules: "Convert Rules",
  };
  const entries = readdirSync(base);
  const folders = entries.filter((e) => statSync(join(base, e)).isDirectory());
  const files = entries.filter((e) => statSync(join(base, e)).isFile());
  return {
    folders: folders.map((f) => ({ name: f, description: known[f] || "Unknown component folder" })),
    rootFiles: files,
  };
}

// ── Comprehensive Summary ───────────────────────────────────────────
function summarizeSolution(solDir: string): string {
  const info = parseSolutionXml(solDir);
  if (!info) return "Solution not found.";
  const flows = parseFlows(solDir);
  const components = parseBotComponents(solDir);
  const connectors = parseConnectors(solDir);
  const entities = parseEntities(solDir);
  const roles = parseRoles(solDir);
  const webResources = parseWebResources(solDir);
  const canvasApps = parseCanvasApps(solDir);
  const envVars = parseEnvironmentVariables(solDir);
  const customConnectors = parseCustomConnectors(solDir);
  const plugins = parsePluginAssemblies(solDir);
  const appModules = parseAppModules(solDir);
  const optionSets = parseOptionSets(solDir);
  const siteMap = parseSiteMap(solDir);
  const structure = detectFolders(solDir);

  const topics = components.filter((c) => c.type === "topic");
  const actions = components.filter((c) => c.type === "action");
  const triggers = components.filter((c) => c.type === "trigger");
  const gpt = components.find((c) => c.type === "gpt");

  let systemPrompt = "";
  if (gpt) {
    const data = getBotComponentData(solDir, gpt.folder);
    if (data) {
      const m = data.match(/instructions:\s*\|?\-?\s*\n([\s\S]*?)(?=\n\w+:|$)/);
      if (m) systemPrompt = m[1].trim();
    }
  }

  const L: string[] = [];
  L.push(`# ${info.displayName || info.uniqueName}`);
  L.push(`**Version:** ${info.version} | **Managed:** ${info.managed ? "Yes" : "No"} | **Publisher:** ${info.publisher.name} (prefix: ${info.publisher.prefix})`);
  if (info.publisher.description) L.push(`**Publisher Info:** ${info.publisher.description}`);
  L.push("");

  // Root component type breakdown
  const typeCounts = new Map<string, number>();
  for (const rc of info.rootComponents) typeCounts.set(rc.typeName, (typeCounts.get(rc.typeName) || 0) + 1);
  if (typeCounts.size) {
    L.push(`## Root Components (${info.rootComponentCount} total)`);
    for (const [t, c] of typeCounts) L.push(`- **${t}:** ${c}`);
    L.push("");
  }

  L.push(`## Solution Contents`);
  if (flows.length) L.push(`- **Power Automate Flows:** ${flows.length} (${flows.map((f) => `${f.name} [${f.categoryName}]`).join(", ")})`);
  if (topics.length) L.push(`- **Bot Topics:** ${topics.length} (${topics.map((t) => t.name).join(", ")})`);
  if (actions.length) L.push(`- **Bot Actions:** ${actions.length} (${actions.map((a) => a.name).join(", ")})`);
  if (triggers.length) L.push(`- **External Triggers:** ${triggers.length} (${triggers.map((t) => t.name).join(", ")})`);
  if (connectors.length) L.push(`- **Connection References:** ${connectors.length} (${[...new Set(connectors.map((c) => c.connector))].join(", ")})`);
  if (entities.length) L.push(`- **Entities/Tables:** ${entities.length} (${entities.map((e) => e.displayName).join(", ")})`);
  if (roles.length) L.push(`- **Security Roles:** ${roles.length} (${roles.map((r) => r.name).join(", ")})`);
  if (webResources.length) L.push(`- **Web Resources:** ${webResources.length} files`);
  if (canvasApps.length) L.push(`- **Canvas Apps:** ${canvasApps.length} (${canvasApps.map((a) => a.file).join(", ")})`);
  if (envVars.length) L.push(`- **Environment Variables:** ${envVars.length} (${envVars.map((v) => `${v.displayName} [${v.type}]`).join(", ")})`);
  if (customConnectors.length) L.push(`- **Custom Connectors:** ${customConnectors.length} (${customConnectors.map((c) => c.title).join(", ")})`);
  if (plugins.length) L.push(`- **Plugin Assemblies:** ${plugins.length}`);
  if (appModules.length) L.push(`- **Model-Driven Apps:** ${appModules.length} (${appModules.map((a) => a.name).join(", ")})`);
  if (optionSets.length) L.push(`- **Global Option Sets:** ${optionSets.length}`);
  if (siteMap) L.push(`- **SiteMap:** ${siteMap.areas.length} areas`);
  L.push("");

  if (systemPrompt) {
    L.push(`## Agent System Prompt (excerpt)`);
    L.push(systemPrompt.substring(0, 2000) + (systemPrompt.length > 2000 ? "\n..." : ""));
    L.push("");
  }

  if (flows.length) {
    L.push(`## Flow Details`);
    for (const f of flows) L.push(`- **${f.name}** [${f.categoryName}, ${f.state}]: ${f.description}`);
    L.push("");
  }

  if (typeof structure === "object" && "folders" in structure) {
    L.push(`## Solution File Structure`);
    for (const f of structure.folders) L.push(`- 📁 \`${f.name}/\` — ${f.description}`);
    L.push(`- Root files: ${structure.rootFiles.join(", ")}`);
  }

  return L.join("\n");
}

// ── MCP Server Factory ──────────────────────────────────────────────
function createMcpServer(): McpServer {
  const server = new McpServer({ name: "Power Platform Solution Explorer", version: "2.0.0" });
  const solParam = { solution: z.string().describe("Solution folder name (e.g. DEMOPersonalAssistant)") };

  // 1. list_solutions
  server.tool("list_solutions", "List all extracted Power Platform solutions available for exploration", {},
    async () => {
      const solutions = listSolutionDirs().map((d) => {
        const info = parseSolutionXml(d);
        return info ? { folder: d, name: info.displayName || info.uniqueName, version: info.version, managed: info.managed, publisher: info.publisher.name } : null;
      }).filter(Boolean);
      return { content: [{ type: "text", text: JSON.stringify(solutions, null, 2) }] };
    });

  // 2. get_solution_info
  server.tool("get_solution_info", "Get detailed metadata about a solution including root component breakdown with type codes", solParam,
    async ({ solution }) => {
      const info = parseSolutionXml(solution);
      if (!info) return { content: [{ type: "text", text: "Solution not found." }] };
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    });

  // 3. describe_solution
  server.tool("describe_solution", "Get a comprehensive natural-language summary of everything in the solution — components, flows, agents, connectors, entities, web resources, and more", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: summarizeSolution(solution) }] }));

  // 4. get_solution_structure
  server.tool("get_solution_structure", "Show the folder structure and root files of the extracted solution — reveals what component types are present", solParam,
    async ({ solution }) => {
      const structure = detectFolders(solution);
      return { content: [{ type: "text", text: JSON.stringify(structure, null, 2) }] };
    });

  // 5. list_flows
  server.tool("list_flows", "List all Power Automate flows with name, category (Cloud Flow, Business Rule, BPF), status, and trigger type", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseFlows(solution), null, 2) }] }));

  // 6. get_flow_details
  server.tool("get_flow_details", "Deep dive into a specific flow — triggers, actions, connectors, prompts, and execution order",
    { ...solParam, flow_name: z.string().describe("Flow name (as returned by list_flows)") },
    async ({ solution, flow_name }) => {
      const flows = parseFlows(solution);
      const flow = flows.find((f) => f.name.toLowerCase() === flow_name.toLowerCase());
      if (!flow) return { content: [{ type: "text", text: `Flow "${flow_name}" not found. Available: ${flows.map((f) => f.name).join(", ")}` }] };
      const def = getFlowDefinition(solution, flow.jsonFile);
      if (!def) return { content: [{ type: "text", text: "Flow JSON not found." }] };
      return { content: [{ type: "text", text: JSON.stringify({ ...flow, details: describeFlow(def) }, null, 2) }] };
    });

  // 7. list_bot_topics
  server.tool("list_bot_topics", "List all Copilot Studio conversation topics (ConversationStart, Greeting, Fallback, custom topics, etc.)", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseBotComponents(solution).filter((c) => c.type === "topic"), null, 2) }] }));

  // 8. list_bot_actions
  server.tool("list_bot_actions", "List all Copilot Studio actions with their connector mappings — connector operations, MCP servers, custom actions", solParam,
    async ({ solution }) => {
      const actions = parseBotComponents(solution).filter((c) => c.type === "action");
      const botRefs = parseBotConnectionRefs(solution);
      const enriched = actions.map((c) => {
        const ref = botRefs.find((r) => r.action === c.schemaName);
        return { ...c, connectorRef: ref?.connector || "N/A" };
      });
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    });

  // 9. get_agent_system_prompt
  server.tool("get_agent_system_prompt", "Get the full system prompt / instructions / persona configured for the Copilot Studio agent", solParam,
    async ({ solution }) => {
      const gpt = parseBotComponents(solution).find((c) => c.type === "gpt");
      if (!gpt) return { content: [{ type: "text", text: "No GPT/system prompt component found." }] };
      return { content: [{ type: "text", text: getBotComponentData(solution, gpt.folder) || "No data." }] };
    });

  // 10. list_connectors
  server.tool("list_connectors", "List all connection references — Office 365, Outlook, Planner, Copilot Studio, custom connectors, etc.", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseConnectors(solution), null, 2) }] }));

  // 11. get_component_data
  server.tool("get_component_data", "Get the raw YAML/JSON data for any bot component by its folder name",
    { ...solParam, component: z.string().describe("Component folder name") },
    async ({ solution, component }) => {
      const data = getBotComponentData(solution, component);
      if (!data) return { content: [{ type: "text", text: `Component "${component}" not found.` }] };
      return { content: [{ type: "text", text: data }] };
    });

  // 12. list_external_triggers
  server.tool("list_external_triggers", "List all external triggers (Power Automate flows that invoke the agent)", solParam,
    async ({ solution }) => {
      const triggers = parseBotComponents(solution).filter((c) => c.type === "trigger");
      const enriched = triggers.map((t) => ({ ...t, data: getBotComponentData(solution, t.folder)?.substring(0, 500) || "N/A" }));
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    });

  // 13. list_entities
  server.tool("list_entities", "List all Dataverse entities/tables in the solution with their forms, views, and charts count", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseEntities(solution), null, 2) }] }));

  // 14. list_security_roles
  server.tool("list_security_roles", "List all security roles defined in the solution with privilege counts", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseRoles(solution), null, 2) }] }));

  // 15. list_web_resources
  server.tool("list_web_resources", "List all web resources (HTML, JS, CSS, images, SVG, RESX) with file types and sizes", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseWebResources(solution), null, 2) }] }));

  // 16. list_canvas_apps
  server.tool("list_canvas_apps", "List all Canvas Apps (.msapp files) in the solution", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseCanvasApps(solution), null, 2) }] }));

  // 17. list_environment_variables
  server.tool("list_environment_variables", "List all environment variables with their type (String, Number, Boolean, JSON, Secret, Data Source) and default values", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseEnvironmentVariables(solution), null, 2) }] }));

  // 18. list_custom_connectors
  server.tool("list_custom_connectors", "List all custom connectors with their OpenAPI definition, host, auth type, and operation count", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseCustomConnectors(solution), null, 2) }] }));

  // 19. list_plugin_assemblies
  server.tool("list_plugin_assemblies", "List all plugin assemblies (DLLs) included in the solution", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parsePluginAssemblies(solution), null, 2) }] }));

  // 20. list_app_modules
  server.tool("list_app_modules", "List all model-driven apps defined in the solution", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseAppModules(solution), null, 2) }] }));

  // 21. list_option_sets
  server.tool("list_option_sets", "List all global option sets (choices) with their options/values", solParam,
    async ({ solution }) => ({ content: [{ type: "text", text: JSON.stringify(parseOptionSets(solution), null, 2) }] }));

  // 22. get_sitemap
  server.tool("get_sitemap", "Get the sitemap navigation structure (areas, groups, sub-areas) for model-driven apps", solParam,
    async ({ solution }) => {
      const sm = parseSiteMap(solution);
      if (!sm) return { content: [{ type: "text", text: "No sitemap found." }] };
      return { content: [{ type: "text", text: JSON.stringify(sm, null, 2) }] };
    });

  // 23. search_solution
  server.tool("search_solution", "Full-text search across all solution files (flows, topics, actions, prompts, XML, JSON) for a keyword",
    { ...solParam, query: z.string().describe("Search keyword or phrase") },
    async ({ solution, query }) => {
      const sp = solPath(solution);
      if (!existsSync(sp)) return { content: [{ type: "text", text: "Solution not found." }] };
      const results: Array<{ file: string; matches: string[] }> = [];
      const q = query.toLowerCase();
      function walk(dir: string) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) walk(full);
          else if (stat.isFile() && stat.size < 500_000) {
            try {
              const content = readFileSync(full, "utf-8");
              if (content.toLowerCase().includes(q)) {
                results.push({
                  file: full.replace(sp, "").replace(/\\/g, "/"),
                  matches: content.split("\n").filter((l) => l.toLowerCase().includes(q)).slice(0, 5).map((l) => l.trim().substring(0, 200)),
                });
              }
            } catch {}
          }
        }
      }
      walk(sp);
      return { content: [{ type: "text", text: results.length ? JSON.stringify(results, null, 2) : `No matches for "${query}".` }] };
    });

  // 24. get_raw_file
  server.tool("get_raw_file", "Read any raw file from the extracted solution by relative path",
    { ...solParam, file_path: z.string().describe("Relative path within the solution (e.g. solution.xml, Workflows/MyFlow.json)") },
    async ({ solution, file_path }) => {
      const content = readSolFile(solution, ...file_path.split(/[\/\\]/));
      if (!content) return { content: [{ type: "text", text: `File not found: ${file_path}` }] };
      return { content: [{ type: "text", text: content.substring(0, 50000) }] };
    });

  // ── MCP Resources ────────────────────────────────────────────────
  // Resources provide context the agent can read without a tool call.
  // Copilot Studio shows these in the "Resources" tab.

  // Dynamic resource for each solution's overview
  for (const solDir of listSolutionDirs()) {
    const info = parseSolutionXml(solDir);
    const displayName = info?.displayName || info?.uniqueName || solDir;

    server.resource(
      `solution-overview-${solDir}`,
      `solution://${solDir}/overview`,
      {
        description: `Complete overview of the "${displayName}" Power Platform solution — components, flows, agents, connectors, and more`,
        mimeType: "text/markdown",
      },
      async () => ({
        contents: [{ uri: `solution://${solDir}/overview`, mimeType: "text/markdown", text: summarizeSolution(solDir) }],
      })
    );

    server.resource(
      `solution-manifest-${solDir}`,
      `solution://${solDir}/manifest`,
      {
        description: `Raw solution.xml manifest for "${displayName}" — metadata, publisher, root components`,
        mimeType: "application/xml",
      },
      async () => ({
        contents: [{ uri: `solution://${solDir}/manifest`, mimeType: "application/xml", text: readSolFile(solDir, "solution.xml") || "" }],
      })
    );

    // Agent system prompt as a resource (if present)
    const gptComp = parseBotComponents(solDir).find((c) => c.type === "gpt");
    if (gptComp) {
      server.resource(
        `agent-prompt-${solDir}`,
        `solution://${solDir}/agent-prompt`,
        {
          description: `System prompt / instructions for the Copilot Studio agent in "${displayName}"`,
          mimeType: "text/yaml",
        },
        async () => ({
          contents: [{ uri: `solution://${solDir}/agent-prompt`, mimeType: "text/yaml", text: getBotComponentData(solDir, gptComp.folder) || "" }],
        })
      );
    }

    // Flow definitions as resources
    const flows = parseFlows(solDir);
    for (const flow of flows) {
      server.resource(
        `flow-${solDir}-${flow.id}`,
        `solution://${solDir}/flow/${encodeURIComponent(flow.name)}`,
        {
          description: `Power Automate flow definition: "${flow.name}" [${flow.categoryName}] — ${flow.description || "no description"}`,
          mimeType: "application/json",
        },
        async () => {
          const def = getFlowDefinition(solDir, flow.jsonFile);
          return {
            contents: [{ uri: `solution://${solDir}/flow/${encodeURIComponent(flow.name)}`, mimeType: "application/json", text: JSON.stringify(def, null, 2) }],
          };
        }
      );
    }

    // Connectors summary as a resource
    server.resource(
      `connectors-${solDir}`,
      `solution://${solDir}/connectors`,
      {
        description: `All connection references and connectors used by "${displayName}"`,
        mimeType: "application/json",
      },
      async () => ({
        contents: [{ uri: `solution://${solDir}/connectors`, mimeType: "application/json", text: JSON.stringify(parseConnectors(solDir), null, 2) }],
      })
    );
  }

  return server;
}

// ── HTTP Server ─────────────────────────────────────────────────────
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "Power Platform Solution Explorer MCP", version: "2.0.0", tools: 24, solutions: listSolutionDirs() }));
    return;
  }

  if (req.url === "/mcp") {
    if (req.method === "GET" || req.method === "DELETE") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed. Use POST." }));
      return;
    }
    if (req.method === "POST") {
      try {
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err: any) {
        console.error("MCP error:", err);
        if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message })); }
      }
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── Startup ─────────────────────────────────────────────────────────
console.log(`\n  Power Platform Solution Explorer MCP Server v2.0`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  ZIP drop folder: ${SOLUTIONS_DIR}`);
console.log(`  Extracted to:    ${EXTRACTED_DIR}`);

const newlyExtracted = autoExtractZips();
if (newlyExtracted.length) console.log(`  New extractions: ${newlyExtracted.join(", ")}`);

httpServer.listen(PORT, () => {
  console.log(`  MCP endpoint:    http://localhost:${PORT}/mcp`);
  console.log(`  Health check:    http://localhost:${PORT}/health`);
  console.log(`  Tools:           24`);
  console.log(`  Solutions:       ${listSolutionDirs().join(", ") || "none"}`);
  console.log(`\n  Drop .zip files into ${SOLUTIONS_DIR} and restart.\n`);
});
