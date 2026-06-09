const SOURCE_PAGE_URL = "https://kis-net.kr/kisnet_mobile/index.html";
const SOURCE_BASE_URL = "https://kis-net.kr";
const INIT_ENDPOINT = "/rateInfo/ytmMatrixMobileInitList.do";
const LIST_ENDPOINT = "/rateInfo/ytmMatrixMobileList.do";

const STATIC_KINDS = [
  { code: "10", name: "국채" },
  { code: "20", name: "지방채" },
  { code: "30", name: "특수채" },
  { code: "40", name: "통안채" },
  { code: "50", name: "은행채" },
  { code: "60", name: "기타금융채" },
  { code: "70", name: "회사채(무보증)" }
];

const TENORS = [
  ["m3", "3M"],
  ["m6", "6M"],
  ["m9", "9M"],
  ["y1", "1Y"],
  ["y15a", "1.5Y"],
  ["y2", "2Y"],
  ["y25", "2.5Y"],
  ["y3", "3Y"],
  ["y5", "5Y"],
  ["y7", "7Y"],
  ["y10", "10Y"],
  ["y15", "15Y"],
  ["y20", "20Y"],
  ["y30", "30Y"],
  ["y50", "50Y"]
];

const operationSpecs = [
  {
    name: "lookup-ytm-matrix",
    label: "Lookup KIS-NET YTM Matrix",
    description: "Fetch YTM Matrix rows from KIS-NET for a 기준일 and 종류. The source-native 종류 may be a Korean label such as 국채 or a source code such as 10.",
    requiredInputKeys: ["baseDate", "kind"],
    inputJsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["baseDate", "kind"],
      properties: {
        baseDate: {
          type: "string",
          description: "기준일. Accepted forms: YYYY-MM-DD, YYYY.MM.DD, or YYYYMMDD."
        },
        kind: {
          type: ["string", "number"],
          description: "종류. Use a Korean source label such as 국채 or a source code such as 10."
        }
      }
    },
    resultJsonSchema: {
      type: "object",
      required: ["baseDate", "kind", "tenors", "rows", "source"],
      properties: {
        baseDate: { type: "string" },
        kind: { type: "object" },
        tenors: { type: "array", items: { type: "string" } },
        rows: { type: "array" },
        source: { type: "object" }
      }
    },
    examples: [
      { input: { baseDate: "2026-06-08", kind: "국채" } },
      { input: { baseDate: "20260608", kind: "10" } }
    ],
    limitations: [
      "KIS-NET decides available 기준일 data and may return an empty matrix for non-business days or unavailable dates.",
      "Yield cells containing '-' are returned as null while preserving the raw cell text."
    ],
    resultSummary: "Returns the resolved 종류, tenor labels, one row per 적용대상채권, numeric yield values, raw source cells, and source request metadata."
  },
  {
    name: "list-ytm-sorts",
    label: "List KIS-NET YTM 종류 values",
    description: "List source 종류 codes and Korean labels for the KIS-NET YTM Matrix. When baseDate is supplied, values are refreshed from KIS-NET's init endpoint; otherwise the inspected source list is returned without a network request.",
    requiredInputKeys: [],
    inputJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        baseDate: {
          type: "string",
          description: "Optional 기준일 used to refresh 종류 values from KIS-NET. Accepted forms: YYYY-MM-DD, YYYY.MM.DD, or YYYYMMDD."
        }
      }
    },
    resultJsonSchema: {
      type: "object",
      required: ["kinds", "source"],
      properties: {
        baseDate: { type: ["string", "null"] },
        kinds: { type: "array" },
        source: { type: "object" }
      }
    },
    examples: [
      { input: {} },
      { input: { baseDate: "2026-06-08" } }
    ],
    limitations: [
      "Without baseDate this command returns the source list observed during tool inspection instead of performing a live request."
    ],
    resultSummary: "Returns accepted 종류 codes and labels."
  }
];

