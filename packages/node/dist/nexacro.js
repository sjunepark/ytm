import xmldom from "@xmldom/xmldom";

const { DOMParser, onWarningStopParsing } = xmldom;

const NEXACRO_NAMESPACE = "http://www.nexacroplatform.com/platform/dataset";
const MAX_ELEMENT_DEPTH = 64;
const REPLACEMENT_CHARACTER_WARNING = "Unicode replacement character detected, source encoding issues?";
const PROTOCOL_ELEMENTS = new Set([
  "Root",
  "Parameters",
  "Parameter",
  "Dataset",
  "Rows",
  "Row",
  "Col"
]);
const ERROR_CODE_TEXT = /^[+-]?[0-9]+$/;
const ZERO_ERROR_CODE_TEXT = /^[+-]?0+$/;
const XML_DECLARATION_START = /^<\?xml(?:[ \t\r\n]|\?>)/;
const XML_DECLARATION = /^[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(["'])([^"']+)\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])([^"']+)\3)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(["'])(yes|no)\5)?[ \t\r\n]*$/;

export class NexacroResponseError extends Error {
  constructor(message, { errorCode, errorMessage } = {}) {
    super(message);
    this.name = "NexacroResponseError";
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
  }

  get isProtocolError() {
    return this.errorCode !== undefined;
  }
}

export function parseNexacroDataset(xml, datasetId) {
  let source = String(xml);
  validateXmlCharacters(source);
  if (source.startsWith("\uFEFF")) source = source.slice(1);
  validateXmlDeclaration(source);

  let document;
  try {
    document = new DOMParser({ onError: stopOnXmlDiagnostic }).parseFromString(source, "text/xml");
  } catch (error) {
    throw formatError("KIS-NET returned malformed Nexacro XML", error);
  }
  if (document.doctype) {
    throw formatError("KIS-NET response must not contain a DOCTYPE declaration");
  }

  const root = document.documentElement;
  if (!root || root.localName !== "Root" || root.namespaceURI !== NEXACRO_NAMESPACE) {
    throw formatError("KIS-NET response root must be a Nexacro Root element");
  }
  validateProtocolTree(root);

  const parameterContainers = directChildren(root, "Parameters");
  if (parameterContainers.length !== 1) {
    throw formatError("KIS-NET response must contain exactly one direct Parameters element");
  }
  const parameters = directChildren(parameterContainers[0], "Parameter");
  const errorCodes = parametersById(parameters, "ErrorCode");
  const errorMessages = parametersById(parameters, "ErrorMsg");
  const legacyErrorMessages = parametersById(parameters, "ErrorMessage");
  if (errorCodes.length !== 1) {
    throw formatError("KIS-NET response must contain exactly one ErrorCode parameter");
  }
  if (errorMessages.length > 1 || legacyErrorMessages.length > 1) {
    throw formatError("KIS-NET response contains duplicate error-message parameters");
  }

  const primaryMessage = errorMessages.length ? scalarText(errorMessages[0], "ErrorMsg").trim() : "";
  const legacyMessage = legacyErrorMessages.length ? scalarText(legacyErrorMessages[0], "ErrorMessage").trim() : "";
  const errorCode = scalarText(errorCodes[0], "ErrorCode").trim();
  if (!ERROR_CODE_TEXT.test(errorCode)) {
    throw formatError("KIS-NET response contains an invalid ErrorCode parameter");
  }
  if (!ZERO_ERROR_CODE_TEXT.test(errorCode)) {
    const errorMessage = primaryMessage || legacyMessage || undefined;
    throw new NexacroResponseError(
      `KIS-NET returned nonzero Nexacro ErrorCode ${errorCode}${errorMessage ? ` (${errorMessage})` : ""}`,
      { errorCode, errorMessage }
    );
  }

  const datasets = directChildren(root, "Dataset").filter((element) => element.getAttribute("id") === datasetId);
  if (datasets.length !== 1) {
    throw formatError(`KIS-NET response must contain exactly one direct dataset ${datasetId}`);
  }
  const rowsContainers = directChildren(datasets[0], "Rows");
  if (rowsContainers.length !== 1) {
    throw formatError(`KIS-NET dataset ${datasetId} must contain exactly one direct Rows element`);
  }

  return directChildren(rowsContainers[0], "Row").map((rowElement) => parseRow(rowElement));
}

function stopOnXmlDiagnostic(level, message) {
  if (level === "warning" && message === REPLACEMENT_CHARACTER_WARNING) return;
  onWarningStopParsing();
}

function validateXmlDeclaration(source) {
  if (!XML_DECLARATION_START.test(source)) return;
  const declarationEnd = source.indexOf("?>");
  if (declarationEnd < 0) {
    throw formatError("KIS-NET response contains a malformed XML declaration");
  }
  const declaration = XML_DECLARATION.exec(source.slice(5, declarationEnd));
  if (!declaration) {
    throw formatError("KIS-NET response contains a malformed XML declaration");
  }
  if (declaration[2] !== "1.0") {
    throw formatError("KIS-NET response must use XML 1.0");
  }
  const encoding = declaration[4];
  if (encoding !== undefined && encoding.toLowerCase() !== "utf-8") {
    throw formatError("KIS-NET response must use UTF-8 encoding");
  }
}

function parseRow(rowElement) {
  const row = Object.create(null);
  for (const column of directChildren(rowElement, "Col")) {
    const id = column.getAttribute("id");
    if (id === null || !id.trim()) {
      throw formatError("KIS-NET response contains a Col without a nonempty id");
    }
    if (Object.hasOwn(row, id)) {
      throw formatError(`KIS-NET response row contains duplicate column ${id}`);
    }
    row[id] = scalarText(column, `Col ${id}`);
  }
  return row;
}

function validateProtocolTree(root) {
  const pending = [{ element: root, depth: 1 }];
  while (pending.length) {
    const { element, depth } = pending.pop();
    if (depth > MAX_ELEMENT_DEPTH) {
      throw formatError(`KIS-NET response exceeds the maximum XML element depth of ${MAX_ELEMENT_DEPTH}`);
    }
    if (PROTOCOL_ELEMENTS.has(element.localName) && element.namespaceURI !== NEXACRO_NAMESPACE) {
      throw formatError(`KIS-NET protocol element ${element.localName} has an invalid namespace`);
    }
    for (let index = 0; index < element.attributes.length; index += 1) {
      validateXmlCharacters(element.attributes.item(index).value);
    }
    for (const child of element.childNodes) {
      if (child.nodeType === 1) pending.push({ element: child, depth: depth + 1 });
      if (child.nodeType === 3 || child.nodeType === 4) validateXmlCharacters(child.data);
    }
  }
}

function validateXmlCharacters(value) {
  for (const character of String(value)) {
    if (!isXmlCharacter(character.codePointAt(0))) {
      throw formatError("KIS-NET response contains a character forbidden by XML 1.0");
    }
  }
}

function isXmlCharacter(codePoint) {
  return codePoint === 0x9
    || codePoint === 0xA
    || codePoint === 0xD
    || (codePoint >= 0x20 && codePoint <= 0xD7FF)
    || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
    || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
}

function directChildren(parent, localName) {
  const matches = [];
  for (const child of parent.childNodes) {
    if (child.nodeType === 1 && child.localName === localName && child.namespaceURI === NEXACRO_NAMESPACE) {
      matches.push(child);
    }
  }
  return matches;
}

function parametersById(parameters, id) {
  return parameters.filter((element) => element.getAttribute("id") === id);
}

function scalarText(element, label) {
  let value = "";
  for (const child of element.childNodes) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      value += child.data;
    } else if (child.nodeType === 1) {
      throw formatError(`KIS-NET response ${label} contains nested element content`);
    }
  }
  return value;
}

function formatError(message, cause) {
  const error = new NexacroResponseError(message);
  if (cause !== undefined) error.cause = cause;
  return error;
}
