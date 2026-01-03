---
name: lsp-audit-schema-runtime-consistency
description: "Audit schema vs runtime vs tests for consistency by tracing validation/serialization paths and documenting drift. Use when reviewing JSON schema/IDL/OpenAPI/Ajv/Zod/CLI/config contracts, tool inputs/outputs, or protocol changes (keywords: schema, validate, ajv, zod, openapi, contract, parse, serialize, request, response, drift)."
---

# Lsp Audit Schema Runtime Consistency

## Overview

Identify drift between declared schemas/docs/tests and runtime behavior by tracing symbols from schema definitions to validators and handlers, then reporting mismatches with concrete evidence.

## Inputs

Required:

- Schema entry name(s) or schema-related keywords
- Optional tool/method/endpoint name if scoped
- Optional file paths if the target schema location is known

## Outputs

- Drift findings list with `(field/symbol, expected, observed, evidence)` per item
- Call-outs for missing/insufficient tests when required fields or errors are unverified
- Short “no drift found” conclusion when no mismatches are detected

## Procedure

1. Locate schema definitions using `workspaceSymbols` and keywords like `schema`, `validate`, `ajv`, `zod`, `openapi`, `contract`.
2. Trace schema usage to validators with `references`; note where schemas are compiled or invoked.
3. Trace runtime handlers/serializers back to schema types using `references` and `definition`.
4. Compare schema constraints vs runtime behavior:
   - fields present in runtime but absent in schema
   - fields required by schema but not enforced in runtime
   - serializer outputs not reflected in schema or docs
5. Check tests that cover the schema/handler paths; flag missing assertions for required fields, error mapping, or output filtering.
6. Produce the drift findings list with evidence (file path + symbol/line pointer).

## Verification

Confirm:

- Every reported drift item cites the schema source and the runtime/handler source.
- Output list is stable and deduped (sort by schema symbol, then runtime location).

## Failure modes

- Schema location unclear: ask user to provide file paths or concrete schema entry names.
- Symbols not found: broaden keyword search or request the exact tool/method name.
- Runtime validation indirect (shared helpers): trace the helper definitions and list the call chain as evidence.

## Examples

### Should trigger

- "Audit the JSON schema vs runtime validator for the hover tool."
- "Do schemas/docs/tests match what runtime accepts/returns for diagnostics?"
- "Find contract drift between OpenAPI and the handler serialization."

### Should NOT trigger

- "Write new schemas for this endpoint."
- "Refactor handlers for performance."
- "Run the test suite."