export class KisnetYtmError extends Error {
  constructor(details) {
    super(details.message || details.reason || details.code);
    this.name = "KisnetYtmError";
    this.details = details;
  }
}

export function createKisnetYtmToolset(options = {}) {
  return {
    id: "kisnet-ytm",
    label: "KIS-NET YTM Matrix",
    description: "Deterministic lookup tool for KIS-NET YTM Matrix data using 기준일 and 종류.",
    help() {
      return [
        "KIS-NET YTM Matrix toolset",
        "",
        "Operations:",
        "  lookup-ytm-matrix: fetch YTM Matrix rows for a 기준일 and 종류.",
        "  list-ytm-sorts: list accepted 종류 codes and Korean labels.",
        "",
        "Source terms are preserved where official: 기준일, 종류, 국채, 지방채, 특수채, 통안채, 은행채, 기타금융채, 회사채(무보증).",
        "Use validateInput(operationName, input) before execute when integrating in-process."
      ].join("\n");
    },
    listOperations() {
      return operationSpecs.map((spec) => ({ ...spec }));
    },
    getOperation(name) {
      return operationSpecs.find((spec) => spec.name === name);
    },
    getCommandHelp(name) {
      if (name === "lookup-ytm-matrix") {
        return [
          "lookup-ytm-matrix",
          "  Input JSON: { \"baseDate\": \"2026-06-08\", \"kind\": \"국채\" }",
          "  baseDate maps to 기준일 and accepts YYYY-MM-DD, YYYY.MM.DD, or YYYYMMDD.",
          "  kind maps to 종류 and accepts a Korean label or source code.",
          "  Result rows include 적용대상채권 and tenors 3M through 50Y."
        ].join("\n");
      }
      if (name === "list-ytm-sorts") {
        return [
          "list-ytm-sorts",
          "  Input JSON: {} or { \"baseDate\": \"2026-06-08\" }",
          "  Returns accepted 종류 source codes and Korean labels."
        ].join("\n");
      }
      return undefined;
    },
    validateInput(operationName, input) {
      return validateInput(operationName, input);
    },
    async execute(operationName, input, context = {}) {
      const validation = validateInput(operationName, input);
      if (!validation.valid) throw new KisnetYtmError(validation.error);
      const safeInput = validation.normalizedInput;
      if (operationName === "lookup-ytm-matrix") return lookupYtmMatrix(safeInput, { ...context, ...options });
      if (operationName === "list-ytm-sorts") return listYtmSorts(safeInput, { ...context, ...options });
      throw new KisnetYtmError(unknownOperationError(operationName));
    },
    serializeError(error) {
      return serializeError(error);
    }
  };
}

export function validateInput(operationName, input) {
  const spec = operationSpecs.find((candidate) => candidate.name === operationName);
  if (!spec) return { valid: false, error: unknownOperationError(operationName) };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: validationError({ operationName, code: "invalid_request", reason: "Input must be a JSON object.", expected: "object", actual: safeActual(input), exampleInput: spec.examples[0].input, recoveryHint: "Pass a JSON object matching the command input schema." }) };
  }

  const allowed = Object.keys(spec.inputJsonSchema.properties || {});
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      return { valid: false, error: validationError({ operationName, code: "unknown_parameter", parameter: key, reason: `Unknown parameter: ${key}.`, expected: allowed, actual: key, exampleInput: spec.examples[0].input, recoveryHint: `Remove ${key} or inspect command help for supported parameters.` }) };
    }
  }

  for (const key of spec.requiredInputKeys) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      return { valid: false, error: validationError({ operationName, code: "missing_parameter", parameter: key, reason: `Missing required parameter: ${key}.`, expected: spec.inputJsonSchema.properties[key], actual: safeActual(input[key]), exampleInput: spec.examples[0].input, recoveryHint: `Provide ${key}.` }) };
    }
  }

  const normalized = { ...input };
  if (input.baseDate !== undefined) {
    const date = normalizeBaseDate(input.baseDate);
    if (!date) {
      return { valid: false, error: validationError({ operationName, code: "invalid_parameter", parameter: "baseDate", reason: "baseDate must be a valid 기준일 in YYYY-MM-DD, YYYY.MM.DD, or YYYYMMDD form.", expected: "YYYY-MM-DD, YYYY.MM.DD, or YYYYMMDD", actual: safeActual(input.baseDate), exampleInput: spec.examples[0].input, recoveryHint: "Use the official 기준일 date shown by KIS-NET, for example 2026-06-08." }) };
    }
    normalized.baseDate = date.display;
    Object.defineProperty(normalized, "baseDateCompact", {
      value: date.compact,
      enumerable: false,
      configurable: true
    });
  }
  if (operationName === "lookup-ytm-matrix") {
    if (!["string", "number"].includes(typeof input.kind)) {
      return { valid: false, error: validationError({ operationName, code: "invalid_parameter", parameter: "kind", reason: "kind must be a 종류 label or source code.", expected: "string or number", actual: safeActual(input.kind), exampleInput: spec.examples[0].input, recoveryHint: "Use list-ytm-sorts to inspect accepted 종류 values, then retry with a code like 10 or label like 국채." }) };
    }
    normalized.kind = String(input.kind).trim();
  }

  return { valid: true, normalizedInput: normalized };
}

