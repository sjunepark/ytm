const SOURCE_PAGE_URL = "https://kis-net.kr/kisnet_mobile/index.html";
const SOURCE_BASE_URL = "https://kis-net.kr";
const INIT_ENDPOINT = "/rateInfo/ytmMatrixMobileInitList.do";
const LIST_ENDPOINT = "/rateInfo/ytmMatrixMobileList.do";
const FALLBACK_PREVIOUS_AVAILABLE = "previous-available";
const DEFAULT_LOOKBACK_DAYS = 10;
const MAX_LOOKBACK_DAYS = 31;

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
const REQUIRED_MATRIX_COLUMNS = ["pricingGroupCode", "pricingGroupName", ...TENORS.map(([key]) => key)];
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

const operationSpecs = [
  {
    name: "matrix",
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
        },
        fallback: {
          type: "string",
          enum: [FALLBACK_PREVIOUS_AVAILABLE],
          description: "Optional unavailable-date policy. Use previous-available to try the requested 기준일 once, then walk backward until KIS-NET returns matrix rows."
        },
        lookbackDays: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LOOKBACK_DAYS,
          description: `Maximum prior calendar days to try when fallback is ${FALLBACK_PREVIOUS_AVAILABLE}. Defaults to ${DEFAULT_LOOKBACK_DAYS}.`
        }
      }
    },
    resultJsonSchema: {
      type: "object",
      required: ["baseDate", "kind", "tenors", "rows", "source", "requestedBaseDate", "dateResolution"],
      properties: {
        baseDate: { type: "string" },
        requestedBaseDate: { type: "string" },
        dateResolution: { type: "object" },
        kind: { type: "object" },
        tenors: { type: "array", items: { type: "string" } },
        rows: { type: "array" },
        source: { type: "object" }
      }
    },
    examples: [
      { input: { baseDate: "2026-06-08", kind: "국채" } },
      { input: { baseDate: "20260608", kind: "10" } },
      { input: { baseDate: "2026-06-07", kind: "국채", fallback: FALLBACK_PREVIOUS_AVAILABLE, lookbackDays: 10 } }
    ],
    limitations: [
      "KIS-NET decides available 기준일 data and may return an empty matrix for non-business days, holidays, or unavailable dates.",
      `With fallback=${FALLBACK_PREVIOUS_AVAILABLE}, the requested 기준일 is still tried first; previous dates are probed only after KIS-NET returns no rows.`,
      "Yield cells containing '-' are returned as null while preserving the raw cell text."
    ],
    resultSummary: "Returns the resolved 종류, tenor labels, one row per 적용대상채권, numeric yield values, raw source cells, source request metadata, and date-resolution metadata."
  },
  {
    name: "kinds",
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
    id: "ytm",
    label: "KIS-NET YTM Matrix",
    description: "Deterministic lookup tool for KIS-NET YTM Matrix data using 기준일 and 종류.",
    help() {
      return [
        "KIS-NET YTM Matrix toolset",
        "",
        "Operations:",
        "  matrix: fetch YTM Matrix rows for a 기준일 and 종류.",
        "  kinds: list accepted 종류 codes and Korean labels.",
        "",
        "Accepted 종류 values:",
        ...formatKindsForHelp().map((line) => `  ${line}`),
        "",
        "Source terms are preserved where official: 기준일, 종류, and 적용대상채권.",
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
      if (name === "matrix") {
        return [
          "matrix",
          "  Input JSON: { \"baseDate\": \"2026-06-08\", \"kind\": \"국채\" }",
          `  Optional fallback: { "fallback": "${FALLBACK_PREVIOUS_AVAILABLE}", "lookbackDays": ${DEFAULT_LOOKBACK_DAYS} }`,
          "  baseDate maps to 기준일 and accepts YYYY-MM-DD, YYYY.MM.DD, or YYYYMMDD.",
          "  kind maps to 종류 and accepts one of these Korean labels or source codes:",
          ...formatKindsForHelp().map((line) => `    ${line}`),
          `  fallback=${FALLBACK_PREVIOUS_AVAILABLE} tries the requested date once, then walks backward until rows are found.`,
          `  lookbackDays defaults to ${DEFAULT_LOOKBACK_DAYS} and may not exceed ${MAX_LOOKBACK_DAYS}.`,
          "  Run kinds to print this list as JSON, CSV, or TSV.",
          "  Result rows include 적용대상채권, tenors 3M through 50Y, and dateResolution metadata."
        ].join("\n");
      }
      if (name === "kinds") {
        return [
          "kinds",
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
      if (operationName === "matrix") return lookupYtmMatrix(safeInput, { ...context, ...options });
      if (operationName === "kinds") return listYtmSorts(safeInput, { ...context, ...options });
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
  if (operationName === "matrix") {
    if (!["string", "number"].includes(typeof input.kind)) {
      return { valid: false, error: validationError({ operationName, code: "invalid_parameter", parameter: "kind", reason: "kind must be a 종류 label or source code.", expected: "string or number", actual: safeActual(input.kind), exampleInput: spec.examples[0].input, recoveryHint: "Use kinds to inspect accepted 종류 values, then retry with a code like 10 or label like 국채." }) };
    }
    normalized.kind = String(input.kind).trim();

    if (input.fallback !== undefined) {
      if (input.fallback !== FALLBACK_PREVIOUS_AVAILABLE) {
        return { valid: false, error: validationError({ operationName, code: "invalid_parameter", parameter: "fallback", reason: `fallback must be ${FALLBACK_PREVIOUS_AVAILABLE}.`, expected: [FALLBACK_PREVIOUS_AVAILABLE], actual: safeActual(input.fallback), exampleInput: spec.examples[2].input, recoveryHint: `Use fallback=${FALLBACK_PREVIOUS_AVAILABLE}, or omit fallback for exact-date behavior.` }) };
      }
      normalized.fallback = FALLBACK_PREVIOUS_AVAILABLE;
    }

    if (input.lookbackDays !== undefined) {
      if (input.fallback !== FALLBACK_PREVIOUS_AVAILABLE) {
        return { valid: false, error: validationError({ operationName, code: "invalid_parameter", parameter: "lookbackDays", reason: `lookbackDays only applies when fallback is ${FALLBACK_PREVIOUS_AVAILABLE}.`, expected: { fallback: FALLBACK_PREVIOUS_AVAILABLE, lookbackDays: `integer 1-${MAX_LOOKBACK_DAYS}` }, actual: safeActual(input.lookbackDays), exampleInput: spec.examples[2].input, recoveryHint: `Add fallback=${FALLBACK_PREVIOUS_AVAILABLE}, or remove lookbackDays for exact-date behavior.` }) };
      }
      const lookbackDays = normalizeLookbackDays(input.lookbackDays);
      if (lookbackDays === null) {
        return { valid: false, error: validationError({ operationName, code: "invalid_parameter", parameter: "lookbackDays", reason: `lookbackDays must be an integer from 1 to ${MAX_LOOKBACK_DAYS}.`, expected: `integer 1-${MAX_LOOKBACK_DAYS}`, actual: safeActual(input.lookbackDays), exampleInput: spec.examples[2].input, recoveryHint: `Use a small calendar-day lookback window such as ${DEFAULT_LOOKBACK_DAYS}.` }) };
      }
      normalized.lookbackDays = lookbackDays;
    } else if (input.fallback === FALLBACK_PREVIOUS_AVAILABLE) {
      normalized.lookbackDays = DEFAULT_LOOKBACK_DAYS;
    }
  }

  return { valid: true, normalizedInput: normalized };
}

async function lookupYtmMatrix(input, context) {
  const mode = input.fallback === FALLBACK_PREVIOUS_AVAILABLE ? FALLBACK_PREVIOUS_AVAILABLE : "exact";
  const lookbackDays = mode === FALLBACK_PREVIOUS_AVAILABLE ? input.lookbackDays : 0;
  const attempts = buildDateAttempts(input.baseDate, lookbackDays);
  const attemptedDates = [];

  for (const attempt of attempts) {
    attemptedDates.push(attempt.display);
    try {
      const result = await lookupYtmMatrixForDate({ ...input, baseDate: attempt.display, baseDateCompact: attempt.compact }, context);
      return withDateResolution(result, {
        mode,
        requestedBaseDate: input.baseDate,
        attemptedDates,
        lookbackDays
      });
    } catch (error) {
      if (isSourceDataUnavailable(error) && mode === FALLBACK_PREVIOUS_AVAILABLE && attemptedDates.length < attempts.length) continue;
      if (isSourceDataUnavailable(error)) {
        throw new KisnetYtmError(sourceDataUnavailableError({
          operationName: "matrix",
          baseDate: input.baseDate,
          kind: input.kind,
          attemptedDates,
          lookbackDays,
          fallbackExhausted: mode === FALLBACK_PREVIOUS_AVAILABLE,
          reason: mode === FALLBACK_PREVIOUS_AVAILABLE
            ? `KIS-NET returned no YTM Matrix rows for ${input.baseDate} or the prior ${lookbackDays} calendar day(s).`
            : `KIS-NET returned no YTM Matrix rows for ${input.baseDate}. It may be a weekend, holiday, or unavailable source date.`
        }));
      }
      throw error;
    }
  }

  throw new KisnetYtmError(sourceDataUnavailableError({
    operationName: "matrix",
    baseDate: input.baseDate,
    kind: input.kind,
    attemptedDates,
    lookbackDays,
    reason: `KIS-NET returned no YTM Matrix rows for ${input.baseDate}.`
  }));
}

async function lookupYtmMatrixForDate(input, context) {
  const kindsResult = await listYtmSorts({ baseDate: input.baseDate, baseDateCompact: input.baseDateCompact }, context);
  const kind = resolveKind(input.kind, kindsResult.kinds);
  if (!kind) {
    throw new KisnetYtmError({
      ok: false,
      code: "invalid_parameter",
      operationName: "matrix",
      parameter: "kind",
      reason: `Unknown 종류: ${input.kind}.`,
      expected: kindsResult.kinds,
      actual: input.kind,
      exampleInput: { baseDate: input.baseDate, kind: kindsResult.kinds[0]?.name || "국채" },
      recoveryHint: "Use kinds to inspect accepted 종류 values, then retry with a listed code or label.",
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
  if (sourceRows.length === 0) {
    throw new KisnetYtmError(sourceDataUnavailableError({
      operationName: "matrix",
      baseDate: input.baseDate,
      kind: input.kind,
      attemptedDates: [input.baseDate],
      reason: `KIS-NET returned no YTM Matrix rows for ${input.baseDate}. It may be a weekend, holiday, or unavailable source date.`
    }));
  }

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
  const kinds = rows.map((row) => ({ code: String(row.divCode || "").trim(), name: String(row.divName || "").trim() }));
  if (kinds.some((kind) => !kind.code || !kind.name)) {
    throw new KisnetYtmError(sourceFormatError("KIS-NET kind row is missing divCode or divName."));
  }
  if (kinds.length === 0) {
    throw new KisnetYtmError(sourceDataUnavailableError({
      operationName: "kinds",
      baseDate: input.baseDate,
      attemptedDates: [input.baseDate],
      reason: `KIS-NET returned no 종류 values for ${input.baseDate}. It may be a weekend, holiday, or unavailable source date.`
    }));
  }
  return {
    baseDate: input.baseDate,
    kinds,
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

function withDateResolution(result, { mode, requestedBaseDate, attemptedDates, lookbackDays }) {
  return {
    ...result,
    requestedBaseDate,
    dateResolution: {
      mode,
      requestedBaseDate,
      resolvedBaseDate: result.baseDate,
      usedFallback: result.baseDate !== requestedBaseDate,
      attemptedDates: [...attemptedDates],
      lookbackDays
    }
  };
}

function buildDateAttempts(baseDate, lookbackDays) {
  const attempts = [];
  for (let offset = 0; offset <= lookbackDays; offset += 1) {
    attempts.push(shiftBaseDate(baseDate, -offset));
  }
  return attempts;
}

function shiftBaseDate(baseDate, deltaDays) {
  const [year, month, day] = baseDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return { display: `${yyyy}-${mm}-${dd}`, compact: `${yyyy}${mm}${dd}` };
}

function isSourceDataUnavailable(error) {
  return Boolean(error && typeof error === "object" && error.details?.code === "source_data_unavailable");
}

function sourceDataUnavailableError({ operationName, baseDate, kind, attemptedDates, lookbackDays = 0, fallbackExhausted = false, reason }) {
  const fallbackHint = operationName !== "matrix"
    ? "Try a nearby business day."
    : fallbackExhausted
      ? `No data was found in the fallback window. Try a known business day, or increase lookbackDays up to ${MAX_LOOKBACK_DAYS}.`
      : `Try a nearby business day, or rerun matrix with fallback=${FALLBACK_PREVIOUS_AVAILABLE}.`;
  const nearbyExampleDate = /^\d{4}-\d{2}-\d{2}$/.test(String(baseDate)) ? shiftBaseDate(baseDate, -1).display : "2026-06-08";
  const matrixExampleInput = fallbackExhausted
    ? { baseDate: nearbyExampleDate, kind: kind || "국채" }
    : { baseDate, kind: kind || "국채", fallback: FALLBACK_PREVIOUS_AVAILABLE, lookbackDays: DEFAULT_LOOKBACK_DAYS };
  return {
    ok: false,
    code: "source_data_unavailable",
    operationName,
    parameter: "baseDate",
    reason,
    expected: "KIS-NET data for an available business 기준일",
    actual: baseDate,
    exampleInput: operationName === "matrix" ? matrixExampleInput : { baseDate: nearbyExampleDate },
    recoveryHint: fallbackHint,
    recoveryAction: operationName === "matrix" && !fallbackExhausted ? "use_previous_available_fallback" : "try_nearby_business_day",
    recoverable: true,
    retryable: false,
    attemptedDates: [...attemptedDates],
    lookbackDays
  };
}

function resolveKind(inputKind, kinds) {
  const value = String(inputKind).trim();
  return kinds.find((kind) => kind.code === value || kind.name === value || kind.name.replace(/\s+/g, "") === value.replace(/\s+/g, ""));
}

function formatKindsForHelp() {
  return STATIC_KINDS.map((kind) => `${kind.code} = ${kind.name}`);
}

function normalizeMatrixRow(row, kind) {
  const missingColumns = REQUIRED_MATRIX_COLUMNS.filter((column) => !Object.hasOwn(row, column));
  if (missingColumns.length > 0) {
    throw new KisnetYtmError(sourceFormatError(`KIS-NET matrix row is missing required column(s): ${missingColumns.join(", ")}.`));
  }
  if (!String(row.pricingGroupCode).trim() || !String(row.pricingGroupName).trim()) {
    throw new KisnetYtmError(sourceFormatError("KIS-NET matrix row contains an empty pricing group code or name."));
  }
  const yields = {};
  const yieldText = {};
  for (const [key, label] of TENORS) {
    const raw = row[key] === undefined ? "" : String(row[key]).trim();
    yieldText[label] = raw;
    if (raw === "" || raw === "-") {
      yields[label] = null;
      continue;
    }
    if (!DECIMAL_TEXT.test(raw) || !Number.isFinite(Number(raw))) {
      throw new KisnetYtmError(sourceFormatError(`KIS-NET matrix column ${key} contains an invalid numeric value.`));
    }
    yields[label] = Number(raw);
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
    throw new KisnetYtmError({ code: "invalid_request", reason: "No fetch implementation is available. Use Node 20.18.1+ or pass context.fetch.", recoveryHint: "Run this package with Node 20.18.1 or newer.", recoveryAction: "inspect_tool_help", recoverable: true, retryable: false });
  }
  let response;
  try {
    response = await fetchImpl(`${SOURCE_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=UTF-8",
        "accept": "text/xml, */*",
        "user-agent": "ytm/0.1.0"
      },
      body,
      signal: context.signal
    });
  } catch (error) {
    throw new KisnetYtmError(sourceTransportError("KIS-NET request failed before a response was received.", error));
  }
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw new KisnetYtmError(sourceTransportError("KIS-NET response body could not be read.", error));
  }
  if (!response.ok) {
    throw new KisnetYtmError(sourceTransportError(`KIS-NET returned HTTP ${response.status}.`, undefined, response.status));
  }
  if (!/<Root(?:\s|>)[\s\S]*<\/Root>\s*$/.test(text)) {
    throw new KisnetYtmError(sourceFormatError("KIS-NET returned malformed Nexacro XML."));
  }
  const errorCode = parseParameter(text, "ErrorCode");
  if (errorCode === undefined) {
    throw new KisnetYtmError(sourceFormatError("KIS-NET response is missing the required ErrorCode parameter."));
  }
  if (errorCode !== "0") {
    const errorMessage = parseParameter(text, "ErrorMsg") || parseParameter(text, "ErrorMessage");
    throw new KisnetYtmError(sourceFormatError(`KIS-NET returned protocol ErrorCode ${errorCode}${errorMessage ? ` (${errorMessage})` : ""}.`));
  }
  return text;
}

function sourceTransportError(reason, cause, status) {
  return {
    ok: false,
    code: "source_transport_error",
    reason,
    expected: "A successful HTTP response from KIS-NET",
    actual: status === undefined ? undefined : status,
    recoveryHint: "Retry later or inspect whether KIS-NET is available.",
    recoveryAction: "inspect_tool_help",
    recoverable: true,
    retryable: true,
    cause: cause instanceof Error ? cause.name : undefined
  };
}

function sourceFormatError(reason) {
  return {
    ok: false,
    code: "source_format_error",
    reason,
    expected: "A valid KIS-NET Nexacro response matching the documented YTM Matrix schema",
    recoveryHint: "The KIS-NET source format may have changed; update the package before retrying.",
    recoveryAction: "inspect_tool_help",
    recoverable: false,
    retryable: false
  };
}

function buildRequestXml({ serviceId, endpoint, outDatasets, baseDateCompact, kindCode }) {
  const inDatasets = "ds_search=ds_search gds_tranInfo=gds_tranInfo";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Root xmlns="http://www.nexacroplatform.com/platform/dataset">\n  <Parameters/>\n  <Dataset id="ds_search">\n    <ColumnInfo>\n      <Column id="pageIndex" type="STRING" size="256"/>\n      <Column id="pageSize" type="STRING" size="256"/>\n      <Column id="pageUnit" type="STRING" size="256"/>\n      <Column id="calBaseDt" type="STRING" size="256"/>\n      <Column id="cboYtmSort" type="STRING" size="256"/>\n    </ColumnInfo>\n    <Rows><Row>\n      <Col id="pageIndex">1</Col>\n      <Col id="pageSize">10</Col>\n      <Col id="pageUnit">10</Col>\n      <Col id="calBaseDt">${escapeXml(baseDateCompact)}</Col>\n      <Col id="cboYtmSort">${escapeXml(kindCode)}</Col>\n    </Row></Rows>\n  </Dataset>\n  <Dataset id="gds_tranInfo">\n    <ColumnInfo>\n      <Column id="svcID" type="STRING" size="32"/>\n      <Column id="URL" type="STRING" size="32"/>\n      <Column id="inDatasets" type="STRING" size="32"/>\n      <Column id="outDatasets" type="STRING" size="32"/>\n      <Column id="browserType" type="STRING" size="32"/>\n    </ColumnInfo>\n    <Rows><Row>\n      <Col id="svcID">${escapeXml(serviceId)}</Col>\n      <Col id="URL">${escapeXml(endpoint)}</Col>\n      <Col id="inDatasets">${escapeXml(inDatasets)}</Col>\n      <Col id="outDatasets">${escapeXml(outDatasets)}</Col>\n      <Col id="browserType">Chrome</Col>\n    </Row></Rows>\n  </Dataset>\n</Root>`;
}

function parseDataset(xml, id) {
  const match = new RegExp(`<Dataset\\s+id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/Dataset>`).exec(xml);
  if (!match) {
    throw new KisnetYtmError(sourceFormatError(`KIS-NET response is missing required dataset ${id}.`));
  }
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

function extractRequestColumn(xml, id) {
  const match = new RegExp(`<Col\\s+id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/Col>`).exec(xml);
  return match ? decodeXml(match[1]).trim() : undefined;
}

function compactToDisplay(value) {
  if (!/^\d{8}$/.test(String(value || ""))) return undefined;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function normalizeLookbackDays(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_LOOKBACK_DAYS) return null;
  return value;
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
    exampleInput: { operationName: "matrix", input: { baseDate: "2026-06-08", kind: "국채" } },
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
