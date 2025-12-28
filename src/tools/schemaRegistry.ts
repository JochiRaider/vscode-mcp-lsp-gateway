// src/tools/schemaRegistry.ts
//
// Loads tool input JSON Schemas from `schemas/tools/**`, compiles them with Ajv exactly once,
// and provides deterministic validation results for MCP tools/call.
//
// Conventions (v1):
// - One schema file per tool, named: `schemas/tools/<toolName>.json`
//   Example: `schemas/tools/vscode.lsp.definition.json`
// - Root schema MUST be an object schema and MUST set `additionalProperties: false`.
//
// Validation behavior (v1):
// - No type coercion, no default injection, no mutation of the provided args.
// - On validation failure: return a deterministic JSON-RPC error object with code -32602
//   and `error.data.code === "MCP_LSP_GATEWAY/INVALID_PARAMS"`.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import type { JsonRpcErrorObject } from "../mcp/jsonrpc";
import {
  V1_TOOL_NAMES,
  type V1ToolName,
  type JsonSchemaObject,
  isV1ToolName,
} from "./catalog";

export const TOOL_SCHEMA_DIR = path.join("schemas", "tools");

export const ERROR_CODE_INVALID_PARAMS = "MCP_LSP_GATEWAY/INVALID_PARAMS" as const;
export const ERROR_CODE_PROVIDER_UNAVAILABLE = "MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE" as const;

export type ValidateInputResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export class SchemaRegistry {
  private static singleton: SchemaRegistry | undefined;

  public static async getOrCreate(context: vscode.ExtensionContext): Promise<SchemaRegistry> {
    if (SchemaRegistry.singleton) return SchemaRegistry.singleton;
    const created = await SchemaRegistry.create(context);
    SchemaRegistry.singleton = created;
    return created;
  }

  public static async create(context: vscode.ExtensionContext): Promise<SchemaRegistry> {
    // Use both extensionUri and asAbsolutePath (per contract guidance).
    // extensionUri is useful for future fs APIs; asAbsolutePath yields a stable on-disk path.
    const toolsDirUri = vscode.Uri.joinPath(context.extensionUri, "schemas", "tools");
    const toolsDirFsPath = context.asAbsolutePath(TOOL_SCHEMA_DIR);

    // Defensive: ensure the schema directory exists.
    // Fail closed: missing schema directory is a build/package error.
    if (!fs.existsSync(toolsDirFsPath) || !fs.statSync(toolsDirFsPath).isDirectory()) {
      throw new Error(
        `Schema directory missing or not a directory: ${toolsDirFsPath} (uri: ${toolsDirUri.toString()})`,
      );
    }

    const ajv = new Ajv({
      allErrors: true,
      strict: true,
      allowUnionTypes: true,
      validateSchema: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
    });

    const schemaByTool = new Map<V1ToolName, JsonSchemaObject>();
    const validateByTool = new Map<V1ToolName, ValidateFunction>();

    for (const toolName of V1_TOOL_NAMES) {
      const fileName = `${toolName}.json`;
      const absPath = context.asAbsolutePath(path.join(TOOL_SCHEMA_DIR, fileName));

      // Fail closed: every v1 tool must have a schema file.
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        throw new Error(`Missing tool schema file for "${toolName}": ${absPath}`);
      }

      const raw = fs.readFileSync(absPath, "utf8");
      const schema = safeParseJson(raw, absPath);
      assertRootSchemaInvariants(toolName, schema);

      const validate = ajv.compile(schema);
      schemaByTool.set(toolName, schema);
      validateByTool.set(toolName, validate);
    }

    return new SchemaRegistry(schemaByTool, validateByTool);
  }

  private constructor(
    private readonly schemaByTool: Map<V1ToolName, JsonSchemaObject>,
    private readonly validateByTool: Map<V1ToolName, ValidateFunction>,
  ) {}

  public getInputSchema(toolName: V1ToolName): JsonSchemaObject {
    const schema = this.schemaByTool.get(toolName);
    if (!schema) throw new Error(`Schema not loaded for tool: ${toolName}`);
    return schema;
  }

  /**
   * Validate tool call arguments deterministically.
   *
   * - Returns `ok: true` with the original `args` value (Ajv is configured not to mutate).
   * - Returns `ok: false` with a JSON-RPC error object (-32602) and stable `error.data.code`.
   */
  public validateInput(toolName: string, args: unknown): ValidateInputResult {
    if (!isV1ToolName(toolName)) {
      return {
        ok: false,
        error: {
          code: -32602,
          message: "Invalid params",
          data: {
            code: ERROR_CODE_PROVIDER_UNAVAILABLE,
            tool: toolName,
          },
        },
      };
    }

    const validate = this.validateByTool.get(toolName);
    if (!validate) {
      // Should never happen if create() succeeded, but fail closed deterministically.
      return {
        ok: false,
        error: {
          code: -32602,
          message: "Invalid params",
          data: {
            code: ERROR_CODE_PROVIDER_UNAVAILABLE,
            tool: toolName,
          },
        },
      };
    }

    const ok = validate(args);

    if (ok) {
      return { ok: true, value: args };
    }

    const issues = formatAjvErrors(validate.errors);

    return {
      ok: false,
      error: {
        code: -32602,
        message: "Invalid params",
        data: {
          code: ERROR_CODE_INVALID_PARAMS,
          tool: toolName,
          issues,
        },
      },
    };
  }
}

function safeParseJson(raw: string, absPath: string): JsonSchemaObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in schema file: ${absPath}. ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Schema file does not contain a JSON object: ${absPath}`);
  }
  return parsed as JsonSchemaObject;
}

function assertRootSchemaInvariants(toolName: V1ToolName, schema: JsonSchemaObject): void {
  const t = schema["type"];
  if (t !== "object") {
    throw new Error(`Tool schema root must have type "object" (${toolName}).`);
  }

  // Enforce contract requirement to prevent foot-guns and test ambiguity.
  const ap = schema["additionalProperties"];
  if (ap !== false) {
    throw new Error(`Tool schema root must set additionalProperties: false (${toolName}).`);
  }
}

type AjvIssue = Readonly<{
  path: string;
  keyword: string;
  message: string;
  schemaPath: string;
}>;

/**
 * Convert Ajv errors into a stable, bounded list.
 * We intentionally omit `params` to avoid leaking large values and reduce churn across Ajv versions.
 */
function formatAjvErrors(errors: ErrorObject[] | null | undefined): readonly AjvIssue[] {
  if (!errors || errors.length === 0) return [];

  const issues: AjvIssue[] = errors.map((e) => ({
    path: e.instancePath ?? "",
    keyword: e.keyword ?? "",
    message: e.message ?? "Schema validation failed",
    schemaPath: e.schemaPath ?? "",
  }));

  // Deterministic ordering.
  issues.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.keyword !== b.keyword) return a.keyword < b.keyword ? -1 : 1;
    if (a.schemaPath !== b.schemaPath) return a.schemaPath < b.schemaPath ? -1 : 1;
    if (a.message !== b.message) return a.message < b.message ? -1 : 1;
    return 0;
  });

  // Bound output (DoS + log bloat guard).
  const MAX_ISSUES = 10;
  return issues.length > MAX_ISSUES ? issues.slice(0, MAX_ISSUES) : issues;
}