async function lookupYtmMatrix(input, context) {
  const kindsResult = await listYtmSorts({ baseDate: input.baseDate, baseDateCompact: input.baseDateCompact }, context);
  const kind = resolveKind(input.kind, kindsResult.kinds);
  if (!kind) {
    throw new KisnetYtmError({
      ok: false,
      code: "invalid_parameter",
      operationName: "lookup-ytm-matrix",
      parameter: "kind",
      reason: `Unknown 종류: ${input.kind}.`,
      expected: kindsResult.kinds,
      actual: input.kind,
      exampleInput: { baseDate: input.baseDate, kind: kindsResult.kinds[0]?.name || "국채" },
      recoveryHint: "Use list-ytm-sorts to inspect accepted 종류 values, then retry with a listed code or label.",
      recoveryAction: "inspect_command_help",
      recoverable: true,
      retryable: false
    });
  }

  const xml = buildRequestXml({
    serviceId: "search1",
    endpoint: LIST_ENDPOINT,
    outDatasets: "ds_list=output1",
    baseDateCompact: input.baseDateCompact,
    kindCode: kind.code
  });
  const responseXml = await postNexacroXml(LIST_ENDPOINT, xml, context);
  const sourceRows = parseDataset(responseXml, "output1");

  return {
    baseDate: input.baseDate,
    kind,
    tenors: TENORS.map(([, label]) => label),
    rows: sourceRows.map((row) => normalizeMatrixRow(row, kind)),
    source: {
      pageUrl: SOURCE_PAGE_URL,
      endpoint: `${SOURCE_BASE_URL}${LIST_ENDPOINT}`,
      method: "POST",
      request: {
        format: "Nexacro XML PlatformData",
        inDatasets: "ds_search=ds_search gds_tranInfo=gds_tranInfo",
        outDatasets: "ds_list=output1",
        parameters: { calBaseDt: input.baseDateCompact, cboYtmSort: kind.code }
      },
      inspectedWorkflow: "The mobile page posts ds_search to /rateInfo/ytmMatrixMobileList.do when 검색 is clicked."
    }
  };
}

async function listYtmSorts(input = {}, context = {}) {
  if (!input.baseDateCompact) {
    return {
      baseDate: null,
      kinds: STATIC_KINDS.map((kind) => ({ ...kind })),
      source: {
        pageUrl: SOURCE_PAGE_URL,
        endpoint: null,
        method: null,
        note: "Static 종류 list observed from KIS-NET init response during tool inspection. Provide baseDate to refresh from the source endpoint."
      }
    };
  }
  const xml = buildRequestXml({
    serviceId: "search",
    endpoint: INIT_ENDPOINT,
    outDatasets: "ds_tymSort=output1 ds_list=output2",
    baseDateCompact: input.baseDateCompact,
    kindCode: "10"
  });
  const responseXml = await postNexacroXml(INIT_ENDPOINT, xml, context);
  const rows = parseDataset(responseXml, "output1");
  return {
    baseDate: input.baseDate,
    kinds: rows.map((row) => ({ code: String(row.divCode || "").trim(), name: String(row.divName || "").trim() })).filter((kind) => kind.code && kind.name),
    source: {
      pageUrl: SOURCE_PAGE_URL,
      endpoint: `${SOURCE_BASE_URL}${INIT_ENDPOINT}`,
      method: "POST",
      request: {
        format: "Nexacro XML PlatformData",
        inDatasets: "ds_search=ds_search gds_tranInfo=gds_tranInfo",
        outDatasets: "ds_tymSort=output1 ds_list=output2",
        parameters: { calBaseDt: input.baseDateCompact, cboYtmSort: "10" }
      },
      inspectedWorkflow: "The mobile page posts ds_search to /rateInfo/ytmMatrixMobileInitList.do on initial YTM Matrix load."
    }
  };
}

function resolveKind(inputKind, kinds) {
  const value = String(inputKind).trim();
  return kinds.find((kind) => kind.code === value || kind.name === value || kind.name.replace(/\s+/g, "") === value.replace(/\s+/g, ""));
}

function normalizeMatrixRow(row, kind) {
  const yields = {};
  const yieldText = {};
  for (const [key, label] of TENORS) {
    const raw = row[key] === undefined ? "" : String(row[key]).trim();
    yieldText[label] = raw;
    yields[label] = raw === "" || raw === "-" ? null : Number(raw);
  }
  return {
    groupName: kind.name,
    pricingGroupCode: String(row.pricingGroupCode || "").trim(),
    pricingGroupName: String(row.pricingGroupName || "").trim(),
    yields,
    yieldText,
    raw: { ...row }
  };
}

async function postNexacroXml(endpoint, body, context = {}) {
  const fetchImpl = context.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new KisnetYtmError({ code: "invalid_request", reason: "No fetch implementation is available. Use Bun 1.3+ or pass context.fetch.", recoveryHint: "Run this package with Bun 1.3 or newer.", recoveryAction: "inspect_tool_help", recoverable: true, retryable: false });
  }
  const response = await fetchImpl(`${SOURCE_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "text/xml; charset=UTF-8",
      "accept": "text/xml, */*",
      "user-agent": "kisnet-ytm/0.1.0"
    },
    body,
    signal: context.signal
  });
  const text = await response.text();
  if (!response.ok) {
    throw new KisnetYtmError({ code: "invalid_request", reason: `KIS-NET returned HTTP ${response.status}.`, expected: "HTTP 200", actual: response.status, recoveryHint: "Retry later or inspect whether KIS-NET is available.", recoveryAction: "inspect_tool_help", recoverable: true, retryable: true });
  }
  const errorCode = parseParameter(text, "ErrorCode");
  if (errorCode && errorCode !== "0") {
    throw new KisnetYtmError({ code: "invalid_request", reason: `KIS-NET returned ErrorCode ${errorCode}.`, expected: "ErrorCode 0", actual: errorCode, recoveryHint: "Check 기준일 and 종류, then retry with valid source values.", recoveryAction: "inspect_command_help", recoverable: true, retryable: false });
  }
  return text;
}

function buildRequestXml({ serviceId, endpoint, outDatasets, baseDateCompact, kindCode }) {
  const inDatasets = "ds_search=ds_search gds_tranInfo=gds_tranInfo";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Root xmlns="http://www.nexacroplatform.com/platform/dataset">\n  <Parameters/>\n  <Dataset id="ds_search">\n    <ColumnInfo>\n      <Column id="pageIndex" type="STRING" size="256"/>\n      <Column id="pageSize" type="STRING" size="256"/>\n      <Column id="pageUnit" type="STRING" size="256"/>\n      <Column id="calBaseDt" type="STRING" size="256"/>\n      <Column id="cboYtmSort" type="STRING" size="256"/>\n    </ColumnInfo>\n    <Rows><Row>\n      <Col id="pageIndex">1</Col>\n      <Col id="pageSize">10</Col>\n      <Col id="pageUnit">10</Col>\n      <Col id="calBaseDt">${escapeXml(baseDateCompact)}</Col>\n      <Col id="cboYtmSort">${escapeXml(kindCode)}</Col>\n    </Row></Rows>\n  </Dataset>\n  <Dataset id="gds_tranInfo">\n    <ColumnInfo>\n      <Column id="svcID" type="STRING" size="32"/>\n      <Column id="URL" type="STRING" size="32"/>\n      <Column id="inDatasets" type="STRING" size="32"/>\n      <Column id="outDatasets" type="STRING" size="32"/>\n      <Column id="browserType" type="STRING" size="32"/>\n    </ColumnInfo>\n    <Rows><Row>\n      <Col id="svcID">${escapeXml(serviceId)}</Col>\n      <Col id="URL">${escapeXml(endpoint)}</Col>\n      <Col id="inDatasets">${escapeXml(inDatasets)}</Col>\n      <Col id="outDatasets">${escapeXml(outDatasets)}</Col>\n      <Col id="browserType">Chrome</Col>\n    </Row></Rows>\n  </Dataset>\n</Root>`;
}

function parseDataset(xml, id) {
  const match = new RegExp(`<Dataset\\s+id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/Dataset>`).exec(xml);
  if (!match) return [];
  const rows = [];
  const rowPattern = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(match[1]))) {
    const row = {};
    const colPattern = /<Col\s+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Col>/g;
    let colMatch;
    while ((colMatch = colPattern.exec(rowMatch[1]))) {
      row[decodeXml(colMatch[1])] = decodeXml(colMatch[2]);
    }
    rows.push(row);
  }
  return rows;
}

function parseParameter(xml, id) {
  const match = new RegExp(`<Parameter\\s+id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/Parameter>`).exec(xml);
  return match ? decodeXml(match[1]).trim() : undefined;
}

function normalizeBaseDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^(\d{4})(?:[-.]?)(\d{2})(?:[-.]?)(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, yyyy, mm, dd] = match;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(Number(yyyy), month - 1, day));
  if (date.getUTCFullYear() !== Number(yyyy) || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { display: `${yyyy}-${mm}-${dd}`, compact: `${yyyy}${mm}${dd}` };
}

function validationError(details) {
  return {
    ok: false,
    code: details.code,
    operationName: details.operationName,
    parameter: details.parameter,
    reason: details.reason,
    expected: details.expected,
    actual: details.actual,
    exampleInput: details.exampleInput,
    recoveryHint: details.recoveryHint,
    recoveryAction: details.parameter ? "inspect_command_help" : "inspect_tool_help",
    recoverable: true,
    retryable: false
  };
}

function unknownOperationError(operationName) {
  return validationError({
    operationName,
    code: "invalid_request",
    reason: `Unknown operation: ${operationName}.`,
    expected: operationSpecs.map((spec) => spec.name),
    actual: safeActual(operationName),
    exampleInput: { operationName: "lookup-ytm-matrix", input: { baseDate: "2026-06-08", kind: "국채" } },
    recoveryHint: "Inspect tool help and retry with a listed operation name."
  });
}

function serializeError(error) {
  if (error instanceof KisnetYtmError) return error.details;
  if (error && typeof error === "object" && error.details) return error.details;
  return {
    ok: false,
    code: "invalid_request",
    reason: error instanceof Error ? error.message : String(error),
    recoveryHint: "Inspect command help and retry. If the source is unavailable, retry later.",
    recoveryAction: "inspect_tool_help",
    recoverable: true,
    retryable: true
  };
}

function safeActual(value) {
  if (value === undefined) return "[missing]";
  if (value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  return "[object]";
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function decodeXml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
