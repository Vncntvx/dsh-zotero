window.__ModuleLoader__.load({ id: "dsh-zotero", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/zotero-command-input.ts
var ZOTERO_COMMAND = "zotero";
function formatCommandLine(name, args) {
  const commandName = name ?? ZOTERO_COMMAND;
  const trimmed = (args ?? "").trim();
  return trimmed === "" ? `/${commandName}` : `/${commandName} ${trimmed}`;
}
function zoteroCommandText(event) {
  return formatCommandLine(event.data.name, event.data.args);
}
var zoteroCommandInputDefinition = {
  kind: "zotero-command-input",
  target: "chat",
  match: (event) => event.type === "command/run" && event.data.name === ZOTERO_COMMAND ? { id: String(event.data.commandId), role: "start" } : null,
  start: (_context, match) => {
    if (match.event.type !== "command/run") {
      throw new Error("zotero-command-input start requires command/run");
    }
    return {
      commandId: match.event.data.commandId,
      seq: match.event.seq,
      time: match.event.time,
      text: zoteroCommandText(match.event)
    };
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    if (context.state === void 0) return null;
    return {
      key: context.key,
      kind: "zotero-command-input",
      id: context.id,
      target: "chat",
      // Sit just before the run's own seq so the typed line reads above the
      // generic command result row that owns that seq, matching ui-goal's
      // command-input projection.
      anchorSeq: context.state.seq - 0.1,
      location: context.start?.location ?? { kind: "unresolved" },
      visibility: "visible",
      data: {
        commandId: context.state.commandId,
        text: context.state.text,
        time: context.state.time
      }
    };
  }
};

// src/client/ZoteroCommandInputView.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/ZoteroCommandInputView.module.css
var style = `.ytsxFq_row{flex-direction:column;align-items:flex-end;gap:6px;display:flex}.ytsxFq_stack{min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%);flex-direction:column;align-items:flex-end;display:flex}.ytsxFq_bubble{overflow-wrap:anywhere;border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;padding:10px 16px}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/ZoteroCommandInputView.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/ZoteroCommandInputView.module.css");
  tag.textContent = style;
  document.head.appendChild(tag);
}
var ZoteroCommandInputView_default = { "row": "ytsxFq_row", "stack": "ytsxFq_stack", "bubble": "ytsxFq_bubble" };

// src/client/ZoteroCommandInputView.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function ZoteroCommandInputView({ node, t }) {
  const data = node.data;
  const split = data.text.search(/\s/u);
  const head = split === -1 ? data.text : data.text.slice(0, split);
  const rest = split === -1 ? "" : data.text.slice(split);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: ZoteroCommandInputView_default.row, "data-command-input": "", role: "group", "aria-label": t("commandInputAria"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: ZoteroCommandInputView_default.stack, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: ZoteroCommandInputView_default.bubble, children: [
    (0, import_dsh_client_ui_primitives.projectUserText)(head, [], [ZOTERO_COMMAND], "command"),
    rest !== "" && (0, import_dsh_client_ui_primitives.projectUserText)(rest, [])
  ] }) }) });
}

// src/client/ZoteroCommandCard.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/plugin/diagnosis.ts
var CODE_TO_KEY = {
  ZOTERO_NOT_RUNNING: "diagnosisNotRunning",
  ZOTERO_API_DISABLED: "diagnosisApiDisabled",
  ZOTERO_API_VERSION: "diagnosisApiVersion",
  ZOTERO_TIMEOUT: "diagnosisTimeout",
  ZOTERO_PROVIDER_UNAVAILABLE: "diagnosisProviderUnavailable",
  ZOTERO_CAPABILITY_UNAVAILABLE: "diagnosisCapabilityUnavailable"
};
function splitCode(raw) {
  const match = /^([A-Z][A-Z0-9_]*):\s*([\s\S]+)$/.exec(raw);
  if (match) return { code: match[1], message: match[2].trim() };
  return { message: raw };
}
function formatDiagnosis(rawDiagnosis, t) {
  if (rawDiagnosis.trim() === "") {
    return { message: t("diagnosisUnknown") };
  }
  const { code, message } = splitCode(rawDiagnosis);
  const known = code !== void 0 ? CODE_TO_KEY[code] : void 0;
  if (known !== void 0) {
    return { message: t(known), rawCode: code };
  }
  for (const [candidate, key] of Object.entries(CODE_TO_KEY)) {
    if (rawDiagnosis.includes(candidate)) {
      return { message: t(key), rawCode: candidate };
    }
  }
  if (rawDiagnosis.includes("not composed")) {
    return { message: t("diagnosisNotComposed") };
  }
  if (code !== void 0) {
    return { message, rawCode: code };
  }
  return { message: rawDiagnosis };
}
function diagnosisLine(rawDiagnosis, t) {
  const formatted = formatDiagnosis(rawDiagnosis, t);
  return formatted.rawCode ? `${t("diagnosisLabel")} ${formatted.rawCode}: ${formatted.message}` : `${t("diagnosisLabel")}: ${formatted.message}`;
}

// src/client/components/DiagnosisBox.module.css
var style2 = `.WtsoIq_diagnosisBox{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);flex-direction:column;gap:4px;padding:8px 10px;display:flex}.WtsoIq_diagnosisHead{align-items:center;gap:6px;display:flex}.WtsoIq_diagnosisLabelText{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:16px}.WtsoIq_diagnosisCode{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-4);color:var(--dsw-alias-state-warn-label);padding:1px 4px;font-size:10px;line-height:14px}.WtsoIq_diagnosisMessage{color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/DiagnosisBox.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/DiagnosisBox.module.css");
  tag.textContent = style2;
  document.head.appendChild(tag);
}
var DiagnosisBox_default = { "diagnosisMessage": "WtsoIq_diagnosisMessage", "diagnosisBox": "WtsoIq_diagnosisBox", "diagnosisCode": "WtsoIq_diagnosisCode", "diagnosisLabelText": "WtsoIq_diagnosisLabelText", "diagnosisHead": "WtsoIq_diagnosisHead" };

// src/client/components/DiagnosisBox.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function DiagnosisBox({ diagnosis, t }) {
  const formatted = formatDiagnosis(diagnosis, t);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: DiagnosisBox_default.diagnosisBox, "data-zotero-diagnosis-box": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: DiagnosisBox_default.diagnosisHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: DiagnosisBox_default.diagnosisLabelText, children: [
        t("diagnosisLabel"),
        ":"
      ] }),
      formatted.rawCode ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { className: DiagnosisBox_default.diagnosisCode, children: formatted.rawCode }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: DiagnosisBox_default.diagnosisMessage, children: formatted.message })
  ] });
}

// src/client/components/useZoteroProbe.ts
var import_react = require("react");
function useZoteroProbe(probe, options) {
  const [state, setState] = (0, import_react.useState)({
    loading: options?.initialAutoRun ?? false
  });
  const inFlightRef = (0, import_react.useRef)(false);
  const unmountedRef = (0, import_react.useRef)(false);
  (0, import_react.useEffect)(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);
  const runProbe = (0, import_react.useCallback)(async () => {
    if (!probe || inFlightRef.current) return;
    inFlightRef.current = true;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await probe();
      if (unmountedRef.current) return;
      if (res.ok) {
        setState({
          loading: false,
          data: res.value,
          error: res.value.connected ? void 0 : res.value.diagnosis
        });
      } else {
        setState({
          loading: false,
          error: res.error.message
        });
      }
    } catch (err) {
      if (unmountedRef.current) return;
      setState({
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [probe]);
  (0, import_react.useEffect)(() => {
    if (options?.initialAutoRun && probe) {
      void runProbe();
    }
  }, [options?.initialAutoRun, probe, runProbe]);
  return { state, runProbe };
}

// src/client/components/write-label.ts
function writeStatusLabel(write, t) {
  if (write === void 0) return "-";
  if (!write.enabled) return t("writeDisabledLabel");
  return write.authorized ? t("writeAuthorizedLabel") : t("writeUnauthorizedLabel");
}

// src/settings-namespace.ts
var ZOTERO_SETTINGS_NAMESPACE = "zotero";

// src/contract.ts
var ZOTERO_REMOTE_PACKAGE = "dsh-zotero";
var ZOTERO_STATUS_TYPE_SYMBOL = "dsh-zotero#ZoteroStatusView";
var ZOTERO_STATUS_INVOCATION_ID = "dsh-zotero#zotero/status";
var ZOTERO_STATUS_SERVICE_KEY = "zoteroRemote";
var ZOTERO_STATUS_METHOD = "status";
var ZOTERO_STATUS_INVOCATION_KIND = "direct";
function zoteroStatusInvocation(result) {
  return {
    id: ZOTERO_STATUS_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_STATUS_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    parameters: [],
    result
  };
}
var ZOTERO_STATUS_CONNECTED = "Zotero local API: connected";
var ZOTERO_STATUS_DISCONNECTED = "Zotero local API: not connected";
var ZOTERO_STATUS_NOT_REPORTED = "not reported";
var ZOTERO_STATUS_SERVER_ID_UNREPORTED = "Server ID: not reported \u2014 this build does not identify its database, so refs and cursors cannot be pinned to it";
var ZOTERO_STATUS_FIELD_VERSION = "Zotero version";
var ZOTERO_STATUS_FIELD_API = "API version";
var ZOTERO_STATUS_FIELD_SCHEMA = "Schema version";
var ZOTERO_STATUS_FIELD_SERVER_ID = "Server ID";
var ZOTERO_STATUS_FIELD_WRITE = "Write";
var ZOTERO_STATUS_FIELD_ENDPOINT = "Local API";
var ZOTERO_STATUS_WRITE_DISABLED = "disabled";
var ZOTERO_STATUS_WRITE_ENABLED_STORED = "enabled (key stored)";
var ZOTERO_STATUS_WRITE_ENABLED_PENDING = "enabled (no key yet)";

// src/client/status-parser.ts
function parseField(line, label) {
  const prefix = `${label}:`;
  if (!line.startsWith(prefix)) return void 0;
  const val = line.slice(prefix.length).trim();
  return val === ZOTERO_STATUS_NOT_REPORTED ? void 0 : val;
}
function parseWrite(line) {
  const prefix = `${ZOTERO_STATUS_FIELD_WRITE}:`;
  if (!line.startsWith(prefix)) return void 0;
  const val = line.slice(prefix.length).trim();
  if (val === ZOTERO_STATUS_WRITE_DISABLED) {
    return { enabled: false, authorized: false };
  }
  if (val === ZOTERO_STATUS_WRITE_ENABLED_STORED) {
    return { enabled: true, authorized: true };
  }
  if (val === ZOTERO_STATUS_WRITE_ENABLED_PENDING) {
    return { enabled: true, authorized: false };
  }
  return void 0;
}
function parseZoteroStatusText(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const lines = trimmed.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const firstLine = lines[0];
  if (firstLine.startsWith(ZOTERO_STATUS_CONNECTED)) {
    let endpoint;
    let zoteroVersion;
    let apiVersion;
    let schemaVersion;
    let serverId;
    let serverIdUnreported = false;
    let write;
    const serverIdPrefix = `${ZOTERO_STATUS_FIELD_SERVER_ID}:`;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const parsedEndpoint = parseField(line, ZOTERO_STATUS_FIELD_ENDPOINT);
      if (parsedEndpoint !== void 0) {
        endpoint = parsedEndpoint;
        continue;
      }
      const parsedVer = parseField(line, ZOTERO_STATUS_FIELD_VERSION);
      if (parsedVer !== void 0) {
        zoteroVersion = parsedVer;
        continue;
      }
      const parsedApi = parseField(line, ZOTERO_STATUS_FIELD_API);
      if (parsedApi !== void 0) {
        apiVersion = parsedApi;
        continue;
      }
      const parsedSchema = parseField(line, ZOTERO_STATUS_FIELD_SCHEMA);
      if (parsedSchema !== void 0) {
        schemaVersion = parsedSchema;
        continue;
      }
      if (line === ZOTERO_STATUS_SERVER_ID_UNREPORTED) {
        serverIdUnreported = true;
        continue;
      }
      if (line.startsWith(serverIdPrefix)) {
        const val = line.slice(serverIdPrefix.length).trim();
        if (val.startsWith(ZOTERO_STATUS_NOT_REPORTED)) {
          serverIdUnreported = true;
        } else {
          serverId = val;
        }
        continue;
      }
      const parsedWrite = parseWrite(line);
      if (parsedWrite !== void 0) {
        write = parsedWrite;
        continue;
      }
    }
    return {
      connected: true,
      ...endpoint === void 0 ? {} : { endpoint },
      zoteroVersion,
      apiVersion,
      schemaVersion,
      serverId: serverIdUnreported ? void 0 : serverId,
      serverIdUnreported: serverIdUnreported || void 0,
      write,
      rawText: trimmed
    };
  }
  if (firstLine.startsWith(ZOTERO_STATUS_DISCONNECTED)) {
    const rest = lines.slice(1);
    const parsedEndpoint = parseField(rest[0] ?? "", ZOTERO_STATUS_FIELD_ENDPOINT);
    const diagnosis = rest.slice(parsedEndpoint === void 0 ? 0 : 1).join("\n").trim() || void 0;
    return {
      connected: false,
      ...parsedEndpoint === void 0 ? {} : { endpoint: parsedEndpoint },
      diagnosis,
      rawText: trimmed
    };
  }
  return null;
}

// src/client/ZoteroCommandCard.module.css
var style3 = `.cZkZ3W_root{flex-direction:column;display:flex}.cZkZ3W_summarySep{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-label-caption);flex:none;width:2px;height:2px;margin:0 8px}.cZkZ3W_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);flex:auto;transition:color .1s;overflow:hidden}.cZkZ3W_summary[data-error=true]{color:var(--dsw-alias-state-error-primary)}.cZkZ3W_summaryBadge{align-items:center;gap:6px;display:inline-flex}.cZkZ3W_dotGreen{color:var(--dsw-alias-state-success-primary,#10b981)}.cZkZ3W_dotRed{color:var(--dsw-alias-state-error-primary,#ef4444)}.cZkZ3W_dotYellow{color:var(--dsw-alias-state-warn-primary,#f59e0b)}.cZkZ3W_bodyWrap{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:12px;padding:8px 12px 12px 28px;font-size:13px;line-height:1.5;display:flex}.cZkZ3W_cardGrid{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;display:grid}.cZkZ3W_cardItem{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));flex-direction:column;gap:3px;padding:8px 12px;display:flex}.cZkZ3W_itemLabel{color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.4px;font-size:11px;font-weight:500}.cZkZ3W_itemValue{font-size:12px;font-weight:500;font-family:var(--dsw-font-code,monospace);color:var(--dsw-alias-label-primary);word-break:break-all}.cZkZ3W_actionsRow{justify-content:flex-start;align-items:center;gap:8px;margin-top:2px;display:flex}.cZkZ3W_actionButton{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;align-items:center;gap:5px;padding:4px 10px;font-size:12px;transition:all .12s;display:inline-flex}.cZkZ3W_actionButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}.cZkZ3W_actionButton:disabled{opacity:.5;cursor:not-allowed}.cZkZ3W_errorBody{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-state-error-primary);font-size:12px;font-family:var(--dsw-font-code,monospace);white-space:pre-wrap;margin:0;padding:8px 12px}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/ZoteroCommandCard.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/ZoteroCommandCard.module.css");
  tag.textContent = style3;
  document.head.appendChild(tag);
}
var ZoteroCommandCard_default = { "summary": "cZkZ3W_summary", "itemValue": "cZkZ3W_itemValue", "errorBody": "cZkZ3W_errorBody", "summarySep": "cZkZ3W_summarySep", "dotYellow": "cZkZ3W_dotYellow", "dotRed": "cZkZ3W_dotRed", "dotGreen": "cZkZ3W_dotGreen", "itemLabel": "cZkZ3W_itemLabel", "actionsRow": "cZkZ3W_actionsRow", "actionButton": "cZkZ3W_actionButton", "cardGrid": "cZkZ3W_cardGrid", "cardItem": "cZkZ3W_cardItem", "root": "cZkZ3W_root", "summaryBadge": "cZkZ3W_summaryBadge", "bodyWrap": "cZkZ3W_bodyWrap" };

// src/client/ZoteroCommandCard.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function ZoteroCommandCard({ node, t, probe }) {
  const [expanded, setExpanded] = (0, import_react2.useState)(false);
  const { state: probeState, runProbe } = useZoteroProbe(probe);
  const outcome = node.outcome;
  const isRunning = outcome === null;
  const isError = outcome?.kind === "error";
  const rawText = outcome?.text ?? "";
  const parsed = (0, import_react2.useMemo)(() => parseZoteroStatusText(rawText), [rawText]);
  const handleRecheck = (0, import_react2.useCallback)(
    (e) => {
      e.stopPropagation();
      void runProbe();
    },
    [runProbe]
  );
  const handleToggle = (0, import_react2.useCallback)(() => {
    setExpanded((prev) => !prev);
  }, []);
  const title = (0, import_react2.useMemo)(() => formatCommandLine(node.name, node.args), [node.name, node.args]);
  const effective = (key, fallback) => probeState.data !== void 0 ? probeState.data[key] : probeState.error === void 0 ? fallback : void 0;
  const effectiveConnected = effective("connected", parsed?.connected) === true;
  const effectiveEndpoint = effective("endpoint", parsed?.endpoint);
  const effectiveVersion = effective("zoteroVersion", parsed?.zoteroVersion);
  const effectiveApiVersion = effective("apiVersion", parsed?.apiVersion);
  const effectiveSchemaVersion = effective("schemaVersion", parsed?.schemaVersion);
  const effectiveServerId = effective("serverId", parsed?.serverId);
  const effectiveWrite = effective("write", parsed?.write);
  const effectiveServerIdUnreported = (0, import_react2.useCallback)(() => {
    if (probeState.data !== void 0) return probeState.data.serverId === void 0;
    if (probeState.error !== void 0) return false;
    return parsed?.serverIdUnreported ?? false;
  }, [probeState.data, probeState.error, parsed]);
  const effectiveDiagnosis = probeState.error ?? probeState.data?.diagnosis ?? parsed?.diagnosis;
  const headerPrefix = (0, import_react2.useMemo)(() => {
    let dotClass = ZoteroCommandCard_default.dotGreen;
    if (probeState.loading) {
      dotClass = ZoteroCommandCard_default.dotYellow;
    } else if (isRunning) {
      dotClass = ZoteroCommandCard_default.dotYellow;
    } else if (isError || !effectiveConnected) {
      dotClass = ZoteroCommandCard_default.dotRed;
    }
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summaryBadge, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: dotClass, "aria-hidden": true, children: "\u25CF" }) });
  }, [probeState.loading, isRunning, isError, effectiveConnected]);
  const headerSummary = (0, import_react2.useMemo)(() => {
    if (isRunning) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summarySep, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summary, children: t("commandChecking") })
      ] });
    }
    if (isError) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summarySep, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summary, "data-error": "true", children: t("commandFailed") })
      ] });
    }
    if (parsed) {
      const summaryText = effectiveConnected ? `${effectiveVersion ?? t("badgeSuccess")}` : `${effectiveDiagnosis ?? t("statusUnavailable")}`;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summarySep, "aria-hidden": true }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summary, children: summaryText })
      ] });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summarySep, "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summary, children: rawText })
    ] });
  }, [
    isRunning,
    isError,
    parsed,
    effectiveConnected,
    effectiveVersion,
    effectiveDiagnosis,
    rawText,
    t
  ]);
  const writeDisplay = (0, import_react2.useMemo)(() => writeStatusLabel(effectiveWrite, t), [effectiveWrite, t]);
  const expandable = !isRunning && (parsed !== null || rawText !== "");
  const open = expanded && expandable;
  const body = (0, import_react2.useMemo)(() => {
    if (!open) return null;
    const actions = probe === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ZoteroCommandCard_default.actionsRow, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "button",
      {
        type: "button",
        className: ZoteroCommandCard_default.actionButton,
        disabled: probeState.loading,
        onClick: handleRecheck,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutlineRegular, { size: 12 }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: probeState.loading ? t("checking") : t("refresh") })
        ]
      }
    ) });
    const endpointRow = effectiveEndpoint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("statusLocalApiAddress") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: effectiveEndpoint })
    ] });
    if (!parsed) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.bodyWrap, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { className: ZoteroCommandCard_default.errorBody, children: rawText }),
        actions
      ] });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.bodyWrap, "data-zotero-command-card-body": true, children: [
      effectiveConnected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardGrid, children: [
        endpointRow,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("zoteroVersionLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: effectiveVersion ?? "-" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("apiVersionLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ZoteroCommandCard_default.itemValue, children: [
            effectiveApiVersion ?? "-",
            effectiveSchemaVersion !== void 0 ? ` (${t("schemaVersionLabel")}: ${effectiveSchemaVersion})` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("serverIdLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: effectiveServerId ?? (effectiveServerIdUnreported() ? t("statusServerIdUnreported") : "-") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("writeLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: writeDisplay })
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardGrid, children: [
        endpointRow,
        effectiveDiagnosis && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DiagnosisBox, { diagnosis: effectiveDiagnosis, t })
      ] }),
      actions
    ] });
  }, [
    open,
    parsed,
    effectiveConnected,
    effectiveEndpoint,
    effectiveVersion,
    effectiveApiVersion,
    effectiveSchemaVersion,
    effectiveServerId,
    effectiveServerIdUnreported,
    writeDisplay,
    effectiveDiagnosis,
    probe,
    probeState.loading,
    handleRecheck,
    rawText,
    t
  ]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ZoteroCommandCard_default.root, "data-zotero-command-card": true, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    import_dsh_client_ui_primitives2.DisclosureRow,
    {
      open,
      expandable,
      running: isRunning || probeState.loading,
      expandOnRowClick: true,
      onToggle: handleToggle,
      icon: headerPrefix,
      title,
      collapsedContent: headerSummary,
      children: body
    }
  ) });
}

// src/client/ZoteroSettingsSection.tsx
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/ZoteroSettingsForm.tsx
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/fields.tsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/risk-gate.ts
var import_react3 = require("react");
function writeRiskCopy(t) {
  return {
    title: t("writeRiskTitle"),
    description: t("writeRiskDescription"),
    acknowledgeLabel: t("writeRiskAcknowledge"),
    cancelLabel: t("writeRiskCancel"),
    closeLabel: t("writeRiskClose"),
    confirmLabel: t("writeRiskConfirm")
  };
}
function useRiskGate() {
  const [confirming, setConfirming] = (0, import_react3.useState)(false);
  const [acknowledged, setAcknowledged] = (0, import_react3.useState)(false);
  return {
    confirming,
    acknowledged,
    setAcknowledged,
    request: () => {
      setAcknowledged(false);
      setConfirming(true);
    },
    cancel: () => {
      setAcknowledged(false);
      setConfirming(false);
    },
    confirm: (apply2) => {
      setAcknowledged(false);
      setConfirming(false);
      apply2();
    }
  };
}

// src/client/fields.module.css
var style4 = `.Km44ca_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.Km44ca_field+.Km44ca_field{border-top:.5px solid var(--dsw-alias-border-l2)}.Km44ca_badges{align-items:center;gap:8px;display:inline-flex}.Km44ca_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.Km44ca_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.Km44ca_reset:disabled{cursor:default}.Km44ca_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.Km44ca_toggleRow{align-items:center;gap:8px;display:flex}.Km44ca_toggleLabel{min-width:0;color:var(--dsw-alias-label-primary);cursor:pointer;flex:1;font-size:13px;font-weight:500;line-height:1.5}.Km44ca_toggle{width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;flex:none;margin:0}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/fields.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/fields.module.css");
  tag.textContent = style4;
  document.head.appendChild(tag);
}
var fields_default = { "toggleRow": "Km44ca_toggleRow", "toggle": "Km44ca_toggle", "hint": "Km44ca_hint", "reset": "Km44ca_reset", "badges": "Km44ca_badges", "toggleLabel": "Km44ca_toggleLabel", "field": "Km44ca_field" };

// src/client/fields.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function BooleanField(props) {
  const gate = useRiskGate();
  const enabled = props.text === "true";
  const risk = props.risk;
  const stage = (next) => {
    props.onEdit(next ? "true" : "false");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: fields_default.field, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: fields_default.toggleRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "input",
        {
          id: props.id,
          type: "checkbox",
          className: fields_default.toggle,
          checked: enabled,
          disabled: props.disabled,
          onChange: (event) => {
            const next = event.target.checked;
            if (next && risk !== void 0 && !enabled) {
              gate.request();
              return;
            }
            stage(next);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { className: fields_default.toggleLabel, htmlFor: props.id, children: props.label }),
      props.overridden ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: fields_default.badges, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Tag, { tone: "neutral", children: props.overriddenLabel }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            type: "button",
            className: fields_default.reset,
            disabled: props.disabled,
            onClick: props.onReset,
            children: props.resetLabel
          }
        )
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: fields_default.hint, children: props.hint }),
    risk !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      import_dsh_client_ui_primitives3.RiskConfirmation,
      {
        open: gate.confirming,
        title: risk.title,
        description: risk.description,
        acknowledgeLabel: risk.acknowledgeLabel,
        cancelLabel: risk.cancelLabel,
        closeLabel: risk.closeLabel,
        confirmLabel: risk.confirmLabel,
        acknowledged: gate.acknowledged,
        disabled: props.disabled,
        onAcknowledgedChange: gate.setAcknowledged,
        onCancel: gate.cancel,
        onConfirm: () => {
          gate.confirm(() => {
            stage(true);
          });
        }
      }
    ) : null
  ] });
}

// src/client/zotero-card-controller.ts
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var FIELD_SPECS = [
  { key: "webEnabled", kind: "boolean", group: "groupWeb" },
  { key: "writeEnabled", kind: "boolean", group: "groupWrite" },
  { key: "writePersistKey", kind: "boolean", group: "groupWrite" },
  { key: "writeNoteMaxChars", kind: "number", group: "groupWrite" },
  { key: "writeListMaxItems", kind: "number", group: "groupWrite" },
  { key: "writeAuthorizeDeadlineMs", kind: "number", group: "groupWrite" },
  { key: "baseUrl", kind: "text", group: "groupConnection" },
  { key: "provider", kind: "text", group: "groupConnection" },
  { key: "timeoutMs", kind: "number", group: "groupConnection" },
  { key: "maxInFlightRequests", kind: "number", group: "groupConnection" },
  { key: "scopeListingTtlMs", kind: "number", group: "groupConnection" },
  { key: "maxSearchResults", kind: "number", group: "groupSearch" },
  { key: "maxNoteScanRecords", kind: "number", group: "groupSearch" },
  { key: "searchConcurrency", kind: "number", group: "groupSearch" },
  { key: "maxEvidenceChars", kind: "number", group: "groupSearch" },
  { key: "maxEvidencePassages", kind: "number", group: "groupSearch" },
  { key: "maxDetailChars", kind: "number", group: "groupSearch" },
  { key: "maxNoteBodyChars", kind: "number", group: "groupSearch" },
  { key: "maxNoteChars", kind: "number", group: "groupSearch" },
  { key: "maxNoteRecords", kind: "number", group: "groupSearch" },
  { key: "maxAnnotationRecords", kind: "number", group: "groupSearch" },
  { key: "fulltextChunkWords", kind: "number", group: "groupSearch" },
  { key: "maxFulltextChars", kind: "number", group: "groupSearch" },
  { key: "retrieveAttachmentCap", kind: "number", group: "groupSearch" },
  { key: "graphConcurrency", kind: "number", group: "groupSearch" },
  { key: "maxResponseBytes", kind: "number", group: "groupOutput" },
  { key: "maxExportChars", kind: "number", group: "groupOutput" },
  { key: "maxExportRefs", kind: "number", group: "groupOutput" },
  { key: "maxBrowseResults", kind: "number", group: "groupOutput" },
  { key: "maxChangesResults", kind: "number", group: "groupOutput" },
  { key: "defaultStyle", kind: "text", group: "groupDefaults" },
  { key: "defaultLocale", kind: "text", group: "groupDefaults" },
  { key: "enableRunInBackground", kind: "boolean", group: "groupJobs" },
  { key: "promoteOnTimeout", kind: "boolean", group: "groupJobs" },
  { key: "foregroundWaitMs", kind: "number", group: "groupJobs" }
];
function booleanFieldSpec(field2) {
  return {
    field: field2,
    format: (value) => typeof value === "boolean" ? String(value) : "",
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return { kind: "clear" };
      if (trimmed === "true") return { kind: "set", value: true };
      if (trimmed === "false") return { kind: "set", value: false };
      return void 0;
    }
  };
}
function fieldSpecs() {
  return FIELD_SPECS.map((spec) => {
    if (spec.kind === "number") return (0, import_dsh_client_ui_primitives4.settingsNumberField)(spec.key);
    if (spec.kind === "boolean") return booleanFieldSpec(spec.key);
    return (0, import_dsh_client_ui_primitives4.settingsTextField)(spec.key);
  });
}
var FIELD_GROUPS = groupFields(FIELD_SPECS);
var NUMERIC_FIELD_KEYS = new Set(
  FIELD_SPECS.filter((spec) => spec.kind === "number").map((spec) => spec.key)
);
var BOOLEAN_FIELD_KEYS = new Set(
  FIELD_SPECS.filter((spec) => spec.kind === "boolean").map((spec) => spec.key)
);
function asFormScope(form) {
  return {
    getSnapshot: () => {
      const { mode: _mode, ...snapshot } = form.getSnapshot();
      return snapshot;
    },
    subscribe: (listener) => form.subscribe(listener),
    mutate: (ops, expectedRevision) => form.mutate(
      ops.map(
        (op) => op.op === "set" ? { op: "set", path: [...op.path], value: op.value } : { op: "unset", path: [...op.path] }
      ),
      expectedRevision
    )
  };
}
var ZoteroCardController = class {
  form;
  store;
  /**
   * @param form - the shared configuration form for the `zotero` namespace.
   */
  constructor(form) {
    this.form = new import_dsh_client_ui_primitives4.SettingsFormModel(asFormScope(form), fieldSpecs());
    this.store = this.form.bind(() => this.projection());
  }
  projection() {
    const fields = Object.fromEntries(
      FIELD_SPECS.map((spec) => [spec.key, this.form.field(spec.key)])
    );
    return {
      ...this.form.shell(),
      ...fields
    };
  }
  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject() {
    return { hooks: { zoteroCard: this.store }, ...this.form.actions() };
  }
  /** Release the form's namespace subscription. */
  dispose() {
    this.form.dispose();
  }
};
function groupFields(specs) {
  const groups = [];
  for (const spec of specs) {
    const last = groups[groups.length - 1];
    if (last !== void 0 && last.key === spec.group) last.fields.push(spec.key);
    else groups.push({ key: spec.group, fields: [spec.key] });
  }
  return groups;
}

// src/client/ZoteroSettingsForm.module.css
var style5 = `.KieWbq_group{flex-direction:column;display:flex}.KieWbq_groupTitle{color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;margin:0;padding:10px 0 4px;font-size:12px;font-weight:600;line-height:1.4}.KieWbq_fields{flex-direction:column;display:flex}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/ZoteroSettingsForm.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/ZoteroSettingsForm.module.css");
  tag.textContent = style5;
  document.head.appendChild(tag);
}
var ZoteroSettingsForm_default = { "groupTitle": "KieWbq_groupTitle", "fields": "KieWbq_fields", "group": "KieWbq_group" };

// src/client/ZoteroSettingsForm.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function ZoteroSettingsForm(props) {
  const { t, state, actions } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_jsx_runtime5.Fragment, { children: FIELD_GROUPS.map(({ key: groupKey, fields: keys }) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: ZoteroSettingsForm_default.group, "aria-label": t(groupKey), children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { className: ZoteroSettingsForm_default.groupTitle, children: t(groupKey) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: ZoteroSettingsForm_default.fields, children: keys.map((key) => field(t, state, actions, key)) })
  ] }, groupKey)) });
}
function field(t, state, actions, key) {
  const shared = {
    overriddenLabel: t("overridden"),
    resetLabel: t("reset"),
    // Disabled while the Host is read-only **or** a save is crossing the wire:
    // SettingsFormModel.save() clears every staged draft on success, so an edit
    // typed during the round-trip would be dropped with them.
    disabled: !state.writable || state.saving,
    ...state[key],
    onEdit: (text) => {
      actions.edit(key, text);
    },
    onReset: () => {
      actions.resetField(key);
    }
  };
  if (BOOLEAN_FIELD_KEYS.has(key)) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      BooleanField,
      {
        id: `zotero-settings-${key}`,
        label: t(key),
        hint: t(`${key}Hint`),
        risk: key === "writeEnabled" ? writeRiskCopy(t) : void 0,
        ...shared
      },
      key
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    import_dsh_client_ui_primitives5.SettingsValueField,
    {
      id: `zotero-settings-${key}`,
      label: t(key),
      hint: t(`${key}Hint`),
      invalidLabel: t("invalidNumber"),
      numeric: NUMERIC_FIELD_KEYS.has(key),
      ...shared
    },
    key
  );
}

// src/client/ZoteroSettingsSection.module.css
var style6 = `.TLM_wW_page{flex-direction:column;max-width:720px;padding-top:4px;display:flex}.TLM_wW_head{align-items:center;gap:8px;display:flex}.TLM_wW_title{color:var(--dsw-alias-label-primary);margin:0;font-size:20px;font-weight:600;line-height:1.3}.TLM_wW_pending{flex:none}.TLM_wW_description{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:14px;line-height:24px}.TLM_wW_status{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:13px;line-height:1.5}.TLM_wW_footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;margin-top:16px;padding-top:12px;display:flex}.TLM_wW_failed{min-width:0;color:var(--dsw-alias-label-error,var(--dsw-alias-state-error-primary));flex:1;margin:0;font-size:12px;line-height:1.5}.TLM_wW_discard,.TLM_wW_save{appearance:none;border-radius:var(--dsw-radius-sm);font:inherit;cursor:pointer;border:1px solid #0000;padding:5px 14px;font-size:13px;line-height:1.5}.TLM_wW_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.TLM_wW_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.TLM_wW_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.TLM_wW_discard:disabled,.TLM_wW_save:disabled{opacity:.4;cursor:default}.TLM_wW_discard:focus-visible,.TLM_wW_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/ZoteroSettingsSection.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/ZoteroSettingsSection.module.css");
  tag.textContent = style6;
  document.head.appendChild(tag);
}
var ZoteroSettingsSection_default = { "pending": "TLM_wW_pending", "footer": "TLM_wW_footer", "head": "TLM_wW_head", "title": "TLM_wW_title", "page": "TLM_wW_page", "status": "TLM_wW_status", "failed": "TLM_wW_failed", "discard": "TLM_wW_discard", "save": "TLM_wW_save", "description": "TLM_wW_description" };

// src/client/ZoteroSettingsSection.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function ZoteroSettingsSection(props) {
  const { t } = props;
  const state = props.useZoteroCard((snapshot) => snapshot);
  if (!state.available) {
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsSection_default.page, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h2", { className: ZoteroSettingsSection_default.title, children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: ZoteroSettingsSection_default.status, role: "status", children: t("unavailable") })
    ] });
  }
  const blocked = !state.dirty || state.invalid || state.saving;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsSection_default.page, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsSection_default.head, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h2", { className: ZoteroSettingsSection_default.title, children: t("title") }),
      state.dirty ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Tag, { tone: "neutral", className: ZoteroSettingsSection_default.pending, children: t("unsaved") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: ZoteroSettingsSection_default.description, children: t("description") }),
    state.writable ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: ZoteroSettingsSection_default.status, role: "status", children: t("readOnly") }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ZoteroSettingsForm, { t, state, actions: props }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsSection_default.footer, children: [
      state.failed ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: ZoteroSettingsSection_default.failed, role: "status", children: t("saveFailed") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "button",
        {
          type: "button",
          className: ZoteroSettingsSection_default.discard,
          disabled: !state.dirty || state.saving,
          onClick: props.discard,
          children: t("discard")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: ZoteroSettingsSection_default.save, disabled: blocked, onClick: props.save, children: t(state.saving ? "saving" : "save") })
    ] })
  ] });
}

// src/client/components/SourcesTab.tsx
var import_react13 = require("react");

// src/ref-grammar.ts
var REF_KEY_SOURCE = "[A-Z0-9]{8}";
var ATTACHMENT_HREF_PATTERN = new RegExp(`/items/(${REF_KEY_SOURCE})(?:[/?#]|$)`);
var ZOTERO_USER_ITEM_PATH_PATTERN = new RegExp(
  `^/users/(\\d+)/items/(${REF_KEY_SOURCE})(?:[/?#].*)?$`
);
var ZOTERO_GROUP_ITEM_PATH_PATTERN = new RegExp(
  `^/groups/(\\d+)/items/(${REF_KEY_SOURCE})(?:[/?#].*)?$`
);
var LIBRARY = "(?<libraryType>user|group)/(?<libraryId>\\d+)";
var KINDS = "(?<kind>item|attachment|annotation|collection|search)";
var SERVER_QUALIFIER = "\\?server=(?<serverId>[A-Za-z0-9_-]{1,64})";
var REF_PATTERN = new RegExp(
  `^zotero://${LIBRARY}/${KINDS}/(?<key>${REF_KEY_SOURCE})(?:${SERVER_QUALIFIER})?$`
);
var REF_IN_TEXT_PATTERN = new RegExp(
  `zotero://${LIBRARY}/${KINDS}/(?<key>${REF_KEY_SOURCE})`
);

// src/json.ts
var OBJECT_KEY_PATTERN = new RegExp(`^${REF_KEY_SOURCE}$`);
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function isRecord(value) {
  return asRecord(value) !== void 0;
}
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function stringField(record, key) {
  return asString(record[key]);
}
function numberField(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function boolField(record, key) {
  const value = record[key];
  return typeof value === "boolean" ? value : void 0;
}
function stringArrayOf(value) {
  return asStringArray(value) ?? [];
}
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : void 0;
}

// src/client/presenters.ts
function isSettledTool(block) {
  return "kind" in block;
}
function callNameOf(block) {
  return isSettledTool(block) ? block.call?.name ?? null : block.name;
}
function metaOf(block) {
  if (!isSettledTool(block)) return null;
  return isRecord(block.meta) ? block.meta : null;
}
function rowStateOf(block) {
  if (!isSettledTool(block)) return "running";
  if (block.error?.code === "interrupted") return "stopped";
  return block.isError ? "error" : "ok";
}
function resultTextOf(block) {
  if (!isSettledTool(block)) return null;
  const parts = [];
  for (const item of block.content) {
    if (item.type === "text") parts.push(item.text);
    else parts.push(JSON.stringify(item, null, 2));
  }
  if (parts.length === 0 && block.error !== void 0) {
    parts.push(`${block.error.name}: ${block.error.code}`);
  }
  if (parts.length === 0) return "";
  return parts.join("\n");
}
function errorSummaryOf(block, rawText) {
  if (rowStateOf(block) !== "error") return null;
  const text = rawText !== void 0 ? rawText : resultTextOf(block);
  return text ? text.split("\n")[0]?.trim() || null : null;
}
function argsRawOf(block) {
  if (isSettledTool(block)) return block.call?.argsRaw ?? null;
  return block.phase === "start" ? block.argsRaw : null;
}
function argsOf(block) {
  const raw = argsRawOf(block);
  if (raw === null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function shortKeyOf(value) {
  return REF_IN_TEXT_PATTERN.exec(value)?.groups?.key ?? null;
}
function evidenceItemsOf(meta) {
  const items = meta["items"];
  if (!Array.isArray(items)) return null;
  const rows = [];
  for (const item of items) {
    if (!isRecord(item)) return null;
    const source = stringField(item, "source");
    const sourceRef = stringField(item, "sourceRef");
    const preview = stringField(item, "preview");
    if (source === void 0 || sourceRef === void 0 || preview === void 0) return null;
    const previewTruncated = boolField(item, "previewTruncated") === true;
    const pageLabel = stringField(item, "pageLabel");
    const attachmentRef = stringField(item, "attachmentRef");
    const matchedFields = matchedFieldsOf(item["matchedFields"]);
    rows.push({
      source,
      sourceRef,
      preview,
      previewTruncated,
      ...pageLabel === void 0 ? {} : { pageLabel },
      ...attachmentRef === void 0 ? {} : { attachmentRef },
      ...matchedFields === void 0 ? {} : { matchedFields }
    });
  }
  return rows;
}
function matchedFieldsOf(value) {
  if (!Array.isArray(value)) return void 0;
  const fields = value.filter(
    (entry) => entry === "text" || entry === "comment"
  );
  return fields.length === 0 ? void 0 : fields;
}
function joinNonEmpty(...parts) {
  return parts.filter((part) => part !== void 0 && part !== "").join(" \xB7 ");
}

// src/browse-rows.ts
var BROWSE_KINDS = [
  "libraries",
  "collections",
  "savedSearches",
  "tags",
  "itemTypes",
  "itemFields"
];
function isBrowseKind(value) {
  return value !== void 0 && BROWSE_KINDS.includes(value);
}
function countOf(value, key) {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}
function browseRowOf(value) {
  const row = asRecord(value) ?? {};
  const localized = asString(row["localized"]) ?? null;
  const ref = asString(row["ref"]) ?? "";
  const library = asRecord(row["library"]);
  if (library !== void 0) {
    const type = asString(library["type"]) ?? "";
    const id = library["id"];
    const libraryId = `${type}/${typeof id === "number" ? id : ""}`;
    return { kind: "library", name: asString(row["name"]) ?? libraryId, libraryId };
  }
  const path = asStringArray(row["path"]);
  if (path !== void 0) {
    const depth = row["depth"];
    return {
      kind: "collection",
      breadcrumb: path,
      ref,
      depth: typeof depth === "number" && Number.isFinite(depth) ? depth : 0
    };
  }
  const tag = asString(row["tag"]);
  if (tag !== void 0) return { kind: "tag", tag, count: countOf(row, "count") };
  const itemType = asString(row["itemType"]);
  if (itemType !== void 0) return { kind: "itemType", itemType, localized };
  const field2 = asString(row["field"]);
  if (field2 !== void 0) return { kind: "field", field: field2, localized };
  const creatorType = asString(row["creatorType"]);
  if (creatorType !== void 0) return { kind: "creatorType", creatorType, localized };
  const name = asString(row["name"]) ?? (ref === "" ? JSON.stringify(value) : ref);
  const conditions = row["conditions"];
  return {
    kind: "savedSearch",
    name,
    ref,
    conditionCount: Array.isArray(conditions) ? conditions.length : null
  };
}

// src/changes-contract.ts
var CHANGE_SECTIONS = [
  { key: "items", label: "toolChangesItems" },
  { key: "childItems", label: "toolChangesChildItems" },
  { key: "trashedItems", label: "toolChangesTrashedItems" },
  { key: "collections", label: "toolChangesCollections" },
  { key: "savedSearches", label: "toolChangesSavedSearches" },
  { key: "fulltextAttachments", label: "toolChangesFulltext" }
];
var DELETION_SECTIONS = [
  { key: "items", label: "toolDeletedItems", totalKey: "deletedItems" },
  { key: "collections", label: "toolDeletedCollections", totalKey: "deletedCollections" },
  { key: "savedSearches", label: "toolDeletedSavedSearches", totalKey: "deletedSavedSearches" },
  { key: "tags", label: "toolDeletedTags", totalKey: "deletedTags" }
];
var DELETED_OTHER_TOTAL_KEY = "deletedOther";

// src/client/sources/decoders.ts
function childCountOf(value) {
  if (!isRecord(value)) return null;
  const total = numberField(value, "total");
  if (total === void 0) return null;
  return { total, returned: numberField(value, "returned") ?? total };
}
function childPreviewsOf(value) {
  if (!Array.isArray(value)) return [];
  const rows = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const ref = stringField(entry, "ref");
    const preview = stringField(entry, "preview");
    if (ref === void 0 || preview === void 0) continue;
    const pageLabel = stringField(entry, "pageLabel");
    const parentRef = stringField(entry, "parentRef");
    rows.push({
      ref,
      preview,
      pageLabel: pageLabel ?? null,
      parentRef: parentRef ?? null
    });
  }
  return rows;
}
function browseMetaOf(meta) {
  const kind = stringField(meta, "kind");
  const items = meta["items"];
  const rows = Array.isArray(items) ? items.map((item) => browseRowOf(item)) : null;
  const nextOffset = numberField(meta, "nextOffset");
  return {
    kind: isBrowseKind(kind) ? kind : null,
    returned: numberField(meta, "returned") ?? null,
    total: numberField(meta, "total") ?? null,
    nextOffset: nextOffset ?? null,
    rows
  };
}
function exportItemsOf(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const ref = stringField(entry, "ref");
    if (ref === void 0) continue;
    const key = stringField(entry, "key");
    const title = stringField(entry, "title");
    const entryIndex = numberField(entry, "entryIndex");
    const start = numberField(entry, "start");
    const end = numberField(entry, "end");
    items.push({
      ref,
      ...key === void 0 ? {} : { key },
      ...title === void 0 ? {} : { title },
      ...entryIndex === void 0 ? {} : { entryIndex },
      ...start === void 0 ? {} : { start },
      ...end === void 0 ? {} : { end }
    });
  }
  return items;
}
function decodeSearchRows(value) {
  if (!Array.isArray(value)) return null;
  const rows = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const ref = stringField(item, "ref");
    const title = stringField(item, "title");
    const creatorSummary = stringField(item, "creatorSummary");
    if (ref === void 0 || title === void 0 || creatorSummary === void 0) return null;
    const year = numberField(item, "year");
    const itemType = stringField(item, "itemType");
    const bestAttachmentRef = stringField(item, "bestAttachmentRef");
    const bestAttachmentType = stringField(item, "bestAttachmentType");
    rows.push({
      ref,
      title,
      creatorSummary,
      ...year === void 0 ? {} : { year },
      ...itemType === void 0 ? {} : { itemType },
      ...bestAttachmentRef === void 0 ? {} : { bestAttachmentRef },
      ...bestAttachmentType === void 0 ? {} : { bestAttachmentType }
    });
  }
  return rows;
}
function decodeSupportedLibrary(value) {
  if (!isRecord(value)) return null;
  const type = stringField(value, "type");
  const id = numberField(value, "id");
  if (type === "user" && id === 0) return { type: "user", id: 0 };
  if (type === "group" && id !== void 0 && Number.isSafeInteger(id) && id > 0) {
    return { type: "group", id };
  }
  return null;
}
function decodeResolvedScope(value) {
  if (!isRecord(value)) return null;
  const kind = stringField(value, "kind");
  if (kind === "library" || kind === "publications") {
    const lib = decodeSupportedLibrary(value["library"]);
    if (lib === null) return null;
    if (lib.type === "user") {
      return kind === "library" ? { kind: "library", library: { type: "user", id: 0 } } : { kind: "publications", library: { type: "user", id: 0 } };
    }
    return kind === "library" ? { kind: "library", library: { type: "group", id: lib.id } } : { kind: "publications", library: { type: "group", id: lib.id } };
  }
  if (kind === "collection" || kind === "savedSearch") {
    const ref = stringField(value, "ref");
    const name = stringField(value, "name");
    if (ref === void 0 || name === void 0) return null;
    return kind === "collection" ? { kind: "collection", ref, name } : { kind: "savedSearch", ref, name };
  }
  return null;
}
function searchMetaOf(meta) {
  return {
    rows: decodeSearchRows(meta["items"]),
    returned: numberField(meta, "returned") ?? null,
    total: numberField(meta, "total") ?? null,
    omitted: numberField(meta, "omitted") ?? null,
    scope: decodeResolvedScope(meta["scope"]),
    library: decodeSupportedLibrary(meta["library"])
  };
}
function getMetaOf(meta) {
  let bestAttachment = null;
  const attachment = meta["bestAttachment"];
  if (isRecord(attachment)) {
    const contentType = stringField(attachment, "contentType");
    if (contentType !== void 0) {
      const ref = stringField(attachment, "ref");
      bestAttachment = { contentType, ...ref === void 0 ? {} : { ref } };
    }
  }
  return {
    title: stringField(meta, "title") ?? null,
    creators: stringField(meta, "creators") ?? null,
    year: numberField(meta, "year") ?? null,
    venue: stringField(meta, "venue") ?? null,
    bestAttachment,
    notes: childCountOf(meta["notes"]),
    annotations: childCountOf(meta["annotations"]),
    attachments: childCountOf(meta["attachments"]),
    notesPreview: childPreviewsOf(meta["notesPreview"]),
    annotationsPreview: childPreviewsOf(meta["annotationsPreview"])
  };
}
function decodeSourceAvailability(value) {
  if (!isRecord(value)) return {};
  const result = {};
  for (const [source, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const requested = boolField(entry, "requested");
    const unavailable = boolField(entry, "unavailable");
    const returnedPassages = numberField(entry, "returnedPassages");
    if (requested === void 0 || unavailable === void 0 || returnedPassages === void 0)
      continue;
    result[source] = { requested, returnedPassages, unavailable };
  }
  return result;
}
function decodeCoverage(value) {
  if (!isRecord(value)) return null;
  const complete = boolField(value, "complete");
  if (complete === void 0) return null;
  const indexedPages = numberField(value, "indexedPages");
  const totalPages = numberField(value, "totalPages");
  const indexedChars = numberField(value, "indexedChars");
  const totalChars = numberField(value, "totalChars");
  return {
    complete,
    ...indexedPages === void 0 ? {} : { indexedPages },
    ...totalPages === void 0 ? {} : { totalPages },
    ...indexedChars === void 0 ? {} : { indexedChars },
    ...totalChars === void 0 ? {} : { totalChars }
  };
}
var CHILD_SECTIONS = [
  { key: "notes", kind: "note" },
  { key: "attachments", kind: "attachment" },
  { key: "annotations", kind: "annotation" }
];
function childRowOf(kind, value) {
  if (!isRecord(value)) return null;
  const ref = stringField(value, "ref");
  if (ref === void 0) return null;
  if (kind === "note") {
    const text2 = stringField(value, "text");
    return text2 === void 0 ? null : { kind, ref, text: text2 };
  }
  if (kind === "attachment") {
    const title = stringField(value, "title");
    const contentType = stringField(value, "contentType");
    if (title === void 0 || contentType === void 0) return null;
    return { kind, ref, title, contentType };
  }
  const type = stringField(value, "type");
  const text = stringField(value, "text");
  if (type === void 0 || text === void 0) return null;
  const color = stringField(value, "color");
  const pageLabel = stringField(value, "pageLabel");
  const parentRef = stringField(value, "parentRef");
  return {
    kind,
    ref,
    type,
    text,
    color: color === void 0 || color === "" ? null : color,
    pageLabel: pageLabel ?? null,
    parentRef: parentRef ?? null
  };
}
function childrenMetaOf(meta) {
  const sections = [];
  for (const { key, kind } of CHILD_SECTIONS) {
    const count = childCountOf(meta[key]);
    if (count === null) continue;
    const items = isRecord(meta[key]) ? meta[key]["items"] : void 0;
    const rows = Array.isArray(items) ? items.map((item) => childRowOf(kind, item)).filter((row) => row !== null) : [];
    sections.push({ kind, total: count.total, returned: count.returned, shown: rows.length, rows });
  }
  return { itemType: stringField(meta, "itemType") ?? null, sections };
}
var CHANGE_WITHHELD_REASONS = /* @__PURE__ */ new Set(["not-served", "range-not-covered", "unreadable"]);
function withheldOf(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const withheld = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const kind = stringField(entry, "kind");
    const reason = stringField(entry, "reason");
    if (kind === void 0 || reason === void 0) continue;
    if (!CHANGE_WITHHELD_REASONS.has(reason)) continue;
    withheld.push({ kind, reason });
  }
  return withheld.length === 0 ? null : withheld;
}
function totalOf(totals, key) {
  return totals === null ? null : numberField(totals, key) ?? null;
}
function changedEntriesOf(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const key = stringField(entry, "key");
    const version = numberField(entry, "version");
    if (key === void 0 || version === void 0) continue;
    entries.push({ key, version });
  }
  return entries;
}
function jobArmOf(meta) {
  const kind = stringField(meta, "kind");
  if (kind !== "background" && kind !== "promoted") return null;
  const jobId = stringField(meta, "jobId");
  if (jobId === void 0) return null;
  return { kind, jobId };
}
function jobSummaryKeyOf(job) {
  return job.kind === "background" ? "toolSummaryJobBackground" : "toolSummaryJobPromoted";
}
function changesMetaOf(meta) {
  const totals = isRecord(meta["totals"]) ? meta["totals"] : null;
  const changedRecord = isRecord(meta["changed"]) ? meta["changed"] : null;
  const deletedRecord = isRecord(meta["deleted"]) ? meta["deleted"] : null;
  const cursorRecord = isRecord(meta["cursor"]) ? meta["cursor"] : null;
  const changed = [];
  for (const { key, label } of CHANGE_SECTIONS) {
    const section = changedRecord?.[key];
    if (section === void 0) continue;
    changed.push({
      key,
      label,
      total: totalOf(totals, key),
      entries: changedEntriesOf(section)
    });
  }
  const deleted = [];
  for (const { key, label, totalKey } of DELETION_SECTIONS) {
    const section = deletedRecord?.[key];
    if (section === void 0) continue;
    deleted.push({
      key,
      label,
      total: totalOf(totals, totalKey),
      // `deleted.<kind>` is a bare string array.
      keys: stringArrayOf(section)
    });
  }
  const otherTotal = totalOf(totals, DELETED_OTHER_TOTAL_KEY);
  if (otherTotal !== null && otherTotal > 0) {
    deleted.push({ key: "other", label: "toolDeletedOther", total: otherTotal, keys: [] });
  }
  const sumSections = (sections) => {
    if (sections.length === 0) return null;
    const sum = sections.reduce((acc, section) => acc + (section.total ?? section.size), 0);
    return sum === 0 ? null : sum;
  };
  const sumTotals = (totalKeys) => {
    if (totals === null) return null;
    const sum = totalKeys.reduce((acc, key) => acc + (numberField(totals, key) ?? 0), 0);
    return sum === 0 ? null : sum;
  };
  const changedTotalKeys = CHANGE_SECTIONS.map((section) => section.key);
  const deletedTotalKeys = [
    ...DELETION_SECTIONS.map((section) => section.totalKey),
    DELETED_OTHER_TOTAL_KEY
  ];
  const cursorVersion = cursorRecord === null ? null : numberField(cursorRecord, "version") ?? null;
  const cursorServerId = cursorRecord === null ? null : stringField(cursorRecord, "serverId") ?? null;
  return {
    fromVersion: numberField(meta, "fromVersion") ?? null,
    cursor: cursorVersion !== null && cursorServerId !== null ? { version: cursorVersion, serverId: cursorServerId } : null,
    // Decoded unconditionally, and the cursor has nothing to do with it: for a
    // standalone resource, `not-served` and `range-not-covered` deliberately keep
    // the cursor (those changes were never observable in any range), so "cursor
    // present" is the *normal* shape of a diff carrying a coverage gap — not a
    // sign the gap went away. Only `unreadable` withholds the cursor, and that
    // fact is the card's separate no-cursor notice.
    withheld: withheldOf(meta["unobservable"]),
    changedTotal: sumTotals(changedTotalKeys) ?? sumSections(
      changed.map((section) => ({ total: section.total, size: section.entries.length }))
    ),
    changed,
    deletedTotal: sumTotals(deletedTotalKeys) ?? sumSections(deleted.map((section) => ({ total: section.total, size: section.keys.length }))),
    deleted
  };
}
function retrieveMetaOf(meta) {
  const truncated = boolField(meta, "truncated");
  return {
    items: evidenceItemsOf(meta),
    count: numberField(meta, "count") ?? null,
    truncated: truncated === void 0 ? null : truncated,
    attachmentRef: stringField(meta, "attachmentRef") ?? null,
    attachmentContentType: stringField(meta, "attachmentContentType") ?? null,
    coverage: decodeCoverage(meta["coverage"]),
    sourceAvailability: decodeSourceAvailability(meta["sourceAvailability"])
  };
}
function attachmentMetaOf(meta) {
  const kindValue = stringField(meta, "kind");
  const kind = kindValue === "file" || kindValue === "url" ? kindValue : null;
  return {
    kind,
    title: stringField(meta, "title") ?? null,
    contentType: stringField(meta, "contentType") ?? null,
    location: kind === null ? null : stringField(meta, kind === "file" ? "path" : "url") ?? null,
    ref: stringField(meta, "ref") ?? null
  };
}
function exportMetaOf(meta) {
  return {
    format: stringField(meta, "format") ?? null,
    style: stringField(meta, "style") ?? null,
    locale: stringField(meta, "locale") ?? null,
    refs: stringArrayOf(meta["refs"]),
    refsOmitted: numberField(meta, "refsOmitted") ?? 0,
    items: exportItemsOf(meta["items"])
  };
}
var WRITE_KINDS = /* @__PURE__ */ new Set(["declined", "applied", "deleted", "committed-unverified"]);
function writeKindOf(value) {
  return typeof value === "string" && WRITE_KINDS.has(value) ? value : "applied";
}
function writeMetaOf(meta) {
  return {
    kind: writeKindOf(meta["kind"]),
    addedCount: numberField(meta, "addedCount") ?? null,
    removedCount: numberField(meta, "removedCount") ?? null,
    deletedCount: numberField(meta, "deletedCount") ?? null
  };
}

// src/client/sources/provenance.ts
function normalizeRefKey(ref) {
  return ref.split("?", 1)[0].toLowerCase();
}
function serverIdOf(ref) {
  const query = ref.split("?", 2)[1];
  if (query === void 0) return void 0;
  const match = /(?:^|&)server=([A-Za-z0-9_-]{1,64})(?:&|$)/.exec(query);
  return match?.[1];
}
function provenanceOf(serverIds, currentServerId) {
  if (currentServerId === void 0 || serverIds.size === 0) return "unknown";
  for (const id of serverIds) {
    if (id !== currentServerId) return "mismatch";
  }
  return "verified";
}

// src/client/sources/reducer.ts
function emptyFacts() {
  return {
    inspected: false,
    evidenceCount: 0,
    reportedEvidenceCount: 0,
    attachmentResolved: false,
    exportCount: 0
  };
}
function emptyOperations() {
  return { running: 0, failed: 0, stopped: 0 };
}
function searchIdentityOf(args, overrides) {
  if (args === null) return null;
  const query = typeof args["query"] === "string" ? args["query"] : "";
  const mode = args["mode"] === "everything" ? "everything" : "metadata";
  const itemTypes = normalizedListOf(args["itemTypes"]);
  const tags = normalizedListOf(args["tags"]);
  const tagMatch = args["tagMatch"] === "any" ? "any" : "all";
  const excludeTags = normalizedListOf(args["excludeTags"]);
  const includeTrashed = args["includeTrashed"] === true;
  const sort = typeof args["sort"] === "string" ? args["sort"] : "";
  const direction = typeof args["direction"] === "string" ? args["direction"] : "";
  const library = overrides?.resolvedLibrary ?? (() => {
    const l = args["library"];
    if (isRecord(l) && (l["type"] === "user" || l["type"] === "group") && typeof l["id"] === "number") {
      return { type: l["type"], id: l["id"] };
    }
    return { type: "user", id: 0 };
  })();
  return JSON.stringify({
    query,
    mode,
    library,
    scope: overrides !== void 0 ? resolvedToSourceScope(overrides.resolvedScope) : scopeOf(args["scope"]),
    itemTypes,
    tags,
    tagMatch,
    excludeTags,
    includeTrashed,
    sort,
    direction
  });
}
function normalizedListOf(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === "string"))].sort();
}
function scopeOf(value) {
  if (isRecord(value)) {
    const kind = value["kind"];
    const refOrName = value["refOrName"];
    if ((kind === "collection" || kind === "savedSearch") && typeof refOrName === "string" && refOrName !== "") {
      return refOrName.startsWith("zotero://") ? { kind, ref: refOrName } : { kind, name: refOrName };
    }
  }
  return { kind: "library", library: { type: "user", id: 0 } };
}
function resolvedToSourceScope(scope) {
  if (scope.kind === "library") return { kind: "library", library: scope.library };
  if (scope.kind === "publications") return { kind: "publications", library: scope.library };
  if (scope.kind === "collection") return { kind: "collection", ref: scope.ref, name: scope.name };
  return { kind: "savedSearch", ref: scope.ref, name: scope.name };
}
function offsetOf(args) {
  if (args === null) return 0;
  const offset = args["offset"];
  return typeof offset === "number" && Number.isFinite(offset) && offset >= 0 ? offset : 0;
}
function refArgOf(args) {
  if (args === null) return null;
  const ref = stringField(args, "ref");
  return ref === void 0 || ref === "" ? null : ref;
}
function exportRefsOf(metaView, args) {
  if (args !== null) {
    const refs = args["refs"];
    if (Array.isArray(refs)) {
      return {
        refs: refs.filter((entry) => typeof entry === "string" && entry !== ""),
        refsOmitted: 0
      };
    }
  }
  return {
    refs: metaView === null ? [] : [...metaView.refs],
    refsOmitted: metaView === null ? 0 : metaView.refsOmitted
  };
}
function evidenceKeyOf(source, sourceRef, text, pageLabel) {
  return `${source}|${sourceRef}|${pageLabel ?? ""}|${text}`;
}
function buildSourceWorkspace(blocks, options = {}) {
  const byKey = /* @__PURE__ */ new Map();
  const exports = [];
  const episodes = [];
  let lastEpisode = null;
  const exportOperations = emptyOperations();
  let omittedRows = 0;
  const draftOf = (ref, seq) => {
    const key = normalizeRefKey(ref);
    let draft = byKey.get(key);
    if (draft === void 0) {
      draft = {
        key,
        ref,
        serverIds: /* @__PURE__ */ new Set(),
        facts: emptyFacts(),
        operations: emptyOperations(),
        evidence: /* @__PURE__ */ new Map(),
        exports: [],
        exportedCallIds: /* @__PURE__ */ new Set(),
        successfulRetrieveCallIds: /* @__PURE__ */ new Set(),
        searches: [],
        firstSeenAt: seq,
        lastTouchedAt: seq
      };
      byKey.set(key, draft);
    }
    draft.firstSeenAt = Math.min(draft.firstSeenAt, seq);
    draft.lastTouchedAt = Math.max(draft.lastTouchedAt, seq);
    const serverId = serverIdOf(ref);
    if (serverId !== void 0) draft.serverIds.add(serverId);
    return draft;
  };
  const countOperation = (draft, state) => {
    if (state === "running") draft.operations.running += 1;
    else if (state === "stopped") draft.operations.stopped += 1;
    else if (state === "error") draft.operations.failed += 1;
  };
  const eventTimeOf = (block) => {
    if (!isSettledTool(block)) return 0;
    return block.time;
  };
  const pushEvidence = (draft, meta, callId, seq, time) => {
    const view = retrieveMetaOf(meta);
    if (view.items === null && view.count === null) return;
    if (!draft.successfulRetrieveCallIds.has(callId)) {
      draft.successfulRetrieveCallIds.add(callId);
      draft.retrievalSummary = {
        runCount: draft.successfulRetrieveCallIds.size,
        latestRetrievedAt: time,
        truncated: false
      };
    }
    if (view.count !== null) {
      draft.facts.reportedEvidenceCount += view.count;
    }
    const nextFacts = {
      ...view.attachmentRef === null ? {} : { attachmentRef: view.attachmentRef },
      ...view.attachmentContentType === null ? {} : { attachmentContentType: view.attachmentContentType },
      ...view.coverage === null ? {} : { coverage: view.coverage },
      truncated: view.truncated === true,
      sourceAvailability: view.sourceAvailability
    };
    if (draft.retrievalFacts !== void 0) {
      const prev = draft.retrievalFacts;
      const mergedAvailability = { ...prev.sourceAvailability };
      for (const [source, entry] of Object.entries(nextFacts.sourceAvailability)) {
        mergedAvailability[source] = entry;
      }
      draft.retrievalFacts = {
        // The latest carried values win, so the attachment deep link (with
        // its paired content type) and the coverage line always describe the
        // same retrieve.
        ...view.attachmentRef === null ? prev.attachmentRef !== void 0 ? {
          attachmentRef: prev.attachmentRef,
          ...prev.attachmentContentType === void 0 ? {} : { attachmentContentType: prev.attachmentContentType }
        } : {} : {
          attachmentRef: view.attachmentRef,
          ...view.attachmentContentType === null ? {} : { attachmentContentType: view.attachmentContentType }
        },
        ...view.coverage === null ? prev.coverage !== void 0 ? { coverage: prev.coverage } : {} : { coverage: view.coverage },
        truncated: prev.truncated || nextFacts.truncated,
        sourceAvailability: mergedAvailability
      };
    } else {
      draft.retrievalFacts = nextFacts;
    }
    if (view.items !== null) {
      for (const item of view.items) {
        const key = evidenceKeyOf(item.source, item.sourceRef, item.preview, item.pageLabel);
        const existing = draft.evidence.get(key);
        if (existing === void 0) {
          draft.evidence.set(key, {
            passage: {
              source: item.source,
              sourceRef: item.sourceRef,
              text: item.preview,
              previewTruncated: item.previewTruncated,
              ...item.pageLabel === void 0 ? {} : { pageLabel: item.pageLabel },
              ...item.attachmentRef === void 0 ? {} : { attachmentRef: item.attachmentRef },
              callIds: [callId]
            },
            seq
          });
        } else {
          existing.passage.callIds.push(callId);
        }
      }
      draft.facts.evidenceCount = draft.evidence.size;
    }
    draft.retrievalSummary = {
      ...draft.retrievalSummary,
      truncated: draft.retrievalFacts?.truncated === true
    };
  };
  for (const [index, block] of blocks.entries()) {
    const seq = index;
    const state = rowStateOf(block);
    const name = callNameOf(block);
    const args = argsOf(block);
    const meta = metaOf(block);
    switch (name) {
      case "zotero_search": {
        if (state !== "ok") break;
        const view = meta === null ? null : searchMetaOf(meta);
        if (view === null || view.rows === null) break;
        const resolvedScope = view.scope;
        const resolvedLibrary = view.library;
        const identity = resolvedScope !== null && resolvedLibrary !== null ? searchIdentityOf(args, { resolvedScope, resolvedLibrary }) : searchIdentityOf(args);
        if (lastEpisode === null || identity === null || lastEpisode.identity !== identity) {
          const scopeForEpisode = resolvedScope !== null ? resolvedToSourceScope(resolvedScope) : scopeOf(args?.["scope"]);
          const libraryForEpisode = resolvedLibrary ?? (() => {
            const libArg = args?.["library"];
            if (!isRecord(libArg)) return void 0;
            const type = libArg["type"];
            const id = libArg["id"];
            if (type === "user" && id === 0) return { type: "user", id: 0 };
            if (type === "group" && typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
              return { type: "group", id };
            }
            return void 0;
          })();
          lastEpisode = {
            identity,
            callId: block.callId,
            ...typeof args?.["query"] === "string" && args["query"] !== "" ? { query: args["query"] } : {},
            mode: args?.["mode"] === "everything" ? "everything" : "metadata",
            scope: scopeForEpisode,
            ...libraryForEpisode ? { library: libraryForEpisode } : {},
            itemTypes: normalizedListOf(args?.["itemTypes"]),
            tags: normalizedListOf(args?.["tags"]),
            tagMatch: args?.["tagMatch"] === "any" ? "any" : "all",
            excludeTags: normalizedListOf(args?.["excludeTags"]),
            includeTrashed: args?.["includeTrashed"] === true,
            offset: offsetOf(args),
            returned: 0,
            omitted: 0,
            keys: /* @__PURE__ */ new Set()
          };
          episodes.push(lastEpisode);
        }
        lastEpisode.returned += view.rows.length;
        lastEpisode.omitted += view.omitted ?? 0;
        for (const row of view.rows) {
          const draft = draftOf(row.ref, seq);
          draft.title ??= row.title;
          draft.creators ??= row.creatorSummary;
          draft.year ??= row.year;
          if (row.bestAttachmentRef !== void 0 && draft.bestAttachment === void 0) {
            draft.bestAttachment = {
              ref: row.bestAttachmentRef,
              ...row.bestAttachmentType === void 0 ? {} : { contentType: row.bestAttachmentType }
            };
          }
          lastEpisode.keys.add(draft.key);
        }
        break;
      }
      case "zotero_get": {
        const ref = refArgOf(args) ?? (meta === null ? null : stringField(meta, "ref") ?? null);
        if (ref === null) break;
        const draft = draftOf(ref, seq);
        countOperation(draft, state);
        if (state !== "ok" || meta === null) break;
        const view = getMetaOf(meta);
        if (view.title === null) break;
        draft.facts.inspected = true;
        draft.title = view.title;
        if (view.creators !== null) draft.creators = view.creators;
        if (view.venue !== null) draft.venue = view.venue;
        if (view.year !== null) draft.year = view.year;
        if (view.bestAttachment !== null) draft.bestAttachment = view.bestAttachment;
        break;
      }
      case "zotero_retrieve": {
        const ref = refArgOf(args);
        if (ref === null) break;
        const draft = draftOf(ref, seq);
        countOperation(draft, state);
        if (state === "ok" && meta !== null) {
          pushEvidence(draft, meta, block.callId, seq, eventTimeOf(block));
        }
        break;
      }
      case "zotero_attachment": {
        const ref = refArgOf(args);
        if (ref === null) break;
        const draft = draftOf(ref, seq);
        countOperation(draft, state);
        if (state !== "ok" || meta === null) break;
        const view = attachmentMetaOf(meta);
        if (view.kind === null || view.contentType === null) break;
        draft.facts.attachmentResolved = true;
        draft.attachment = {
          kind: view.kind,
          contentType: view.contentType,
          title: view.title ?? "",
          location: view.location ?? "",
          ...view.ref === null ? {} : { ref: view.ref }
        };
        break;
      }
      case "zotero_export": {
        if (state !== "ok") {
          if (state === "running") exportOperations.running += 1;
          else if (state === "stopped") exportOperations.stopped += 1;
          else exportOperations.failed += 1;
        }
        const metaView = meta === null ? null : exportMetaOf(meta);
        const { refs, refsOmitted } = exportRefsOf(metaView, args);
        if (refs.length === 0) break;
        for (const ref of refs) {
          const draft = draftOf(ref, seq);
          countOperation(draft, state);
        }
        if (state !== "ok") break;
        const text = (resultTextOf(block) ?? "").trimStart();
        if (text === "") break;
        const artifact = {
          callId: block.callId,
          format: metaView?.format ?? "",
          ...metaView?.style === null || metaView?.style === void 0 ? {} : { style: metaView.style },
          ...metaView?.locale === null || metaView?.locale === void 0 ? {} : { locale: metaView.locale },
          refs,
          refsOmitted,
          ...metaView === null || metaView.items.length === 0 ? {} : { items: metaView.items },
          // The settled result's event time (Unix epoch ms), never a
          // transcript position.
          settledAt: eventTimeOf(block),
          text
        };
        exports.push(artifact);
        for (const ref of refs) {
          const draft = byKey.get(normalizeRefKey(ref));
          if (draft !== void 0 && !draft.exportedCallIds.has(block.callId)) {
            draft.exportedCallIds.add(block.callId);
            draft.facts.exportCount += 1;
            draft.exports.push(artifact);
          }
        }
        break;
      }
      default:
        break;
    }
  }
  for (const episode of episodes) {
    omittedRows += episode.omitted;
    const provenance = {
      callId: episode.callId,
      ...episode.query === void 0 ? {} : { query: episode.query },
      mode: episode.mode,
      scope: episode.scope,
      ...episode.library ? { library: episode.library } : {},
      itemTypes: episode.itemTypes,
      tags: episode.tags,
      ...episode.tagMatch ? { tagMatch: episode.tagMatch } : {},
      excludeTags: episode.excludeTags,
      includeTrashed: episode.includeTrashed
    };
    for (const key of episode.keys) {
      byKey.get(key).searches.push(provenance);
    }
  }
  const currentServerId = options.currentServerId;
  const sources = [...byKey.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt).map((draft) => {
    const evidence = [...draft.evidence.values()].sort((a, b) => a.seq - b.seq).map((entry) => entry.passage);
    return {
      key: draft.key,
      ref: draft.ref,
      provenance: provenanceOf(draft.serverIds, currentServerId),
      ...draft.title === void 0 ? {} : { title: draft.title },
      ...draft.creators === void 0 ? {} : { creators: draft.creators },
      ...draft.year === void 0 ? {} : { year: draft.year },
      ...draft.venue === void 0 ? {} : { venue: draft.venue },
      facts: draft.facts,
      operations: draft.operations,
      searches: draft.searches,
      evidence,
      ...draft.bestAttachment === void 0 ? {} : { bestAttachment: draft.bestAttachment },
      ...draft.attachment === void 0 ? {} : { attachment: draft.attachment },
      ...draft.retrievalFacts === void 0 ? {} : { retrievalFacts: draft.retrievalFacts },
      ...draft.retrievalSummary === void 0 ? {} : { retrievalSummary: draft.retrievalSummary },
      exports: draft.exports,
      firstSeenAt: draft.firstSeenAt,
      lastTouchedAt: draft.lastTouchedAt
    };
  });
  return {
    sources,
    exports,
    exportOperations,
    omittedRows
  };
}

// src/client/components/workspace/ZoteroWorkspaceView.tsx
var import_react12 = require("react");

// node_modules/clsx/dist/clsx.mjs
function r(e) {
  var t, f, n = "";
  if ("string" == typeof e || "number" == typeof e) n += e;
  else if ("object" == typeof e) if (Array.isArray(e)) {
    var o = e.length;
    for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
  } else for (f in e) e[f] && (n && (n += " "), n += f);
  return n;
}
function clsx() {
  for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
  return n;
}
var clsx_default = clsx;

// src/client/actions/open-zotero.ts
function selectUrlOf(ref) {
  const key = shortKeyOf(ref);
  return key === null ? null : `zotero://select/library/items/${key}`;
}
function pdfUrlOf(ref, options = {}) {
  const key = shortKeyOf(ref);
  if (key === null) return null;
  const params = [];
  if (options.page !== void 0 && options.page !== "")
    params.push(`page=${encodeURIComponent(options.page)}`);
  if (options.annotation !== void 0 && options.annotation !== "")
    params.push(`annotation=${encodeURIComponent(options.annotation)}`);
  return `zotero://open-pdf/library/items/${key}${params.length === 0 ? "" : `?${params.join("&")}`}`;
}
function openVerdictOf(item) {
  switch (item.provenance) {
    case "verified":
      return "open";
    case "mismatch":
      return "blocked";
    default:
      return "unverified";
  }
}
function childRowLinks(row) {
  const inPdf = row.kind === "annotation";
  return {
    selectUrl: selectUrlOf(row.ref),
    pdfUrl: inPdf && row.parentRef != null ? pdfUrlOf(row.parentRef, { page: row.pageLabel ?? void 0 }) : null
  };
}

// src/client/sources/source-capabilities.ts
var PDF_CONTENT_TYPE = "application/pdf";
function isHttpUrl(value) {
  return value.startsWith("https://") || value.startsWith("http://");
}
function pdfCapabilityOf(item) {
  const candidates = [];
  if (item.attachment !== void 0) {
    candidates.push({
      ref: item.attachment.ref,
      contentType: item.attachment.contentType,
      kind: item.attachment.kind
    });
  }
  if (item.bestAttachment !== void 0) {
    candidates.push({ ref: item.bestAttachment.ref, contentType: item.bestAttachment.contentType });
  }
  if (item.retrievalFacts !== void 0) {
    candidates.push({
      ref: item.retrievalFacts.attachmentRef,
      contentType: item.retrievalFacts.attachmentContentType
    });
  }
  for (const candidate of candidates) {
    if (candidate.ref === void 0 || candidate.contentType !== PDF_CONTENT_TYPE) continue;
    if (candidate.kind === "url") continue;
    const url = pdfUrlOf(candidate.ref);
    if (url !== null) return { ref: candidate.ref, url, kind: "file" };
  }
  const web = item.attachment;
  if (web !== void 0 && web.kind === "url" && web.contentType === PDF_CONTENT_TYPE) {
    if (isHttpUrl(web.location)) return { kind: "url", url: web.location };
  }
  return null;
}
function hasPdf(item) {
  return pdfCapabilityOf(item) !== null;
}

// src/client/sources/selectors.ts
function hasIssue(item) {
  return item.operations.failed > 0 || item.operations.stopped > 0 || item.provenance === "mismatch";
}
function filterSources(sources, filter) {
  switch (filter) {
    case "pdf":
      return sources.filter((item) => hasPdf(item));
    case "retrieved":
      return sources.filter((item) => item.retrievalFacts !== void 0);
    case "evidence":
      return sources.filter((item) => item.facts.evidenceCount > 0);
    case "exported":
      return sources.filter((item) => item.facts.exportCount > 0);
    case "issues":
      return sources.filter((item) => hasIssue(item));
    default:
      return sources;
  }
}
function evidencePassageTotalOf(sources) {
  return sources.reduce((total, item) => total + item.evidence.length, 0);
}
function filterCountsOf(sources) {
  let pdf = 0;
  let retrieved = 0;
  let evidence = 0;
  let exported = 0;
  let issues = 0;
  for (const item of sources) {
    if (hasPdf(item)) pdf += 1;
    if (item.retrievalFacts !== void 0) retrieved += 1;
    if (item.facts.evidenceCount > 0) evidence += 1;
    if (item.facts.exportCount > 0) exported += 1;
    if (hasIssue(item)) issues += 1;
  }
  return { all: sources.length, pdf, retrieved, evidence, exported, issues };
}
var DOCUMENT_FORMATS = /* @__PURE__ */ new Set(["bibtex", "biblatex", "ris", "csljson"]);
function entryTextOf(artifact, item) {
  if (artifact.format === "csljson") {
    if (item.entryIndex === void 0) return void 0;
    try {
      const records = JSON.parse(artifact.text);
      const record = Array.isArray(records) ? records[item.entryIndex] : void 0;
      if (typeof record !== "object" || record === null) return void 0;
      return JSON.stringify(record);
    } catch {
      return void 0;
    }
  }
  if (item.start === void 0 || item.end === void 0) return void 0;
  return artifact.text.slice(item.start, item.end).trim();
}
function documentsOf(artifact) {
  if (artifact.items === void 0 || artifact.items.length === 0 || !DOCUMENT_FORMATS.has(artifact.format)) {
    return void 0;
  }
  const documents = [];
  const unresolved = [];
  for (const item of artifact.items) {
    const text = entryTextOf(artifact, item);
    if (text === void 0) {
      unresolved.push(item);
      continue;
    }
    documents.push({
      ref: item.ref,
      format: artifact.format,
      ...item.key === void 0 ? {} : { key: item.key },
      ...item.title === void 0 ? {} : { title: item.title },
      text,
      callIds: [artifact.callId],
      ...artifact.settledAt === void 0 ? {} : { latestExportedAt: artifact.settledAt }
    });
  }
  return { documents, unresolved };
}
function exportSectionsOf(exports) {
  const sections = [];
  const sectionByFormat = /* @__PURE__ */ new Map();
  const documentByKey = /* @__PURE__ */ new Map();
  for (const artifact of exports) {
    let section = sectionByFormat.get(artifact.format);
    if (section === void 0) {
      section = { format: artifact.format, documents: [], unresolved: [], unresolvedItems: [] };
      sectionByFormat.set(artifact.format, section);
      sections.push(section);
    }
    const resolved = documentsOf(artifact);
    if (resolved === void 0) {
      section.unresolved.push(artifact);
      continue;
    }
    for (const document2 of resolved.documents) {
      const key = `${document2.format}|${document2.ref}`;
      const existing = documentByKey.get(key);
      if (existing === void 0) {
        documentByKey.set(key, document2);
        section.documents.push(document2);
      } else {
        const merged = {
          ...existing,
          ...document2.title === void 0 ? {} : { title: document2.title },
          ...document2.key === void 0 ? {} : { key: document2.key },
          text: document2.text,
          callIds: [...existing.callIds, ...document2.callIds],
          ...document2.latestExportedAt === void 0 ? {} : { latestExportedAt: document2.latestExportedAt }
        };
        documentByKey.set(key, merged);
        section.documents[section.documents.indexOf(existing)] = merged;
      }
    }
    if (resolved.unresolved.length > 0) {
      section.unresolvedItems.push({ artifact, count: resolved.unresolved.length });
    }
  }
  return sections;
}
function exportedRefCountOf(exports) {
  const refs = /* @__PURE__ */ new Set();
  for (const artifact of exports) {
    for (const ref of artifact.refs) refs.add(normalizeRefKey(ref));
  }
  return refs.size;
}

// src/client/components/workspace/WorkspaceToolbar.tsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/build-info.ts
function buildVersion() {
  return true ? "0.12.1" : "unknown";
}
function buildCommit() {
  return true ? "abb4054" : "unknown";
}
function buildInfoOf() {
  return `${buildVersion()} \xB7 ${buildCommit()}`;
}

// src/client/components/workspace/connection.ts
function connectionDiagnosisOf(connection, t) {
  if (connection.kind === "remote-error") return diagnosisLine(connection.message, t);
  if (connection.kind === "unavailable") {
    const diagnosis = connection.data.diagnosis;
    return diagnosis === "" ? t("diagnosisUnknown") : diagnosisLine(diagnosis, t);
  }
  return "";
}

// src/client/components/workspace/workspace.module.css
var style7 = `._2JqWDq_view{background:var(--dsw-alias-bg-layer-1);height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;container-type:inline-size}._2JqWDq_lensBar,._2JqWDq_workspace,._2JqWDq_exportsPage,._2JqWDq_evidencePage{box-sizing:border-box;width:100%;max-width:1440px;margin-inline:auto}._2JqWDq_toolbar{border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap;flex:none;align-items:center;gap:4px 8px;min-height:36px;padding:5px 12px;display:flex}._2JqWDq_statusText{color:var(--dsw-alias-label-secondary);flex:none;font-size:13px;font-weight:500;line-height:20px}._2JqWDq_diagnosis{min-width:0;color:var(--dsw-alias-state-error-primary);white-space:normal;overflow-wrap:anywhere;flex:auto;font-size:12px;line-height:18px;overflow:hidden}._2JqWDq_spacer{flex:auto}._2JqWDq_menuButton{min-width:28px;height:24px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;flex:none;justify-content:center;align-items:center;padding:0 6px;font-family:inherit;font-size:12px;line-height:16px;display:inline-flex}._2JqWDq_menuButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._2JqWDq_menuButton:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._2JqWDq_refresh{height:24px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;flex:none;align-items:center;padding:0 8px;font-family:inherit;font-size:12px;line-height:16px;display:inline-flex}._2JqWDq_refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._2JqWDq_refresh:disabled{opacity:.5;cursor:default}._2JqWDq_refresh:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._2JqWDq_lensBar{flex:none;align-items:stretch;gap:12px;padding:4px 12px 0;display:flex}._2JqWDq_lensTab{color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color .12s var(--ds-ease-in-out);background:0 0;border:none;border-bottom:2px solid #0000;align-items:center;gap:6px;margin-bottom:-1px;padding:6px 2px;font-family:inherit;font-size:13px;line-height:20px;display:inline-flex}._2JqWDq_lensTab:hover{color:var(--dsw-alias-label-primary)}._2JqWDq_lensTab:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}._2JqWDq_lensTabActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}._2JqWDq_lensTabCount{color:var(--dsw-alias-label-caption);font-size:12px;line-height:16px}._2JqWDq_workspace{flex:auto;grid-template-columns:clamp(280px,30cqi,400px) minmax(0,1fr);min-height:0;display:grid}._2JqWDq_sidebar{min-height:0;padding:8px 12px calc(var(--dsh-composer-height,152px) + 16px);border-right:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;display:flex;overflow:hidden}._2JqWDq_filterBar{scrollbar-width:none;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-wrap:nowrap;flex:none;align-items:center;gap:4px;display:flex;position:relative;overflow-x:auto}._2JqWDq_filterBar>*{flex:none}._2JqWDq_filterBar::-webkit-scrollbar{display:none}._2JqWDq_filterArrow{z-index:2;corner-shape:round;background:var(--dsw-specific-input-major);width:20px;height:20px;color:var(--dsw-alias-label-secondary);box-shadow:var(--dsw-elevation-panel);cursor:pointer;border:0;border-radius:999px;place-items:center;padding:0;display:grid;position:absolute;top:50%;transform:translateY(-50%)}._2JqWDq_filterArrow:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}._2JqWDq_filterArrowLeft{left:2px}._2JqWDq_filterArrowRight{right:2px}._2JqWDq_evidenceEntry{height:24px;color:var(--dsw-alias-link);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;align-self:flex-start;align-items:center;margin-left:8px;padding:0;font-family:inherit;font-size:12px;font-weight:500;line-height:16px;text-decoration:none;display:inline-flex}._2JqWDq_evidenceEntry:hover{text-underline-offset:3px;text-decoration:underline dotted}._2JqWDq_evidenceEntry:focus-visible{outline:1px solid var(--dsw-alias-link);outline-offset:1px}._2JqWDq_evidencePage{min-height:0;padding:8px 16px calc(var(--dsh-composer-height,152px) + 16px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:auto;gap:8px;display:flex;overflow-y:auto}._2JqWDq_emptyNote{color:var(--dsw-alias-label-caption);margin:0;font-size:12px;line-height:18px}._2JqWDq_emptyWrap{flex-direction:column;align-items:flex-start;gap:6px;display:flex}._2JqWDq_filterClear{height:24px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;align-items:center;padding:0 8px;font-family:inherit;font-size:12px;line-height:16px;display:inline-flex}._2JqWDq_filterClear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._2JqWDq_filterClear:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._2JqWDq_listbox{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:auto;gap:2px;min-height:0;display:flex;overflow-y:auto}._2JqWDq_listItem{border-radius:var(--dsw-radius-sm);cursor:pointer;border-left:2px solid #0000;flex-direction:column;gap:1px;padding:6px 8px 6px 10px;display:flex}._2JqWDq_listItem:hover{background:var(--dsw-alias-interactive-bg-hover)}._2JqWDq_listItem:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}._2JqWDq_listItemSelected{background:var(--dsw-alias-interactive-bg-hover);border-left-color:var(--dsw-alias-state-business-primary)}._2JqWDq_listItemTitle{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}._2JqWDq_listItemMeta{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden}._2JqWDq_badges{flex-wrap:wrap;align-items:center;gap:4px;display:inline-flex}._2JqWDq_badge{border-radius:var(--dsw-radius-xs);letter-spacing:.035em;height:18px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);align-items:center;padding:0 6px;font-size:10px;font-weight:650;line-height:12px;display:inline-flex}._2JqWDq_inspector{min-height:0;padding:8px 16px calc(var(--dsh-composer-height,152px) + 16px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;gap:8px;display:flex;overflow-y:auto}._2JqWDq_backAction{display:none}._2JqWDq_inspectorHead,._2JqWDq_inspectorTitleWrap{flex-direction:column;gap:2px;display:flex}._2JqWDq_inspectorTitle{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px}._2JqWDq_inspectorMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}._2JqWDq_inspectorTabs{border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;align-items:stretch;gap:12px;display:flex}._2JqWDq_detailTab{color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color .12s var(--ds-ease-in-out);background:0 0;border:none;border-bottom:2px solid #0000;align-items:center;gap:5px;margin-bottom:-1px;padding:4px 1px;font-family:inherit;font-size:12px;line-height:18px;display:inline-flex}._2JqWDq_detailTab:hover{color:var(--dsw-alias-label-primary)}._2JqWDq_detailTab:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}._2JqWDq_detailTabActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}._2JqWDq_detailTabCount{color:var(--dsw-alias-label-caption);font-size:11px;line-height:14px}._2JqWDq_inspectorBody{flex-direction:column;gap:8px;min-height:0;display:flex}._2JqWDq_panel{flex-direction:column;gap:6px;max-width:900px;display:flex}._2JqWDq_section{flex-direction:column;gap:2px;display:flex}._2JqWDq_sectionLabel{color:var(--dsw-alias-label-caption);margin:0;font-size:12px;line-height:18px}._2JqWDq_line{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}._2JqWDq_note{color:var(--dsw-alias-label-caption);margin:0;font-size:12px;line-height:18px}._2JqWDq_warning{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}._2JqWDq_summaryLine{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}._2JqWDq_actionRow{flex-wrap:wrap;align-items:center;gap:4px;display:flex}._2JqWDq_action{height:24px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;align-items:center;padding:0 8px;font-family:inherit;font-size:12px;line-height:16px;display:inline-flex}._2JqWDq_action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._2JqWDq_action:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._2JqWDq_passages{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}._2JqWDq_passage{flex-direction:column;gap:2px;display:flex}._2JqWDq_passageHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._2JqWDq_sourceTag{border-radius:var(--dsw-radius-xs);letter-spacing:.035em;height:18px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);align-items:center;padding:0 6px;font-size:10px;font-weight:650;line-height:12px;display:inline-flex}._2JqWDq_availability{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}._2JqWDq_detailToggle{height:22px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;align-self:flex-start;align-items:center;padding:0 2px;font-family:inherit;font-size:12px;line-height:16px;display:inline-flex}._2JqWDq_detailToggle:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}._2JqWDq_detailToggle:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._2JqWDq_exportsPage{min-height:0;padding:8px 16px calc(var(--dsh-composer-height,152px) + 16px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:auto;gap:8px;display:flex;overflow-y:auto}._2JqWDq_empty{min-height:0;padding:72px 16px calc(var(--dsh-composer-height,152px) + 32px);flex-direction:column;flex:auto;align-items:center;gap:8px;display:flex}._2JqWDq_emptyIcon{color:var(--dsw-alias-label-caption)}._2JqWDq_emptyText{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}._2JqWDq_starterRow{flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;margin-top:4px;display:flex}@container (width<=640px){._2JqWDq_workspace{grid-template-columns:minmax(0,1fr)}._2JqWDq_workspace[data-pane=list] ._2JqWDq_inspector,._2JqWDq_workspace[data-pane=detail] ._2JqWDq_sidebar{display:none}._2JqWDq_backAction{height:24px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;align-self:flex-start;align-items:center;padding:0 8px;font-family:inherit;font-size:12px;line-height:16px;display:inline-flex}._2JqWDq_backAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._2JqWDq_backAction:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}}@container (width<=560px){._2JqWDq_lensBar{padding:4px 8px 0}._2JqWDq_sidebar{padding:8px 8px calc(var(--dsh-composer-height,152px) + 16px)}._2JqWDq_inspector,._2JqWDq_exportsPage{padding-left:12px;padding-right:12px}}@container (width<=460px){._2JqWDq_toolbar{padding:4px 8px}}@media (prefers-reduced-motion:reduce){._2JqWDq_refresh,._2JqWDq_action,._2JqWDq_menuButton,._2JqWDq_filterClear,._2JqWDq_backAction,._2JqWDq_lensTab,._2JqWDq_detailTab{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/workspace/workspace.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/workspace/workspace.module.css");
  tag.textContent = style7;
  document.head.appendChild(tag);
}
var workspace_default = { "evidenceEntry": "_2JqWDq_evidenceEntry", "emptyNote": "_2JqWDq_emptyNote", "emptyWrap": "_2JqWDq_emptyWrap", "inspector": "_2JqWDq_inspector", "filterArrowLeft": "_2JqWDq_filterArrowLeft", "section": "_2JqWDq_section", "listItemSelected": "_2JqWDq_listItemSelected", "listItemTitle": "_2JqWDq_listItemTitle", "backAction": "_2JqWDq_backAction", "inspectorBody": "_2JqWDq_inspectorBody", "lensTab": "_2JqWDq_lensTab", "passages": "_2JqWDq_passages", "line": "_2JqWDq_line", "workspace": "_2JqWDq_workspace", "passageHead": "_2JqWDq_passageHead", "listbox": "_2JqWDq_listbox", "summaryLine": "_2JqWDq_summaryLine", "view": "_2JqWDq_view", "sourceTag": "_2JqWDq_sourceTag", "availability": "_2JqWDq_availability", "inspectorTabs": "_2JqWDq_inspectorTabs", "inspectorHead": "_2JqWDq_inspectorHead", "empty": "_2JqWDq_empty", "detailTab": "_2JqWDq_detailTab", "diagnosis": "_2JqWDq_diagnosis", "emptyIcon": "_2JqWDq_emptyIcon", "lensTabCount": "_2JqWDq_lensTabCount", "badges": "_2JqWDq_badges", "spacer": "_2JqWDq_spacer", "action": "_2JqWDq_action", "sidebar": "_2JqWDq_sidebar", "listItem": "_2JqWDq_listItem", "filterClear": "_2JqWDq_filterClear", "panel": "_2JqWDq_panel", "menuButton": "_2JqWDq_menuButton", "filterArrow": "_2JqWDq_filterArrow", "detailTabActive": "_2JqWDq_detailTabActive", "refresh": "_2JqWDq_refresh", "sectionLabel": "_2JqWDq_sectionLabel", "inspectorTitle": "_2JqWDq_inspectorTitle", "actionRow": "_2JqWDq_actionRow", "detailToggle": "_2JqWDq_detailToggle", "inspectorMeta": "_2JqWDq_inspectorMeta", "evidencePage": "_2JqWDq_evidencePage", "starterRow": "_2JqWDq_starterRow", "detailTabCount": "_2JqWDq_detailTabCount", "badge": "_2JqWDq_badge", "lensBar": "_2JqWDq_lensBar", "lensTabActive": "_2JqWDq_lensTabActive", "inspectorTitleWrap": "_2JqWDq_inspectorTitleWrap", "toolbar": "_2JqWDq_toolbar", "exportsPage": "_2JqWDq_exportsPage", "statusText": "_2JqWDq_statusText", "note": "_2JqWDq_note", "passage": "_2JqWDq_passage", "emptyText": "_2JqWDq_emptyText", "filterBar": "_2JqWDq_filterBar", "warning": "_2JqWDq_warning", "filterArrowRight": "_2JqWDq_filterArrowRight", "listItemMeta": "_2JqWDq_listItemMeta" };

// src/client/components/workspace/WorkspaceToolbar.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function WorkspaceToolbar({ connection, onRefresh, t }) {
  const [menuOpen, setMenuOpen] = (0, import_react4.useState)(false);
  const failed = connection.kind === "unavailable" || connection.kind === "remote-error";
  const diagnosis = failed ? connectionDiagnosisOf(connection, t) : "";
  const checkedAt = connection.kind === "connected" || connection.kind === "unavailable" ? connection.checkedAt : void 0;
  const data = connection.kind === "connected" || connection.kind === "unavailable" ? connection.data : void 0;
  const menuItems = [
    ...data?.serverId !== void 0 ? [{ id: "serverId", label: `${t("serverIdLabel")} ${data.serverId}`, disabled: true }] : [],
    ...data?.write !== void 0 ? [
      {
        id: "write",
        label: `${t("writeLabel")} ${writeStatusLabel(data.write, t)}`,
        disabled: true
      }
    ] : [],
    ...data?.zoteroVersion !== void 0 ? [
      {
        id: "zotero",
        label: `${t("zoteroVersionLabel")} ${data.zoteroVersion}`,
        disabled: true
      }
    ] : [],
    ...data?.apiVersion !== void 0 ? [{ id: "api", label: `${t("apiVersionLabel")} ${data.apiVersion}`, disabled: true }] : [],
    ...data?.schemaVersion !== void 0 ? [
      {
        id: "schema",
        label: `${t("schemaVersionLabel")} ${data.schemaVersion}`,
        disabled: true
      }
    ] : [],
    ...checkedAt !== void 0 ? [{ id: "checked", label: `${t("lastCheckedLabel")} ${checkedAt}`, disabled: true }] : [],
    { id: "build", label: `${t("buildInfoLabel")} ${buildInfoOf()}`, disabled: true }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "div",
    {
      className: workspace_default.toolbar,
      role: "status",
      "aria-live": "polite",
      "aria-busy": connection.kind === "loading",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          import_dsh_client_ui_primitives7.StateDot,
          {
            state: connection.kind === "loading" ? "ongoing" : connection.kind === "connected" ? "done" : "error"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: workspace_default.statusText, children: [
          connection.kind === "loading" && t("checking"),
          connection.kind === "connected" && t("statusConnectedNote"),
          failed && t("statusUnavailable")
        ] }),
        failed && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: workspace_default.diagnosis, title: diagnosis, children: diagnosis }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: workspace_default.spacer }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          import_dsh_client_ui_primitives7.Menu,
          {
            open: menuOpen,
            anchor: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              "button",
              {
                type: "button",
                className: workspace_default.menuButton,
                "aria-label": t("detailsLabel"),
                onClick: () => {
                  setMenuOpen(!menuOpen);
                },
                children: "\xB7\xB7\xB7"
              }
            ),
            items: menuItems,
            onSelect: () => {
              setMenuOpen(false);
            },
            onClose: () => {
              setMenuOpen(false);
            },
            portal: true,
            autoFocus: true,
            align: "end"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "button",
          {
            type: "button",
            className: workspace_default.refresh,
            onClick: onRefresh,
            disabled: connection.kind === "loading",
            children: t("refresh")
          }
        )
      ]
    }
  );
}

// src/client/components/workspace/SourceSidebar.tsx
var import_react5 = require("react");
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/workspace/SourceListItem.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function badgesOf(item, t) {
  const badges = [];
  if (hasPdf(item)) badges.push(t("badgePdf"));
  if (item.facts.evidenceCount > 0)
    badges.push(t("evidenceBadge", { count: item.facts.evidenceCount }));
  if (item.facts.exportCount > 0) badges.push(t("exportBadge", { count: item.facts.exportCount }));
  if (hasIssue(item)) badges.push(t("issuesBadge"));
  return badges;
}
function SourceListItem({
  item,
  selected,
  focused,
  optionRef,
  onSelect,
  t
}) {
  const badges = badgesOf(item, t);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "div",
    {
      ref: optionRef,
      role: "option",
      "aria-selected": selected,
      tabIndex: focused ? 0 : -1,
      "data-provenance": item.provenance,
      className: clsx_default(workspace_default.listItem, selected && workspace_default.listItemSelected),
      onClick: onSelect,
      onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: workspace_default.listItemTitle, children: item.title ?? item.ref }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: workspace_default.listItemMeta, children: joinNonEmpty(item.creators, item.year, item.venue) }),
        badges.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: workspace_default.badges, children: badges.map((badge) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: workspace_default.badge, "data-badge": true, children: badge }, badge)) })
      ]
    }
  );
}

// src/client/components/workspace/SourceSidebar.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
function shownFiltersOf(filter, counts) {
  return FILTERS.filter(
    (entry) => entry.id === "all" || entry.id === filter || counts[entry.id] > 0
  );
}
function SourceSidebar({
  workspace,
  filter,
  counts,
  visible,
  selection,
  selectedKey,
  setFilter,
  setSelection,
  setMobilePane,
  onOpenEvidence,
  t
}) {
  const optionRefs = (0, import_react5.useRef)([]);
  optionRefs.current.length = visible.length;
  const filterBarRef = (0, import_react5.useRef)(null);
  const [filterEdges, setFilterEdges] = (0, import_react5.useState)({ left: false, right: false });
  const updateFilterEdges = (0, import_react5.useCallback)(() => {
    const el = filterBarRef.current;
    if (el === null) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setFilterEdges((prev) => prev.left === left && prev.right === right ? prev : { left, right });
  }, []);
  (0, import_react5.useLayoutEffect)(() => {
    updateFilterEdges();
  }, [counts, filter, updateFilterEdges]);
  (0, import_react5.useEffect)(() => {
    const el = filterBarRef.current;
    if (el === null) return;
    el.addEventListener("scroll", updateFilterEdges);
    const observer = new ResizeObserver(updateFilterEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateFilterEdges);
      observer.disconnect();
    };
  }, [updateFilterEdges]);
  const pageFilters = (direction) => {
    const el = filterBarRef.current;
    if (el === null) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth - 60, 120) });
  };
  const focusVisible = (index) => {
    optionRefs.current[index]?.focus();
  };
  const moveSelection = (nextIndex) => {
    if (visible.length === 0) return;
    const clamped = Math.max(0, Math.min(visible.length - 1, nextIndex));
    const current = visible[clamped];
    if (current === void 0) return;
    setSelection({ key: current.key, focusIndex: clamped });
    focusVisible(clamped);
  };
  const onKeyDown = (event) => {
    const currentIndex = Math.max(0, Math.min(selection.focusIndex, visible.length - 1));
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveSelection(currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveSelection(currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        moveSelection(0);
        break;
      case "End":
        event.preventDefault();
        moveSelection(visible.length - 1);
        break;
      default:
        break;
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("aside", { className: workspace_default.sidebar, children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
      "div",
      {
        className: workspace_default.filterBar,
        ref: filterBarRef,
        role: "group",
        "aria-label": t("filterBarLabel"),
        children: [
          filterEdges.left && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            "button",
            {
              type: "button",
              className: clsx_default(workspace_default.filterArrow, workspace_default.filterArrowLeft),
              "aria-label": t("filterScrollLeft"),
              onClick: () => {
                pageFilters(-1);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives8.IconChevronLeftOutlineMedium, {})
            }
          ),
          shownFiltersOf(filter, counts).map((entry) => {
            const count = counts[entry.id];
            return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              import_dsh_client_ui_primitives8.Pill,
              {
                active: filter === entry.id,
                "aria-pressed": filter === entry.id,
                onClick: () => {
                  setFilter(entry.id);
                },
                children: `${t(entry.key)} ${count}`
              },
              entry.id
            );
          }),
          filterEdges.right && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            "button",
            {
              type: "button",
              className: clsx_default(workspace_default.filterArrow, workspace_default.filterArrowRight),
              "aria-label": t("filterScrollRight"),
              onClick: () => {
                pageFilters(1);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives8.IconChevronRightOutlineMedium, {})
            }
          )
        ]
      }
    ),
    counts.evidence >= 2 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: workspace_default.evidenceEntry, onClick: onOpenEvidence, children: t("evidenceEntryLabel", {
      count: evidencePassageTotalOf(workspace.sources)
    }) }),
    workspace.omittedRows > 0 && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: workspace_default.emptyNote, children: t("omittedRowsNote", { count: workspace.omittedRows }) }),
    visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: workspace_default.emptyWrap, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: workspace_default.emptyNote, children: t("filterEmptyNote") }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        "button",
        {
          type: "button",
          className: workspace_default.filterClear,
          onClick: () => {
            setFilter("all");
          },
          children: t("filterClear")
        }
      )
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
      "div",
      {
        className: workspace_default.listbox,
        role: "listbox",
        "aria-label": t("lensSources"),
        onKeyDown,
        children: visible.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
          SourceListItem,
          {
            item,
            selected: item.key === selectedKey,
            focused: index === selection.focusIndex,
            optionRef: (el) => {
              optionRefs.current[index] = el;
            },
            onSelect: () => {
              setSelection({ key: item.key, focusIndex: index });
              setMobilePane("detail");
            },
            t
          },
          item.key
        ))
      }
    )
  ] });
}

// src/client/components/workspace/SourceInspector.tsx
var import_react11 = require("react");

// src/client/components/workspace/SourceOverview.tsx
var import_react8 = require("react");

// src/client/actions/source-actions.ts
function askDraftOf(ref, t) {
  return t("askTemplate", { ref });
}
function exportDraftOf(ref, t) {
  return t("citeTemplate", { ref });
}

// src/client/components/CopyButton.tsx
var import_react6 = require("react");
var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/cards.module.css
var style8 = `._83fRkq_note{color:var(--dsw-alias-label-caption);margin:0;font-size:12px;line-height:18px}._83fRkq_line{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}._83fRkq_lineActions{flex:none;align-items:center;gap:4px;margin-left:auto;display:inline-flex}._83fRkq_lineAction{height:24px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;align-items:center;padding:0 8px;font-family:inherit;font-size:12px;line-height:16px;display:inline-flex}._83fRkq_lineAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._83fRkq_lineAction:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._83fRkq_chevron{color:var(--dsw-alias-label-caption);transition:transform .12s var(--ds-ease-in-out);flex:none}._83fRkq_chevronOpen{transform:rotate(180deg)}._83fRkq_card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);flex-direction:column;gap:6px;max-width:900px;padding:10px 12px;display:flex}._83fRkq_cardHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._83fRkq_cardTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}._83fRkq_link{color:var(--dsw-alias-link);font-size:12px;font-weight:500;line-height:16px;text-decoration:none}._83fRkq_link:hover,._83fRkq_link:focus-visible{text-underline-offset:3px;text-decoration:underline dotted}._83fRkq_link:focus-visible{outline:1px solid var(--dsw-alias-link);outline-offset:1px}._83fRkq_passages{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}._83fRkq_passage{flex-direction:column;gap:2px;display:flex}._83fRkq_passageHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._83fRkq_sourceTag{border-radius:var(--dsw-radius-xs);letter-spacing:.035em;height:18px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);align-items:center;padding:0 6px;font-size:10px;font-weight:650;line-height:12px;display:inline-flex}._83fRkq_availability{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}._83fRkq_exportRow{flex-direction:column;gap:4px;padding:6px 0;display:flex}._83fRkq_exportSection{flex-direction:column;gap:2px;display:flex}._83fRkq_exportStack{flex-direction:column;display:flex}._83fRkq_exportStack>*+*{border-top:1px solid var(--dsw-alias-border-l2)}._83fRkq_exportSectionHead{flex-wrap:wrap;align-items:center;gap:4px 8px;padding:6px 0 4px;display:flex}._83fRkq_exportSectionTitle{color:var(--dsw-alias-label-primary);flex:none;font-size:13px;font-weight:500;line-height:20px}._83fRkq_exportSectionCount{color:var(--dsw-alias-label-caption);flex:none;font-size:12px;line-height:18px}._83fRkq_exportSectionActions{align-items:center;gap:4px;margin-left:auto;display:inline-flex}._83fRkq_documentKey{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);flex:auto;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}._83fRkq_documentTitle{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);margin:0;padding-left:2px;font-size:12px;line-height:18px;overflow:hidden}._83fRkq_exportHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._83fRkq_exportToggle{text-align:left;cursor:pointer;background:0 0;border:none;flex:auto;align-items:center;gap:8px;min-width:0;padding:2px 0;font-family:inherit;display:inline-flex}._83fRkq_exportToggle:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:var(--dsw-radius-xs)}._83fRkq_exportTitle{color:var(--dsw-alias-label-primary);flex:none;font-size:13px;font-weight:500;line-height:20px}._83fRkq_exportFacts{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex:auto;font-size:12px;line-height:18px;overflow:hidden}._83fRkq_exportBody{flex-direction:column;gap:6px;max-width:960px;padding:4px 0 10px;display:flex}._83fRkq_exportCode{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);overflow:hidden}._83fRkq_exportCodeHead{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;min-height:32px;padding:0 10px;display:flex}._83fRkq_exportCodeLabel{min-width:0;color:var(--dsw-alias-label-secondary);flex:auto;font-size:12px;line-height:16px}._83fRkq_exportKeys{flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0;display:flex}._83fRkq_exportKeysText{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:480px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow:hidden}._83fRkq_exportPre{max-height:280px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-secondary);white-space:pre;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);margin:0;padding:10px 12px;font-size:12px;line-height:18px;overflow:auto}._83fRkq_unresolvedItems{flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 0 6px;display:flex}._83fRkq_unresolvedItemsText{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}@media (prefers-reduced-motion:reduce){._83fRkq_chevron,._83fRkq_lineAction{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/cards.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/cards.module.css");
  tag.textContent = style8;
  document.head.appendChild(tag);
}
var cards_default = { "exportSectionHead": "_83fRkq_exportSectionHead", "exportCode": "_83fRkq_exportCode", "documentTitle": "_83fRkq_documentTitle", "exportCodeHead": "_83fRkq_exportCodeHead", "exportCodeLabel": "_83fRkq_exportCodeLabel", "card": "_83fRkq_card", "exportBody": "_83fRkq_exportBody", "exportKeysText": "_83fRkq_exportKeysText", "exportPre": "_83fRkq_exportPre", "exportSection": "_83fRkq_exportSection", "note": "_83fRkq_note", "sourceTag": "_83fRkq_sourceTag", "unresolvedItems": "_83fRkq_unresolvedItems", "exportTitle": "_83fRkq_exportTitle", "exportToggle": "_83fRkq_exportToggle", "chevron": "_83fRkq_chevron", "cardHead": "_83fRkq_cardHead", "link": "_83fRkq_link", "unresolvedItemsText": "_83fRkq_unresolvedItemsText", "exportKeys": "_83fRkq_exportKeys", "passageHead": "_83fRkq_passageHead", "lineActions": "_83fRkq_lineActions", "lineAction": "_83fRkq_lineAction", "passages": "_83fRkq_passages", "passage": "_83fRkq_passage", "availability": "_83fRkq_availability", "line": "_83fRkq_line", "exportRow": "_83fRkq_exportRow", "exportSectionTitle": "_83fRkq_exportSectionTitle", "exportSectionActions": "_83fRkq_exportSectionActions", "exportStack": "_83fRkq_exportStack", "exportHead": "_83fRkq_exportHead", "documentKey": "_83fRkq_documentKey", "cardTitle": "_83fRkq_cardTitle", "chevronOpen": "_83fRkq_chevronOpen", "exportSectionCount": "_83fRkq_exportSectionCount", "exportFacts": "_83fRkq_exportFacts" };

// src/client/components/CopyButton.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
function CopyButton({ value, label, copiedLabel, className }) {
  const [copied, setCopied] = (0, import_react6.useState)(false);
  const epoch = (0, import_react6.useRef)(0);
  (0, import_react6.useEffect)(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
    "button",
    {
      type: "button",
      className: className ?? cards_default.lineAction,
      "aria-label": label,
      onClick: () => {
        const mine = epoch.current += 1;
        void (0, import_dsh_client_ui_primitives9.writeClipboard)(value).then((ok) => {
          if (ok && epoch.current === mine) setCopied(true);
        });
      },
      children: copied ? copiedLabel : label
    }
  );
}

// src/client/components/open/BlockedOpenAction.tsx
var import_react7 = require("react");
var import_dsh_client_ui_primitives10 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/open/open.module.css
var style9 = `.KugbzW_linkWrap{flex-wrap:wrap;align-items:center;gap:4px;display:inline-flex}.KugbzW_link{color:var(--dsw-alias-link);font-size:12px;font-weight:500;line-height:16px;text-decoration:none}.KugbzW_link:hover,.KugbzW_link:focus-visible{text-underline-offset:3px;text-decoration:underline dotted}.KugbzW_link:focus-visible{outline:1px solid var(--dsw-alias-link);outline-offset:1px}.KugbzW_linkIcon{vertical-align:-.25em;flex:none;width:1.1em;height:1.1em;margin-right:5px}.KugbzW_note{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}.KugbzW_button{height:24px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;align-items:center;padding:0 8px;font-family:inherit;font-size:12px;line-height:16px;text-decoration:none;display:inline-flex}.KugbzW_button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.KugbzW_button:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.KugbzW_blocked{opacity:.5;cursor:default}.KugbzW_blocked:hover{color:var(--dsw-alias-label-secondary);background:0 0}.KugbzW_srOnly{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}@media (prefers-reduced-motion:reduce){.KugbzW_button{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/open/open.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/open/open.module.css");
  tag.textContent = style9;
  document.head.appendChild(tag);
}
var open_default = { "blocked": "KugbzW_blocked", "note": "KugbzW_note", "button": "KugbzW_button", "srOnly": "KugbzW_srOnly", "link": "KugbzW_link", "linkIcon": "KugbzW_linkIcon", "linkWrap": "KugbzW_linkWrap" };

// src/client/components/open/BlockedOpenAction.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function BlockedOpenAction({ label, t, className }) {
  const reason = t("provenanceMismatch");
  const reasonId = (0, import_react7.useId)();
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives10.Tooltip, { label: reason, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
      "button",
      {
        type: "button",
        className: clsx_default(className ?? open_default.button, open_default.blocked),
        "aria-disabled": "true",
        "aria-describedby": reasonId,
        onClick: (event) => {
          event.preventDefault();
        },
        children: label
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { id: reasonId, className: open_default.srOnly, children: reason })
  ] });
}

// src/client/components/open/ZoteroOpenButton.tsx
var import_dsh_client_ui_primitives11 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/open/external-href.ts
function externalHrefProps(url) {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === "http:" || protocol === "https:") {
      return { target: "_blank", rel: "noopener noreferrer" };
    }
  } catch {
  }
  return {};
}

// src/client/components/open/ZoteroOpenButton.tsx
var import_jsx_runtime12 = require("react/jsx-runtime");
function ZoteroOpenButton({ url, verdict, label, t, className }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "a",
    {
      className: className ?? open_default.button,
      href: url,
      ...externalHrefProps(url),
      title: verdict === "unverified" ? t("instanceUnverified") : void 0,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives11.IconLinkOutlineMedium, { className: open_default.linkIcon }),
        label
      ]
    }
  );
}

// src/client/components/workspace/SourceOverview.tsx
var import_jsx_runtime13 = require("react/jsx-runtime");
function modeLabelOf(mode, t) {
  return mode === "everything" ? t("modeEverything") : t("modeMetadata");
}
function scopeLabelOf(scope, t) {
  switch (scope.kind) {
    case "library":
      return t("overviewScopeLibrary");
    case "publications":
      return t("overviewScopePublications");
    case "collection":
      return scope.name ?? scope.ref ?? t("overviewScopeCollection");
    case "savedSearch":
      return scope.name ?? scope.ref ?? t("overviewScopeSavedSearch");
  }
}
function filterLineOf(itemTypes, tags, _t) {
  const parts = [...itemTypes, ...tags];
  return parts.length === 0 ? "" : parts.join(" \xB7 ");
}
function SourceOverview({ item, t, setDraft }) {
  const [detailOpen, setDetailOpen] = (0, import_react8.useState)(false);
  const verdict = openVerdictOf(item);
  const selectUrl = selectUrlOf(item.ref);
  const pdfCapability = pdfCapabilityOf(item);
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: workspace_default.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: workspace_default.actionRow, children: [
      selectUrl !== null && (verdict === "blocked" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(BlockedOpenAction, { label: t("openInZotero"), t }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(ZoteroOpenButton, { url: selectUrl, verdict, label: t("openInZotero"), t })),
      pdfCapability !== null && (verdict === "blocked" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(BlockedOpenAction, { label: t("openPdf"), t }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        ZoteroOpenButton,
        {
          url: pdfCapability.url,
          verdict,
          label: t("openPdf"),
          t
        }
      )),
      setDraft !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "button",
        {
          type: "button",
          className: workspace_default.action,
          onClick: () => {
            setDraft(askDraftOf(item.ref, t));
          },
          children: t("askAboutItem")
        }
      ),
      setDraft !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "button",
        {
          type: "button",
          className: workspace_default.action,
          onClick: () => {
            setDraft(exportDraftOf(item.ref, t));
          },
          children: t("exportCitation")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        CopyButton,
        {
          className: workspace_default.action,
          value: item.ref,
          label: t("copyRef"),
          copiedLabel: t("copied")
        }
      )
    ] }),
    item.provenance === "mismatch" && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: workspace_default.warning, children: t("provenanceMismatch") }),
    item.searches.length > 0 ? item.searches.map((search, index) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: workspace_default.line, children: search.query !== void 0 ? t("searchFrom", { query: search.query }) : t("searchFromBrowse") }, `${search.callId}-${index}`)) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: workspace_default.note, children: t("overviewNoSearch") }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
      "button",
      {
        type: "button",
        className: workspace_default.detailToggle,
        "aria-expanded": detailOpen,
        onClick: () => {
          setDetailOpen(!detailOpen);
        },
        children: detailOpen ? t("searchDetailClose") : t("searchDetailOpen")
      }
    ),
    detailOpen && /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: workspace_default.section, children: [
      item.searches.map((search, index) => {
        const filters = filterLineOf(search.itemTypes, search.tags, t);
        return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: workspace_default.note, children: [
          `${t("scopeLine")} ${scopeLabelOf(search.scope, t)}`,
          filters !== "" ? ` \xB7 ${t("filterLine")} ${filters}` : "",
          ` \xB7 ${t("modeLine")} ${modeLabelOf(search.mode, t)}`
        ] }, `${search.callId}-${index}`);
      }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: workspace_default.note, children: `${t("refLine")} ${item.ref}` })
    ] })
  ] });
}

// src/client/evidence-labels.ts
function sourceLabelKeyOf(source) {
  switch (source) {
    case "annotation":
      return "sourceAnnotation";
    case "note":
      return "sourceNote";
    case "abstract":
      return "sourceAbstract";
    default:
      return "sourceFulltext";
  }
}
function coverageLineOf(coverage, t) {
  const suffix = coverage.complete ? t("coverageComplete") : t("coverageIncomplete");
  if (coverage.indexedPages !== void 0 && coverage.totalPages !== void 0) {
    return `${t("coverageLabel")} ${t("coveragePages", {
      indexed: coverage.indexedPages,
      total: coverage.totalPages
    })}${suffix}`;
  }
  if (coverage.indexedChars !== void 0 && coverage.totalChars !== void 0) {
    return `${t("coverageLabel")} ${t("coverageChars", {
      indexed: coverage.indexedChars,
      total: coverage.totalChars
    })}${suffix}`;
  }
  return "";
}
var CHILD_KIND_LABEL = {
  note: "toolChildrenNotes",
  attachment: "toolChildrenAttachments",
  annotation: "toolChildrenAnnotations"
};
function countOfLabel(total, shown, t) {
  if (total === null) return String(shown);
  if (total === shown) return String(total);
  return t("countOfReturned", { total, shown });
}
function availabilityLineOf(entry, t) {
  if (entry.unavailable) return t("availUnavailable");
  if (entry.returnedPassages > 0) return t("availReturned", { count: entry.returnedPassages });
  return t("availNoMatch");
}
function emptyEvidenceNoteOf(reportedEvidenceCount, t) {
  return reportedEvidenceCount > 0 ? t("evidenceReportedNoPreview", { count: reportedEvidenceCount }) : t("evidenceRetrievedNone");
}

// src/client/components/workspace/SourceEvidence.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
function retrievalSummaryLineOf(item, t) {
  const summary = item.retrievalSummary;
  if (summary === void 0) return "";
  const parts = [
    t("retrievalRunCount", { count: summary.runCount }),
    t("retrievalKeptCount", { count: item.facts.evidenceCount }),
    t("retrievalReportedCount", { count: item.facts.reportedEvidenceCount })
  ];
  if (summary.truncated) parts.push(t("budgetLimitedNote"));
  return parts.join(" \xB7 ");
}
function PassageRow({
  passage,
  t
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("li", { className: workspace_default.passage, "data-source": passage.source, children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: workspace_default.passageHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: workspace_default.sourceTag, children: t(sourceLabelKeyOf(passage.source)) }),
      passage.pageLabel !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: workspace_default.note, children: t("pageLabel", { label: passage.pageLabel }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: workspace_default.line, children: [
      passage.text,
      passage.previewTruncated ? ` ${t("truncatedPreview")}` : ""
    ] }),
    passage.callIds.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: workspace_default.note, children: t("retrievedMultiple", { count: passage.callIds.length }) })
  ] });
}
function SourceEvidence({ item, t }) {
  if (item.retrievalFacts === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: workspace_default.panel, children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: workspace_default.note, children: t("evidenceNotRetrieved") }) });
  }
  const summaryLine = retrievalSummaryLineOf(item, t);
  const facts = item.retrievalFacts;
  const coverageLine = facts.coverage === void 0 ? "" : coverageLineOf(facts.coverage, t);
  const availabilityEntries = Object.entries(facts.sourceAvailability);
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: workspace_default.panel, children: [
    summaryLine !== "" && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: workspace_default.summaryLine, children: summaryLine }),
    coverageLine !== "" && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: workspace_default.note, children: coverageLine }),
    item.evidence.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: workspace_default.note, children: emptyEvidenceNoteOf(item.facts.reportedEvidenceCount, t) }) : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("ul", { className: workspace_default.passages, children: item.evidence.map((passage, index) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(PassageRow, { passage, t }, `${passage.sourceRef}-${index}`)) }),
    availabilityEntries.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: workspace_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: workspace_default.sectionLabel, children: t("availabilityTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("ul", { className: workspace_default.availability, children: availabilityEntries.map(([source, entry]) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("li", { className: workspace_default.note, children: t("availabilityEntry", {
        source: t(sourceLabelKeyOf(source)),
        detail: availabilityLineOf(entry, t)
      }) }, source)) })
    ] })
  ] });
}

// src/client/download.ts
function downloadBlob(text, fileName, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

// src/client/components/ExportDocumentRow.tsx
var import_react10 = require("react");
var import_dsh_client_ui_primitives13 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/export-items.ts
var BIBTEX_KEY_SOURCE = "@[A-Za-z]+\\{([^,\\s{}]+),";
var BIBTEX_KEY = new RegExp(BIBTEX_KEY_SOURCE);

// src/client/sources/bibtex.ts
var BIBTEX_KEY2 = new RegExp(BIBTEX_KEY_SOURCE, "g");
function bibTexKeysOf(text) {
  const keys = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(BIBTEX_KEY2)) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}
function citeCommandOf(keys) {
  return keys.length === 0 ? "" : `\\cite{${keys.join(", ")}}`;
}

// src/client/components/ExportCard.tsx
var import_react9 = require("react");
var import_dsh_client_ui_primitives12 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime15 = require("react/jsx-runtime");
function formatLabelOf(format, t) {
  switch (format) {
    case "bibtex":
      return "BibTeX";
    case "biblatex":
      return "BibLaTeX";
    case "ris":
      return "RIS";
    case "csljson":
      return "CSL JSON";
    case "citation":
      return t("formatCitation");
    case "bibliography":
      return t("formatBibliography");
    default:
      return format === "" ? t("formatUnknown") : format;
  }
}
function extensionOf(format) {
  switch (format) {
    case "bibtex":
    case "biblatex":
      return ".bib";
    case "ris":
      return ".ris";
    case "csljson":
      return ".json";
    case "citation":
    case "bibliography":
      return ".txt";
    default:
      return ".txt";
  }
}
function mimeOf(format) {
  switch (format) {
    case "ris":
      return "application/x-research-info-systems";
    case "csljson":
      return "application/json";
    case "citation":
    case "bibliography":
      return "text/plain";
    default:
      return "text/plain";
  }
}
function sanitizeFileStem(stem) {
  const cleaned = stem === "" ? "export" : stem;
  return cleaned.replace(/[/\\:*?"<>|\x00-\x1F]/g, "-");
}
function fileNameForFormat(format) {
  return `zotero-${sanitizeFileStem(format)}${extensionOf(format)}`;
}
function fileNameOf(artifact) {
  return fileNameForFormat(artifact.format);
}
function artifactTimeOf(artifact) {
  if (artifact.settledAt === void 0) return "";
  const date = new Date(artifact.settledAt);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function ExportCard({ artifact, t }) {
  const [open, setOpen] = (0, import_react9.useState)(false);
  const keys = (0, import_react9.useMemo)(
    () => artifact.format === "bibtex" || artifact.format === "biblatex" ? bibTexKeysOf(artifact.text) : [],
    [artifact.format, artifact.text]
  );
  const citeCommand = (0, import_react9.useMemo)(() => citeCommandOf(keys), [keys]);
  const timeLabel = artifactTimeOf(artifact);
  const download = () => {
    downloadBlob(artifact.text, fileNameOf(artifact), mimeOf(artifact.format));
  };
  const headFacts = [
    t("exportRefCount", { count: artifact.refs.length }) + (artifact.refsOmitted > 0 ? ` \xB7 ${t("exportRefsOmitted", { count: artifact.refsOmitted })}` : ""),
    ...artifact.style !== void 0 ? [artifact.style] : [],
    ...artifact.locale !== void 0 ? [artifact.locale] : [],
    ...timeLabel !== "" ? [timeLabel] : []
  ].join(" \xB7 ");
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: cards_default.exportRow, "data-export-card": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: cards_default.exportHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
        "button",
        {
          type: "button",
          className: cards_default.exportToggle,
          "aria-expanded": open,
          onClick: () => {
            setOpen(!open);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: cards_default.exportTitle, children: formatLabelOf(artifact.format, t) }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: cards_default.exportFacts, children: headFacts }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives12.IconChevronDownOutlineMedium, { className: clsx_default(cards_default.chevron, open && cards_default.chevronOpen) })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("span", { className: cards_default.lineActions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(CopyButton, { value: artifact.text, label: t("copyExport"), copiedLabel: t("copied") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("button", { type: "button", className: cards_default.lineAction, onClick: download, children: `${t("downloadArtifact")} ${extensionOf(artifact.format)}` })
      ] })
    ] }),
    open && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: cards_default.exportBody, children: [
      citeCommand !== "" && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { className: cards_default.exportKeys, title: citeCommand, children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { className: cards_default.exportKeysText, children: keys.join(" \xB7 ") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(CopyButton, { value: citeCommand, label: t("copyCite"), copiedLabel: t("copied") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { className: cards_default.exportPre, children: artifact.text })
    ] })
  ] });
}

// src/client/components/ExportDocumentRow.tsx
var import_jsx_runtime16 = require("react/jsx-runtime");
function ExportDocumentRow({ doc, t }) {
  const [open, setOpen] = (0, import_react10.useState)(false);
  const citeCommand = (0, import_react10.useMemo)(
    () => doc.key === void 0 ? "" : citeCommandOf([doc.key]),
    [doc.key]
  );
  const download = () => {
    const base = sanitizeFileStem(doc.key ?? shortKeyOf(doc.ref) ?? "export");
    downloadBlob(doc.text, `zotero-${base}${extensionOf(doc.format)}`, mimeOf(doc.format));
  };
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: cards_default.exportRow, "data-export-document": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: cards_default.exportHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
        "button",
        {
          type: "button",
          className: cards_default.exportToggle,
          "aria-expanded": open,
          title: doc.key,
          onClick: () => {
            setOpen(!open);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: doc.key === void 0 ? cards_default.exportTitle : cards_default.documentKey, children: doc.key ?? doc.title ?? formatLabelOf(doc.format, t) }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives13.IconChevronDownOutlineMedium, { className: clsx_default(cards_default.chevron, open && cards_default.chevronOpen) })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("span", { className: cards_default.lineActions, children: [
        citeCommand !== "" && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(CopyButton, { value: citeCommand, label: t("copyCite"), copiedLabel: t("copied") }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", { type: "button", className: cards_default.lineAction, onClick: download, children: `${t("downloadArtifact")} ${extensionOf(doc.format)}` })
      ] })
    ] }),
    doc.key !== void 0 && doc.title !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: cards_default.documentTitle, children: doc.title }),
    open && /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: cards_default.exportBody, children: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: cards_default.exportCode, children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: cards_default.exportCodeHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { className: cards_default.exportCodeLabel, children: formatLabelOf(doc.format, t) }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(CopyButton, { value: doc.text, label: t("copyExport"), copiedLabel: t("copied") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { className: cards_default.exportPre, children: doc.text })
    ] }) })
  ] });
}

// src/client/components/ExportSections.tsx
var import_jsx_runtime17 = require("react/jsx-runtime");
function sectionTextOf(section) {
  return section.documents.map((document2) => document2.text).join("\n\n");
}
function downloadSection(section) {
  downloadBlob(
    sectionTextOf(section),
    `zotero-${sanitizeFileStem(section.format)}${extensionOf(section.format)}`,
    mimeOf(section.format)
  );
}
function downloadArtifact(artifact) {
  downloadBlob(artifact.text, fileNameOf(artifact), mimeOf(artifact.format));
}
function ExportSections({ exports, t }) {
  const sections = exportSectionsOf(exports);
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: cards_default.exportStack, children: sections.map((section) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(
    "section",
    {
      className: cards_default.exportSection,
      "data-export-format": section.format,
      children: [
        section.documents.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("header", { className: cards_default.exportSectionHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: cards_default.exportSectionTitle, children: formatLabelOf(section.format, t) }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: cards_default.exportSectionCount, children: section.documents.length }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("span", { className: cards_default.exportSectionActions, children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
              CopyButton,
              {
                value: sectionTextOf(section),
                label: t("copyAll"),
                copiedLabel: t("copied")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
              "button",
              {
                type: "button",
                className: cards_default.lineAction,
                onClick: () => {
                  downloadSection(section);
                },
                children: `${t("downloadAll")} ${extensionOf(section.format)}`
              }
            )
          ] })
        ] }),
        section.documents.map((document2) => /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ExportDocumentRow, { doc: document2, t }, document2.ref)),
        section.unresolvedItems.map((group) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: cards_default.unresolvedItems, children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: cards_default.unresolvedItemsText, children: t("unresolvedItemsNote", { count: group.count }) }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
            "button",
            {
              type: "button",
              className: cards_default.lineAction,
              onClick: () => {
                downloadArtifact(group.artifact);
              },
              children: `${t("downloadFull")} ${formatLabelOf(group.artifact.format, t)}`
            }
          )
        ] }, group.artifact.callId)),
        section.unresolved.map((artifact) => /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ExportCard, { artifact, t }, artifact.callId))
      ]
    },
    section.format
  )) });
}

// src/client/components/workspace/SourceExports.tsx
var import_jsx_runtime18 = require("react/jsx-runtime");
function SourceExports({ item, t }) {
  if (item.exports.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: workspace_default.panel, children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: workspace_default.note, children: t("exportsEmptyNote") }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: workspace_default.panel, children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ExportSections, { exports: item.exports, t }) });
}

// src/client/components/workspace/SourceInspector.tsx
var import_jsx_runtime19 = require("react/jsx-runtime");
function panelEntriesOf(item) {
  return [
    { id: "overview", key: "panelOverview", count: void 0 },
    { id: "evidence", key: "panelEvidence", count: item.evidence.length },
    { id: "exports", key: "panelExports", count: item.exports.length }
  ];
}
function SourceInspector({
  workspace,
  selectedKey,
  selectionHidden,
  setMobilePane,
  setDraft,
  t
}) {
  const [panel, setPanel] = (0, import_react11.useState)("overview");
  const selected = (0, import_react11.useMemo)(
    () => workspace.sources.find((item) => item.key === selectedKey),
    [workspace.sources, selectedKey]
  );
  (0, import_react11.useEffect)(() => {
    setPanel("overview");
  }, [selectedKey]);
  if (selected === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("main", { className: workspace_default.inspector, children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.emptyNote, children: t("inspectorEmptyNote") }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("main", { className: workspace_default.inspector, children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: workspace_default.inspectorHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
        "button",
        {
          type: "button",
          className: workspace_default.backAction,
          onClick: () => {
            setMobilePane("list");
          },
          children: t("backToList")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: workspace_default.inspectorTitleWrap, children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: workspace_default.inspectorTitle, children: selected.title ?? selected.ref }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: workspace_default.inspectorMeta, children: [selected.creators, selected.year, selected.venue].filter(Boolean).join(" \xB7 ") })
      ] })
    ] }),
    selectionHidden && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.warning, children: t("selectionHiddenNote") }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      "div",
      {
        className: workspace_default.inspectorTabs,
        role: "tablist",
        "aria-label": t("inspectorTabsLabel"),
        onKeyDown: (event) => {
          const entries = panelEntriesOf(selected);
          const at = entries.findIndex((entry) => entry.id === panel);
          const move = (next) => {
            const entry = entries[(next + entries.length) % entries.length];
            if (entry !== void 0) setPanel(entry.id);
          };
          switch (event.key) {
            case "ArrowRight":
              event.preventDefault();
              move(at + 1);
              break;
            case "ArrowLeft":
              event.preventDefault();
              move(at - 1);
              break;
            case "Home":
              event.preventDefault();
              move(0);
              break;
            case "End":
              event.preventDefault();
              move(entries.length - 1);
              break;
            default:
              break;
          }
        },
        children: panelEntriesOf(selected).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": panel === entry.id,
            tabIndex: panel === entry.id ? 0 : -1,
            className: clsx_default(workspace_default.detailTab, panel === entry.id && workspace_default.detailTabActive),
            "data-inspector-panel": entry.id,
            onClick: () => {
              setPanel(entry.id);
            },
            children: [
              t(entry.key),
              entry.count !== void 0 && entry.count > 0 && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: workspace_default.detailTabCount, children: entry.count })
            ]
          },
          entry.id
        ))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: workspace_default.inspectorBody, children: panel === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(SourceOverview, { item: selected, t, setDraft }) : panel === "evidence" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(SourceEvidence, { item: selected, t }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(SourceExports, { item: selected, t }) })
  ] });
}

// src/client/components/workspace/WorkspaceEmptyState.tsx
var import_dsh_client_ui_primitives14 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime20 = require("react/jsx-runtime");
function WorkspaceEmptyState({ t, setDraft }) {
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: workspace_default.empty, children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives14.IconBrowseOutlineMedium, { size: 16, className: workspace_default.emptyIcon }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: workspace_default.emptyText, children: t("noSources") }),
    setDraft !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: workspace_default.starterRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
        import_dsh_client_ui_primitives14.Pill,
        {
          onClick: () => {
            setDraft(t("starterFindTemplate"));
          },
          children: t("starterFind")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
        import_dsh_client_ui_primitives14.Pill,
        {
          onClick: () => {
            setDraft(t("starterCompareTemplate"));
          },
          children: t("starterCompare")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
        import_dsh_client_ui_primitives14.Pill,
        {
          onClick: () => {
            setDraft(t("starterEvidenceTemplate"));
          },
          children: t("starterEvidence")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
        import_dsh_client_ui_primitives14.Pill,
        {
          onClick: () => {
            setDraft(t("starterExportSelectedTemplate"));
          },
          children: t("starterExportSelected")
        }
      )
    ] })
  ] });
}

// src/client/components/operations.ts
function operationsLabelsOf(operations, t) {
  const labels = [];
  if (operations.running > 0) labels.push(t("runningBadge", { count: operations.running }));
  if (operations.failed > 0) labels.push(t("failedBadge", { count: operations.failed }));
  if (operations.stopped > 0) labels.push(t("stoppedBadge", { count: operations.stopped }));
  return labels;
}
function incompleteExportsNoteOf(operations, t) {
  return joinNonEmpty(...operationsLabelsOf(operations, t));
}

// src/client/components/workspace/ExportsPage.tsx
var import_jsx_runtime21 = require("react/jsx-runtime");
function ExportsPage({ workspace, t }) {
  const incomplete = incompleteExportsNoteOf(workspace.exportOperations, t);
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: workspace_default.exportsPage, children: [
    workspace.exports.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: workspace_default.note, children: t("exportsEmptyNote") }),
    incomplete !== "" && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: workspace_default.note, children: t("exportsIncompleteNote", { counts: incomplete }) }),
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ExportSections, { exports: workspace.exports, t })
  ] });
}

// src/client/components/open/ZoteroOpenLink.tsx
var import_dsh_client_ui_primitives15 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime22 = require("react/jsx-runtime");
function ZoteroOpenLink({ url, verdict, label, t, className }) {
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: open_default.linkWrap, children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(
      "a",
      {
        className: className ?? open_default.link,
        href: url,
        ...externalHrefProps(url),
        onClick: (e) => e.stopPropagation(),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives15.IconLinkOutlineMedium, { className: open_default.linkIcon }),
          label
        ]
      }
    ),
    verdict === "unverified" && /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: open_default.note, children: t("openUnverifiedNote", { detail: t("instanceUnverified") }) })
  ] });
}

// src/client/components/EvidenceCard.tsx
var import_jsx_runtime23 = require("react/jsx-runtime");
function PassageRow2({
  passage,
  pdfRef,
  verdict,
  t
}) {
  const annotationKey = passage.source === "annotation" ? shortKeyOf(passage.sourceRef) : null;
  const annotationUrl = annotationKey !== null && pdfRef !== null ? pdfUrlOf(passage.attachmentRef ?? pdfRef, { annotation: annotationKey }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("li", { className: cards_default.passage, "data-source": passage.source, children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("p", { className: cards_default.passageHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: cards_default.sourceTag, children: t(sourceLabelKeyOf(passage.source)) }),
      passage.pageLabel !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: cards_default.note, children: t("pageLabel", { label: passage.pageLabel }) }),
      annotationUrl !== null && verdict !== "blocked" && /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
        ZoteroOpenLink,
        {
          url: annotationUrl,
          verdict,
          label: t("openAnnotation"),
          t,
          className: cards_default.link
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("p", { className: cards_default.line, children: [
      passage.text,
      passage.previewTruncated ? ` ${t("truncatedPreview")}` : ""
    ] }),
    passage.callIds.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: cards_default.note, children: t("retrievedMultiple", { count: passage.callIds.length }) })
  ] });
}
function pdfRefOf(capability) {
  return capability !== null && capability.kind === "file" ? capability.ref : null;
}
function EvidenceCard({ item, t }) {
  const verdict = openVerdictOf(item);
  const selectUrl = selectUrlOf(item.ref);
  const pdfCapability = pdfCapabilityOf(item);
  const pdfRef = pdfRefOf(pdfCapability);
  const coverageLine = item.retrievalFacts?.coverage === void 0 ? "" : coverageLineOf(item.retrievalFacts.coverage, t);
  const availabilityEntries = item.retrievalFacts === void 0 ? [] : Object.entries(item.retrievalFacts.sourceAvailability);
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: cards_default.card, "data-provenance": item.provenance, children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("header", { className: cards_default.cardHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: cards_default.cardTitle, children: item.title ?? item.ref }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: cards_default.note, children: joinNonEmpty(item.creators, item.year) }),
      selectUrl !== null && (verdict === "blocked" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(BlockedOpenAction, { label: t("openInZotero"), t }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ZoteroOpenLink, { url: selectUrl, verdict, label: t("openInZotero"), t })),
      pdfCapability !== null && (verdict === "blocked" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(BlockedOpenAction, { label: t("openPdf"), t }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ZoteroOpenLink, { url: pdfCapability.url, verdict, label: t("openPdf"), t })),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(CopyButton, { value: item.ref, label: t("copyRef"), copiedLabel: t("copied") })
    ] }),
    coverageLine !== "" && /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: cards_default.note, children: coverageLine }),
    item.retrievalFacts?.truncated === true && /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: cards_default.note, children: t("budgetLimitedNote") }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("ul", { className: cards_default.passages, children: item.evidence.map((passage, index) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
      PassageRow2,
      {
        passage,
        pdfRef,
        verdict,
        t
      },
      `${passage.sourceRef}-${index}`
    )) }),
    availabilityEntries.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("ul", { className: cards_default.availability, children: availabilityEntries.map(([source, entry]) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("li", { className: cards_default.note, children: t("availabilityEntry", {
      source: t(sourceLabelKeyOf(source)),
      detail: availabilityLineOf(entry, t)
    }) }, source)) }),
    item.retrievalFacts !== void 0 && item.evidence.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: cards_default.note, children: emptyEvidenceNoteOf(item.facts.reportedEvidenceCount, t) })
  ] });
}

// src/client/components/workspace/EvidenceOverview.tsx
var import_jsx_runtime24 = require("react/jsx-runtime");
function EvidenceOverview({ workspace, onBack, t }) {
  const sources = filterSources(workspace.sources, "evidence");
  return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: workspace_default.evidencePage, children: [
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("button", { type: "button", className: workspace_default.backAction, onClick: onBack, children: t("backToSources") }),
    sources.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: workspace_default.emptyNote, children: t("evidenceEmptyNote") }) : /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(import_jsx_runtime24.Fragment, { children: sources.map((item) => /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(EvidenceCard, { item, t }, item.key)) })
  ] });
}

// src/client/components/workspace/ZoteroWorkspaceView.tsx
var import_jsx_runtime25 = require("react/jsx-runtime");
var LENSES = [
  { id: "sources", key: "lensSources" },
  { id: "exports", key: "lensExports" }
];
var FILTERS = [
  { id: "all", key: "filterAll" },
  { id: "pdf", key: "filterPdf" },
  { id: "retrieved", key: "filterRetrieved" },
  { id: "evidence", key: "filterEvidence" },
  { id: "exported", key: "filterExported" },
  { id: "issues", key: "filterIssues" }
];
function effectiveSelectionOf(selection, workspace, visible) {
  if (selection.key !== void 0 && workspace.some((item) => item.key === selection.key)) {
    return selection.key;
  }
  return visible[0]?.key;
}
function ZoteroWorkspaceView({
  workspace,
  connection,
  sessionId,
  setDraft,
  onRefresh,
  t
}) {
  const [lens, setLens] = (0, import_react12.useState)("sources");
  const [filter, setFilter] = (0, import_react12.useState)("all");
  const [selection, setSelection] = (0, import_react12.useState)({ key: void 0, focusIndex: 0 });
  const [mobilePane, setMobilePane] = (0, import_react12.useState)("list");
  const [evidenceOpen, setEvidenceOpen] = (0, import_react12.useState)(false);
  const counts = (0, import_react12.useMemo)(() => filterCountsOf(workspace.sources), [workspace.sources]);
  const visible = (0, import_react12.useMemo)(
    () => filterSources(workspace.sources, filter),
    [workspace.sources, filter]
  );
  const selectedKey = (0, import_react12.useMemo)(
    () => effectiveSelectionOf(selection, workspace.sources, visible),
    [selection, workspace.sources, visible]
  );
  const exportedCount = (0, import_react12.useMemo)(() => exportedRefCountOf(workspace.exports), [workspace.exports]);
  void sessionId;
  if (evidenceOpen) {
    return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: workspace_default.view, "data-conversation-composer-overlay": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(WorkspaceToolbar, { connection, onRefresh, t }),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        EvidenceOverview,
        {
          workspace,
          onBack: () => {
            setEvidenceOpen(false);
          },
          t
        }
      )
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
    "div",
    {
      className: workspace_default.view,
      "data-conversation-composer-overlay": true,
      onKeyDown: (event) => {
        if (event.key === "Escape" && mobilePane === "detail") {
          setMobilePane("list");
        }
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(WorkspaceToolbar, { connection, onRefresh, t }),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
          "div",
          {
            className: workspace_default.lensBar,
            role: "tablist",
            "aria-label": t("lensBarLabel"),
            onKeyDown: (event) => {
              const at = LENSES.findIndex((entry) => entry.id === lens);
              const move = (next) => {
                const entry = LENSES[(next + LENSES.length) % LENSES.length];
                if (entry !== void 0) setLens(entry.id);
              };
              switch (event.key) {
                case "ArrowRight":
                  event.preventDefault();
                  move(at + 1);
                  break;
                case "ArrowLeft":
                  event.preventDefault();
                  move(at - 1);
                  break;
                case "Home":
                  event.preventDefault();
                  move(0);
                  break;
                case "End":
                  event.preventDefault();
                  move(LENSES.length - 1);
                  break;
                default:
                  break;
              }
            },
            children: LENSES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
              "button",
              {
                type: "button",
                role: "tab",
                "aria-selected": lens === entry.id,
                tabIndex: lens === entry.id ? 0 : -1,
                className: clsx_default(workspace_default.lensTab, lens === entry.id && workspace_default.lensTabActive),
                "data-workspace-lens": entry.id,
                onClick: () => {
                  setLens(entry.id);
                },
                children: [
                  t(entry.key),
                  entry.id === "exports" && exportedCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("span", { className: workspace_default.lensTabCount, children: exportedCount })
                ]
              },
              entry.id
            ))
          }
        ),
        lens === "exports" ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(ExportsPage, { workspace, t }) : workspace.sources.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(WorkspaceEmptyState, { setDraft, t }) : /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: workspace_default.workspace, "data-pane": mobilePane, children: [
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
            SourceSidebar,
            {
              workspace,
              filter,
              counts,
              visible,
              selection,
              selectedKey,
              setFilter,
              setSelection,
              setMobilePane,
              onOpenEvidence: () => {
                setEvidenceOpen(true);
              },
              t
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
            SourceInspector,
            {
              workspace,
              selectedKey,
              selectionHidden: selectedKey !== void 0 && !visible.some((item) => item.key === selectedKey),
              setMobilePane,
              setDraft,
              t
            }
          )
        ] })
      ]
    }
  );
}

// src/client/components/SourcesTab.tsx
var import_jsx_runtime26 = require("react/jsx-runtime");
var MAX_SUBCALL_DEPTH = 256;
function visibleToolRoots(snapshot) {
  if (snapshot === void 0) return [];
  const out = [];
  for (const key of snapshot.order) {
    const node = snapshot.nodes.get(key);
    if (node?.kind !== "tool-call" || node.visibility !== "visible") continue;
    out.push({ key, root: node.data.root });
  }
  return out;
}
function isZoteroRoot(root) {
  const name = callNameOf(root);
  return name !== null && name.startsWith("zotero_");
}
function visitVisibleZoteroCalls(snapshot, visit) {
  if (snapshot === void 0) return;
  const seen = /* @__PURE__ */ new Set();
  const visitBlock = (block, path, depth) => {
    if (depth > MAX_SUBCALL_DEPTH) return;
    if (isZoteroRoot(block) && !seen.has(block.callId)) {
      seen.add(block.callId);
      visit(block, path);
    }
    for (const child of block.subCalls) {
      visitBlock(child, [...path, child.callId], depth + 1);
    }
  };
  for (const { key, root } of visibleToolRoots(snapshot)) visitBlock(root, [key], 1);
}
function currentTime() {
  const now = /* @__PURE__ */ new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
function sessionSignatureOf(snapshot) {
  if (snapshot === void 0) return "";
  const running = [];
  const order = [];
  visitVisibleZoteroCalls(snapshot, (block, path) => {
    order.push({ callId: block.callId, path });
    if (!isSettledTool(block)) running.push({ callId: block.callId, phase: block.phase });
  });
  return JSON.stringify({ order, running });
}
function stateOf(result, checkedAt) {
  if (!result.ok) return { kind: "remote-error", message: result.error.message };
  if (result.value.connected) {
    return { kind: "connected", data: result.value, checkedAt };
  }
  return { kind: "unavailable", data: result.value, checkedAt };
}
function collectZoteroCalls(snapshot) {
  const out = [];
  visitVisibleZoteroCalls(snapshot, (block) => {
    out.push(block);
  });
  return out;
}
function useZoteroBlocks(chat, sessionId) {
  const signature = (0, import_react13.useMemo)(
    () => `${sessionId ?? ""}:${sessionSignatureOf(chat)}`,
    [chat, sessionId]
  );
  return (0, import_react13.useMemo)(() => collectZoteroCalls(chat), [signature]);
}
function SourcesTab({ status, t, useSession, useChat, inputActions }) {
  const sessionId = useSession((snapshot) => snapshot.sessionId);
  const chat = useChat((snapshot) => snapshot);
  const [statusState, setStatusState] = (0, import_react13.useState)({ kind: "loading" });
  const [requestId, setRequestId] = (0, import_react13.useState)(0);
  const [serverId, setServerId] = (0, import_react13.useState)(void 0);
  const blocks = useZoteroBlocks(chat, sessionId);
  const workspace = (0, import_react13.useMemo)(
    () => buildSourceWorkspace(blocks, { currentServerId: serverId }),
    [blocks, serverId]
  );
  const setDraft = (0, import_react13.useMemo)(
    () => inputActions === void 0 ? void 0 : inputActions.setDraft.bind(inputActions),
    [inputActions]
  );
  (0, import_react13.useEffect)(() => {
    if (status === void 0) return;
    const controller = new AbortController();
    setStatusState({ kind: "loading" });
    void (async () => {
      let result;
      try {
        result = await status();
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatusState({
          kind: "remote-error",
          message: error instanceof Error ? error.message : String(error)
        });
        setServerId(void 0);
        return;
      }
      if (controller.signal.aborted) return;
      const next = stateOf(result, currentTime());
      setStatusState(next);
      if (next.kind === "connected" && next.data.serverId !== void 0) {
        setServerId(next.data.serverId);
      } else {
        setServerId(void 0);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [status, requestId]);
  const refresh = () => {
    setRequestId((id) => id + 1);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
    ZoteroWorkspaceView,
    {
      workspace,
      connection: statusState,
      sessionId: sessionId ?? "none",
      setDraft,
      onRefresh: refresh,
      t
    },
    sessionId ?? "none"
  );
}

// src/client/status-codec.ts
var HOST_OWNED_CODEC_MESSAGE = "dsh-zotero: ZoteroStatusView strict codec is host-owned; the client Remote face never materializes boundary schemas";
var ZOTERO_STATUS_CLIENT_RESULT_CODEC = Object.freeze({
  mode: "strict",
  typeSymbol: ZOTERO_STATUS_TYPE_SYMBOL,
  create: () => {
    throw new Error(HOST_OWNED_CODEC_MESSAGE);
  }
});
var ZOTERO_CLIENT_INVOCATIONS = Object.freeze([
  zoteroStatusInvocation(ZOTERO_STATUS_CLIENT_RESULT_CODEC)
]);

// src/client/remote.ts
var ZOTERO_REMOTE = {
  package: ZOTERO_REMOTE_PACKAGE,
  descriptors: ZOTERO_CLIENT_INVOCATIONS
};

// src/client/components/plugin/faces.ts
function zoteroQuickConfigFace(form, t) {
  return {
    t,
    hooks: { zoteroQuickConfig: form },
    setField: (field2, value) => {
      void form.set(field2, value);
    }
  };
}

// src/client/components/plugin/ZoteroActivationGuide.tsx
var import_dsh_client_ui_primitives16 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/plugin/plugin-cards.module.css
var style10 = `.fUMSYG_quickConfig{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);flex-direction:column;gap:12px;padding:14px 16px;display:flex}.fUMSYG_quickConfigHead{flex-direction:column;gap:2px;display:flex}.fUMSYG_quickConfigTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600;line-height:18px}.fUMSYG_quickConfigDesc{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:16px}.fUMSYG_quickConfigList{flex-direction:column;gap:10px;display:flex}.fUMSYG_toggleRow{justify-content:space-between;align-items:center;gap:16px;padding:8px 0;display:flex}.fUMSYG_toggleRow+.fUMSYG_toggleRow{border-top:.5px solid var(--dsw-alias-border-l2)}.fUMSYG_toggleInfo{flex-direction:column;gap:2px;min-width:0;display:flex}.fUMSYG_toggleLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px}.fUMSYG_toggleHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}.fUMSYG_section{flex-direction:column;gap:10px;display:flex}.fUMSYG_sectionHead{justify-content:space-between;align-items:center;display:flex}.fUMSYG_sectionTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:20px}.fUMSYG_sectionGrid{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;display:grid}.fUMSYG_card{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);flex-direction:column;gap:8px;padding:12px 14px;display:flex}.fUMSYG_cardHead{justify-content:space-between;align-items:center;gap:8px;display:flex}.fUMSYG_cardTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600;line-height:18px}.fUMSYG_refreshButton{color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;padding:2px 6px;font-size:11px}.fUMSYG_refreshButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}.fUMSYG_statusRow{align-items:center;gap:8px;font-size:12px;font-weight:500;line-height:18px;display:flex}.fUMSYG_statusRow[data-state=connected]{color:var(--dsw-alias-state-success-secondary)}.fUMSYG_statusRow[data-state=disconnected]{color:var(--dsw-alias-state-warn-label)}.fUMSYG_statusDetail{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}.fUMSYG_tipList{flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;display:flex}.fUMSYG_tipItem{color:var(--dsw-alias-label-secondary);align-items:baseline;gap:6px;font-size:12px;line-height:16px;display:flex}.fUMSYG_tipBullet{color:var(--dsw-alias-label-caption);flex:none;font-size:12px}.fUMSYG_activationModal{width:min(520px,100%)}.fUMSYG_activationContent{color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;font-size:13px;line-height:18px;display:flex}.fUMSYG_activationSteps{flex-direction:column;gap:10px;margin:0;padding:0;list-style:none;display:flex}.fUMSYG_activationStep{align-items:flex-start;gap:10px;display:flex}.fUMSYG_activationStepIndex{corner-shape:round;background:var(--dsw-alias-bg-layer-3);width:20px;height:20px;color:var(--dsw-alias-label-primary);border-radius:50%;flex:none;justify-content:center;align-items:center;font-size:11px;font-weight:600;line-height:1;display:flex}.fUMSYG_activationStepBody{flex-direction:column;gap:2px;min-width:0;display:flex}.fUMSYG_activationStepText{color:var(--dsw-alias-label-primary);font-weight:500}.fUMSYG_activationStepNote{color:var(--dsw-alias-state-warn-label);margin:0;font-size:12px;line-height:16px}.fUMSYG_activationFooter{justify-content:space-between;align-items:center;gap:12px;width:100%;display:flex}.fUMSYG_activationFooterActions{align-items:center;gap:8px;display:flex}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/plugin/plugin-cards.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/plugin/plugin-cards.module.css");
  tag.textContent = style10;
  document.head.appendChild(tag);
}
var plugin_cards_default = { "activationSteps": "fUMSYG_activationSteps", "toggleHint": "fUMSYG_toggleHint", "quickConfig": "fUMSYG_quickConfig", "activationFooterActions": "fUMSYG_activationFooterActions", "cardTitle": "fUMSYG_cardTitle", "statusRow": "fUMSYG_statusRow", "cardHead": "fUMSYG_cardHead", "statusDetail": "fUMSYG_statusDetail", "quickConfigHead": "fUMSYG_quickConfigHead", "sectionHead": "fUMSYG_sectionHead", "quickConfigTitle": "fUMSYG_quickConfigTitle", "refreshButton": "fUMSYG_refreshButton", "quickConfigDesc": "fUMSYG_quickConfigDesc", "activationStepBody": "fUMSYG_activationStepBody", "tipBullet": "fUMSYG_tipBullet", "sectionGrid": "fUMSYG_sectionGrid", "activationStepNote": "fUMSYG_activationStepNote", "activationContent": "fUMSYG_activationContent", "activationFooter": "fUMSYG_activationFooter", "toggleInfo": "fUMSYG_toggleInfo", "section": "fUMSYG_section", "tipList": "fUMSYG_tipList", "activationStepIndex": "fUMSYG_activationStepIndex", "card": "fUMSYG_card", "activationModal": "fUMSYG_activationModal", "sectionTitle": "fUMSYG_sectionTitle", "tipItem": "fUMSYG_tipItem", "toggleRow": "fUMSYG_toggleRow", "toggleLabel": "fUMSYG_toggleLabel", "activationStepText": "fUMSYG_activationStepText", "quickConfigList": "fUMSYG_quickConfigList", "activationStep": "fUMSYG_activationStep" };

// src/client/components/plugin/ZoteroActivationGuide.tsx
var import_jsx_runtime27 = require("react/jsx-runtime");
function ZoteroActivationGuide({
  packageName,
  onDismiss,
  onOpenDetails,
  t,
  probe
}) {
  if (packageName !== ZOTERO_REMOTE_PACKAGE || !t || !probe) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
    ZoteroActivationGuideBody,
    {
      onDismiss,
      onOpenDetails,
      t,
      probe
    }
  );
}
function ZoteroActivationGuideBody({
  onDismiss,
  onOpenDetails,
  t,
  probe
}) {
  const { state, runProbe } = useZoteroProbe(probe, { initialAutoRun: true });
  const connected = state.data?.connected === true;
  const version = state.data?.zoteroVersion;
  const diagnosis = state.error;
  const statusState = state.loading ? "ongoing" : connected ? "done" : "error";
  const statusText = state.loading ? t("checking") : connected ? version ? t("activationReadyVersion", { version }) : t("activationReady") : t("statusUnavailable");
  return /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
    import_dsh_client_ui_primitives16.Modal,
    {
      open: true,
      className: plugin_cards_default.activationModal,
      title: t("activationTitle"),
      description: t("activationDescription"),
      closeLabel: t("activationClose"),
      onClose: onDismiss,
      footer: /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: plugin_cards_default.activationFooter, children: [
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
          import_dsh_client_ui_primitives16.Button,
          {
            variant: "outline",
            size: "sm",
            disabled: state.loading,
            onClick: () => {
              void runProbe();
            },
            children: t("activationCheckAgain")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: plugin_cards_default.activationFooterActions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(import_dsh_client_ui_primitives16.Button, { variant: "ghost", size: "sm", onClick: onDismiss, children: connected ? t("activationDone") : t("activationLater") }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(import_dsh_client_ui_primitives16.Button, { variant: "primary", size: "sm", onClick: onOpenDetails, "data-modal-autofocus": true, children: t("activationDetails") })
        ] })
      ] }),
      children: /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: plugin_cards_default.activationContent, "data-zotero-activation-guide": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("ol", { className: plugin_cards_default.activationSteps, children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("li", { className: plugin_cards_default.activationStep, children: [
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: plugin_cards_default.activationStepIndex, children: "1" }),
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", { className: plugin_cards_default.activationStepBody, children: /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: plugin_cards_default.activationStepText, children: t("activationStep1") }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("li", { className: plugin_cards_default.activationStep, children: [
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: plugin_cards_default.activationStepIndex, children: "2" }),
            /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: plugin_cards_default.activationStepBody, children: [
              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: plugin_cards_default.activationStepText, children: t("activationStep2") }),
              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("p", { className: plugin_cards_default.activationStepNote, children: t("activationStep2Note") })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: plugin_cards_default.card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", { className: plugin_cards_default.cardHead, children: /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: plugin_cards_default.cardTitle, children: t("activationStatusLabel") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { className: plugin_cards_default.statusRow, "data-state": connected ? "connected" : "disconnected", children: [
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(import_dsh_client_ui_primitives16.StateDot, { state: statusState }),
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { children: statusText })
          ] }),
          diagnosis !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(DiagnosisBox, { diagnosis, t }) : null
        ] })
      ] })
    }
  );
}

// src/client/components/plugin/ZoteroBundleQuickConfig.tsx
var import_dsh_client_ui_primitives17 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime28 = require("react/jsx-runtime");
function ZoteroBundleQuickConfig({
  view,
  t,
  useZoteroQuickConfig,
  setField
}) {
  if (view !== "page") return null;
  if (!useZoteroQuickConfig || !setField || !t) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
    ZoteroBundleQuickConfigBody,
    {
      t,
      useZoteroQuickConfig,
      setField
    }
  );
}
function ZoteroBundleQuickConfigBody({
  t,
  useZoteroQuickConfig,
  setField
}) {
  const gate = useRiskGate();
  const snapshot = useZoteroQuickConfig((s) => s);
  const ready = snapshot.status === "ready";
  const webEnabled = snapshot.value?.webEnabled !== false;
  const writeEnabled = snapshot.value?.writeEnabled === true;
  const onToggleWrite = (next) => {
    if (next && !writeEnabled) {
      gate.request();
      return;
    }
    setField("writeEnabled", next);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: plugin_cards_default.quickConfig, "data-zotero-quick-config": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: plugin_cards_default.quickConfigHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("h4", { className: plugin_cards_default.quickConfigTitle, children: t("quickConfigTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("p", { className: plugin_cards_default.quickConfigDesc, children: t("quickConfigHint") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: plugin_cards_default.quickConfigList, children: [
      /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: plugin_cards_default.toggleRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: plugin_cards_default.toggleInfo, children: [
          /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: plugin_cards_default.toggleLabel, children: t("webEnabled") }),
          /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: plugin_cards_default.toggleHint, children: t("webEnabledHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
          import_dsh_client_ui_primitives17.Switch,
          {
            checked: webEnabled,
            disabled: !ready,
            label: t("webEnabled"),
            onChange: (next) => {
              setField("webEnabled", next);
            }
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: plugin_cards_default.toggleRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: plugin_cards_default.toggleInfo, children: [
          /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: plugin_cards_default.toggleLabel, children: t("writeEnabled") }),
          /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("span", { className: plugin_cards_default.toggleHint, children: t("writeEnabledHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
          import_dsh_client_ui_primitives17.Switch,
          {
            checked: writeEnabled,
            disabled: !ready,
            label: t("writeEnabled"),
            onChange: onToggleWrite
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
      import_dsh_client_ui_primitives17.RiskConfirmation,
      {
        open: gate.confirming,
        ...writeRiskCopy(t),
        acknowledged: gate.acknowledged,
        disabled: !ready,
        onAcknowledgedChange: gate.setAcknowledged,
        onCancel: gate.cancel,
        onConfirm: () => {
          gate.confirm(() => {
            setField("writeEnabled", true);
          });
        }
      }
    )
  ] });
}

// src/client/components/plugin/ZoteroPluginDetailSection.tsx
var import_jsx_runtime29 = require("react/jsx-runtime");
function ZoteroPluginDetailSection({
  subject,
  t,
  probe
}) {
  if (subject.kind !== "bundle" || subject.pkg.name !== "dsh-zotero") {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(ZoteroPluginDetailSectionBody, { t, probe });
}
function ZoteroPluginDetailSectionBody({ t, probe }) {
  const { state, runProbe } = useZoteroProbe(probe, {
    initialAutoRun: true
  });
  const connected = state.data?.connected ?? false;
  const version = state.data?.zoteroVersion;
  const diagnosis = state.error ?? state.data?.diagnosis;
  const tips = ["tipNoKey", "tipFulltext", "tipSettingsNav"];
  return /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("section", { className: plugin_cards_default.section, "data-zotero-plugin-section": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("div", { className: plugin_cards_default.sectionHead, children: /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("h4", { className: plugin_cards_default.sectionTitle, children: t("detailSectionTitle") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("div", { className: plugin_cards_default.sectionGrid, children: [
      /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("div", { className: plugin_cards_default.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("div", { className: plugin_cards_default.cardHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("span", { className: plugin_cards_default.cardTitle, children: t("detailsLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(
            "button",
            {
              type: "button",
              className: plugin_cards_default.refreshButton,
              disabled: state.loading,
              onClick: () => {
                void runProbe();
              },
              children: state.loading ? t("checking") : t("refresh")
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("div", { className: plugin_cards_default.statusRow, "data-state": connected ? "connected" : "disconnected", children: /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("span", { children: state.loading ? `\u25CF ${t("checking")}` : connected ? `\u25CF ${t("statusConnectedNote")}` : `\u25CB ${t("statusUnavailable")}` }) }),
        version ? /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("p", { className: plugin_cards_default.statusDetail, children: [
          t("zoteroVersionLabel"),
          ": ",
          version
        ] }) : null,
        diagnosis ? /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(DiagnosisBox, { diagnosis, t }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("div", { className: plugin_cards_default.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("div", { className: plugin_cards_default.cardHead, children: /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("span", { className: plugin_cards_default.cardTitle, children: t("tipsLabel") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("ul", { className: plugin_cards_default.tipList, children: tips.map((key) => /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("li", { className: plugin_cards_default.tipItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("span", { className: plugin_cards_default.tipBullet, children: "\u{1F4A1}" }),
          /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("span", { children: t(key) })
        ] }, key)) })
      ] })
    ] })
  ] });
}

// src/client/toolviews/SearchToolView.tsx
var import_react15 = require("react");
var import_dsh_client_ui_primitives19 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/toolviews/ZoteroToolRow.tsx
var import_react14 = require("react");
var import_dsh_client_ui_primitives18 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/toolviews/toolviews.module.css
var style11 = `.OO2ABG_bodyWrap{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:8px;padding:8px 12px 12px 28px;font-size:13px;line-height:1.5;display:flex}.OO2ABG_summarySep{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-label-caption);flex:none;width:2px;height:2px;margin:0 8px}.OO2ABG_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);flex:auto;transition:color .1s;overflow:hidden}.OO2ABG_summary>span,.OO2ABG_summary [data-text-shimmer]{text-overflow:ellipsis;white-space:nowrap;font-weight:400;display:inline;overflow:hidden}.OO2ABG_summarySuffix{white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);flex:none;margin-left:6px;transition:color .1s}div[data-tool]:hover .OO2ABG_summary:not(.OO2ABG_errorSummary):not(.OO2ABG_cautionSummary),div[data-tool]:hover .OO2ABG_summarySuffix{color:var(--dsw-alias-label-primary)}.OO2ABG_errorSummary{color:var(--dsw-alias-state-error-primary)}.OO2ABG_cautionSummary{color:var(--dsw-alias-state-warn-label)}.OO2ABG_inspectButton{height:22px;color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);cursor:pointer;box-sizing:border-box;background:0 0;outline:none;align-self:flex-start;align-items:center;gap:4px;padding:0 8px;font-family:inherit;font-size:11px;line-height:14px;transition:all .12s;display:inline-flex}.OO2ABG_inspectButton:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));background:var(--dsw-alias-interactive-bg-hover)}.OO2ABG_lineAction{height:22px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);cursor:pointer;box-sizing:border-box;background:0 0;outline:none;justify-content:center;align-items:center;gap:4px;padding:0 8px;font-family:inherit;font-size:11px;line-height:14px;transition:background .12s,color .12s,border-color .12s;display:inline-flex}.OO2ABG_lineAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}.OO2ABG_lineAction:focus-visible{outline:1px solid var(--dsw-alias-link);outline-offset:1px}.OO2ABG_actionLink{height:22px;color:var(--dsw-alias-link);cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 4px;font-family:inherit;font-size:11px;font-weight:500;line-height:14px;text-decoration:none;transition:opacity .12s;display:inline-flex}.OO2ABG_actionLink:hover{text-underline-offset:3px;opacity:.85;text-decoration:underline dotted}.OO2ABG_badge{text-transform:uppercase;letter-spacing:.03em;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);height:18px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);user-select:none;align-items:center;gap:4px;padding:0 6px;font-size:10px;font-weight:600;line-height:12px;display:inline-flex}.OO2ABG_badge[data-tone=info]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-link);border-color:#0000}.OO2ABG_badge[data-tone=success]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent)}.OO2ABG_badge[data-tone=warning]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);color:var(--dsw-alias-state-warn-label);border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 20%, transparent)}.OO2ABG_badge[data-tone=danger],.OO2ABG_badge[data-tone=error],.OO2ABG_badge[data-tone=pdf]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 20%, transparent)}.OO2ABG_cardList{flex-direction:column;gap:6px;display:flex}.OO2ABG_itemCard{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:6px;padding:10px 12px;transition:border-color .12s;display:flex}.OO2ABG_itemCard:hover{border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}.OO2ABG_itemHeader{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.OO2ABG_itemTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px}.OO2ABG_itemMeta{color:var(--dsw-alias-label-caption);align-items:center;gap:6px;font-size:12px;line-height:16px;display:flex}.OO2ABG_itemCard[data-depth="1"]{margin-left:10px}.OO2ABG_itemCard[data-depth="2"]{margin-left:20px}.OO2ABG_itemCard[data-depth="3"]{margin-left:30px}.OO2ABG_itemCard[data-depth="4"]{margin-left:40px}.OO2ABG_itemActions{align-items:center;gap:8px;margin-top:2px;display:flex}.OO2ABG_evidenceItem{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:6px;padding:10px 12px;transition:border-color .12s;display:flex}.OO2ABG_evidenceItem:hover{border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}.OO2ABG_evidenceHeader{justify-content:space-between;align-items:center;gap:8px;display:flex}.OO2ABG_evidenceBadges{align-items:center;gap:6px;display:flex}.OO2ABG_evidenceText{color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;padding-top:2px;font-family:inherit;font-size:13px;line-height:1.6}.OO2ABG_codeWrap{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);flex-direction:column;display:flex;overflow:hidden}.OO2ABG_codeHeader{background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;min-height:28px;padding:6px 10px;display:flex}.OO2ABG_codeBox{font-family:var(--ds-font-family-code,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);color:var(--dsw-alias-label-secondary);white-space:pre;max-height:360px;margin:0;padding:10px 12px;font-size:12px;line-height:1.5;overflow-x:auto}.OO2ABG_receiptCard{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:6px;padding:10px 12px;display:flex}.OO2ABG_receiptCard[data-state=declined],.OO2ABG_receiptCard[data-state=unverified]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 5%, transparent)}.OO2ABG_receiptTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px}.OO2ABG_notesSection{border-top:1px dashed var(--dsw-alias-border-l2);flex-direction:column;gap:4px;margin-top:4px;padding-top:6px;display:flex}.OO2ABG_sectionTitle{text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-caption);font-size:11px;font-weight:600}.OO2ABG_annotationSwatch{border-radius:var(--dsw-radius-xs);background:var(--zotero-annotation,transparent);width:10px;height:10px;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);flex:none}.OO2ABG_tagPills{flex-wrap:wrap;gap:4px;display:flex}.OO2ABG_coverageNotice{color:var(--dsw-alias-label-caption);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:6px;padding:4px 8px;font-size:12px;line-height:18px;display:flex}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/toolviews/toolviews.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/toolviews/toolviews.module.css");
  tag.textContent = style11;
  document.head.appendChild(tag);
}
var toolviews_default = { "tagPills": "OO2ABG_tagPills", "codeHeader": "OO2ABG_codeHeader", "annotationSwatch": "OO2ABG_annotationSwatch", "codeWrap": "OO2ABG_codeWrap", "summarySuffix": "OO2ABG_summarySuffix", "itemHeader": "OO2ABG_itemHeader", "badge": "OO2ABG_badge", "itemActions": "OO2ABG_itemActions", "evidenceItem": "OO2ABG_evidenceItem", "bodyWrap": "OO2ABG_bodyWrap", "actionLink": "OO2ABG_actionLink", "evidenceText": "OO2ABG_evidenceText", "errorSummary": "OO2ABG_errorSummary", "itemMeta": "OO2ABG_itemMeta", "evidenceBadges": "OO2ABG_evidenceBadges", "receiptTitle": "OO2ABG_receiptTitle", "cautionSummary": "OO2ABG_cautionSummary", "coverageNotice": "OO2ABG_coverageNotice", "summary": "OO2ABG_summary", "itemCard": "OO2ABG_itemCard", "sectionTitle": "OO2ABG_sectionTitle", "codeBox": "OO2ABG_codeBox", "inspectButton": "OO2ABG_inspectButton", "itemTitle": "OO2ABG_itemTitle", "summarySep": "OO2ABG_summarySep", "receiptCard": "OO2ABG_receiptCard", "notesSection": "OO2ABG_notesSection", "lineAction": "OO2ABG_lineAction", "cardList": "OO2ABG_cardList", "evidenceHeader": "OO2ABG_evidenceHeader" };

// src/client/toolviews/ZoteroToolRow.tsx
var import_jsx_runtime30 = require("react/jsx-runtime");
function RunningNotice({ text }) {
  return /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("div", { className: toolviews_default.coverageNotice, children: text });
}
function RawTextFallback({ text }) {
  return /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("pre", { className: toolviews_default.codeBox, children: text });
}
function ZoteroToolRow({
  useDisclosure,
  t,
  toolName,
  block,
  icon,
  title,
  summary,
  summarySuffix,
  errorSummary,
  inspect,
  children
}) {
  const isPreparing = "phase" in block && block.phase === "preparing";
  const isRunning = "phase" in block && block.phase === "start" || isPreparing;
  const { expanded, toggle: toggleExpand } = useDisclosure();
  const state = isPreparing ? "preparing" : rowStateOf(block);
  const writeKind = writeMetaOf(metaOf(block) ?? {}).kind;
  const isDeclined = writeKind === "declined";
  const isUnverified = !isDeclined && state === "ok" && writeKind === "committed-unverified";
  const failureLine = state === "error" && !isDeclined ? errorSummary ?? t("toolFailed") : null;
  const stoppedLine = state === "stopped" ? t("toolStopped") : null;
  const cautionLine = isUnverified ? t("toolUnverified") : null;
  const displaySummary = isDeclined ? t("toolDeclined") : failureLine ?? stoppedLine ?? cautionLine ?? summary;
  const collapsedContent = (0, import_react14.useMemo)(() => {
    if (!displaySummary && !isPreparing) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)(import_jsx_runtime30.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", { className: toolviews_default.summarySep, "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
        "span",
        {
          className: clsx_default(
            toolviews_default.summary,
            state === "error" && !isDeclined && toolviews_default.errorSummary,
            (state === "stopped" || isDeclined || isUnverified) && toolviews_default.cautionSummary
          ),
          children: /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(import_dsh_client_ui_primitives18.TextShimmer, { active: isRunning, children: displaySummary })
        }
      ),
      summarySuffix && (state === "ok" || isDeclined) && /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", { className: toolviews_default.summarySuffix, children: summarySuffix })
    ] });
  }, [displaySummary, isDeclined, isUnverified, isPreparing, isRunning, state, summarySuffix]);
  const expandable = !isPreparing && (children !== void 0 || failureLine !== null);
  const open = expanded && expandable;
  const renderContext = (0, import_react14.useMemo)(
    () => ({ isRunning, isDeclined, isUnverified, state }),
    [isRunning, isDeclined, isUnverified, state]
  );
  const content = (0, import_react14.useMemo)(() => {
    if (!open) return null;
    return typeof children === "function" ? children(renderContext) : children;
  }, [open, children, renderContext]);
  const expandedBody = open ? /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)("div", { className: toolviews_default.bodyWrap, children: [
    content,
    inspect !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime30.jsxs)(
      "button",
      {
        type: "button",
        className: toolviews_default.inspectButton,
        onClick: (e) => {
          e.stopPropagation();
          inspect();
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(import_dsh_client_ui_primitives18.IconInspectOutlineRegular, { size: 12 }),
          /* @__PURE__ */ (0, import_jsx_runtime30.jsx)("span", { children: t("toolInspect") })
        ]
      }
    )
  ] }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
    "div",
    {
      "data-tool": toolName,
      "data-state": isDeclined ? "declined" : isUnverified ? "unverified" : state,
      children: /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
        import_dsh_client_ui_primitives18.DisclosureRow,
        {
          icon,
          title,
          open,
          expandable,
          running: isRunning,
          expandOnRowClick: true,
          keepContentWhenOpen: true,
          onToggle: toggleExpand,
          collapsedContent,
          children: expandedBody
        }
      )
    }
  );
}

// src/client/toolviews/SearchToolView.tsx
var import_jsx_runtime31 = require("react/jsx-runtime");
function SearchToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const { icon, query, summary, errorSummary, rows, omitted, rawText } = (0, import_react15.useMemo)(() => {
    const args = argsOf(block);
    const q = (stringField(args ?? {}, "query") ?? "").trim();
    const meta = metaOf(block);
    const searchView = meta !== null ? searchMetaOf(meta) : null;
    const noteMatches = meta !== null ? numberField(meta, "noteMatches") ?? 0 : 0;
    const raw = (resultTextOf(block) ?? "").trim();
    let sum = "";
    if ("phase" in block && block.phase === "start") {
      sum = q ? `"${q}"` : t("toolSearchRunning");
    } else if (searchView?.rows !== null && searchView?.rows !== void 0) {
      const count = searchView.returned ?? searchView.rows.length;
      sum = noteMatches > 0 ? t("toolSummaryFoundWithNotes", { count, notes: noteMatches }) : t("toolSummaryFound", { count });
    } else {
      sum = q ? `"${q}"` : t("toolTitleSearch");
    }
    const errSummary = errorSummaryOf(block, raw);
    const items = (searchView?.rows ?? []).map((row) => ({
      ...row,
      selectUrl: selectUrlOf(row.ref),
      pdfUrl: row.bestAttachmentRef ? pdfUrlOf(row.bestAttachmentRef) : null
    }));
    return {
      icon: /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(import_dsh_client_ui_primitives19.IconSearchOutlineRegular, { size: 14 }),
      query: q,
      summary: sum,
      errorSummary: errSummary,
      rows: items,
      omitted: searchView?.omitted ?? 0,
      rawText: raw
    };
  }, [block, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
    ZoteroToolRow,
    {
      toolName,
      block,
      useDisclosure,
      inspect,
      t,
      icon,
      title: t("toolTitleSearch"),
      summary,
      summarySuffix: query ? `"${query}"` : null,
      errorSummary,
      children: ({ isRunning }) => {
        if (isRunning) {
          return /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(RunningNotice, { text: t("toolSearchRunning") });
        }
        if (rows.length > 0) {
          return /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)(import_jsx_runtime31.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: toolviews_default.cardList, children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: toolviews_default.itemCard, children: [
              /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: toolviews_default.itemHeader, children: [
                row.year !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: toolviews_default.badge, children: row.year }),
                row.itemType !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: toolviews_default.badge, "data-tone": "info", children: row.itemType }),
                row.bestAttachmentType && /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: t("badgePdf") }),
                /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: toolviews_default.itemTitle, children: row.title })
              ] }),
              row.creatorSummary && /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: toolviews_default.itemMeta, children: row.creatorSummary }),
              /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: toolviews_default.itemActions, children: [
                row.selectUrl && /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
                  ZoteroOpenLink,
                  {
                    url: row.selectUrl,
                    verdict: "open",
                    label: t("openInZotero"),
                    t,
                    className: toolviews_default.actionLink
                  }
                ),
                row.pdfUrl && /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
                  ZoteroOpenLink,
                  {
                    url: row.pdfUrl,
                    verdict: "open",
                    label: t("openPdf"),
                    t,
                    className: toolviews_default.actionLink
                  }
                )
              ] })
            ] }, row.ref)) }),
            omitted > 0 && /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: toolviews_default.coverageNotice, children: t("omittedRowsNote", { count: omitted }) })
          ] });
        }
        return rawText ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") });
      }
    }
  );
}

// src/client/toolviews/RetrieveToolView.tsx
var import_react16 = require("react");
var import_dsh_client_ui_primitives20 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime32 = require("react/jsx-runtime");
function RetrieveToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const { icon, summary, errorSummary, items, coverageLine, omittedNote, rawText } = (0, import_react16.useMemo)(() => {
    const raw = (resultTextOf(block) ?? "").trim();
    const errSummary = errorSummaryOf(block, raw);
    const meta = metaOf(block);
    const retrieveView = meta !== null ? retrieveMetaOf(meta) : null;
    let sum = "";
    if ("phase" in block && block.phase === "start") {
      sum = t("toolRetrieveRunning");
    } else if (retrieveView?.items !== null && retrieveView?.items !== void 0) {
      sum = t("toolSummaryEvidence", { count: retrieveView.count ?? retrieveView.items.length });
    } else {
      sum = t("toolTitleRetrieve");
    }
    const covLine = retrieveView?.coverage ? coverageLineOf(retrieveView.coverage, t) : null;
    const shown = retrieveView?.items?.length ?? 0;
    const omitted = retrieveView?.count != null && retrieveView.count > shown ? retrieveView.count - shown : 0;
    const omittedNote2 = omitted > 0 ? t("toolOmittedPassages", { count: omitted }) : null;
    const mappedItems = (retrieveView?.items ?? []).map((item) => ({
      ...item,
      selectUrl: selectUrlOf(item.sourceRef),
      pdfUrl: item.attachmentRef ? pdfUrlOf(item.attachmentRef, { page: item.pageLabel }) : null
    }));
    return {
      // The icon rides the memo with the rest of the header, so a re-render
      // that leaves this call's facts alone reuses the same node and the
      // memo'd `DisclosureRow` above it can skip the work.
      icon: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(import_dsh_client_ui_primitives20.IconBrowseOutlineRegular, { size: 14 }),
      summary: sum,
      errorSummary: errSummary,
      items: mappedItems,
      coverageLine: covLine,
      omittedNote: omittedNote2,
      rawText: raw
    };
  }, [block, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
    ZoteroToolRow,
    {
      toolName,
      block,
      useDisclosure,
      inspect,
      t,
      icon,
      title: t("toolTitleRetrieve"),
      summary,
      summarySuffix: null,
      errorSummary,
      children: ({ isRunning }) => {
        if (isRunning) {
          return /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(RunningNotice, { text: t("toolRetrieveRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)(import_jsx_runtime32.Fragment, { children: [
          coverageLine && /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: toolviews_default.coverageNotice, children: coverageLine }),
          omittedNote && /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: toolviews_default.coverageNotice, children: omittedNote }),
          items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: toolviews_default.cardList, children: items.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: toolviews_default.evidenceItem, children: [
            /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: toolviews_default.evidenceHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: toolviews_default.evidenceBadges, children: [
                /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
                  "span",
                  {
                    className: toolviews_default.badge,
                    "data-tone": item.source === "fulltext" ? "pdf" : "info",
                    children: t(sourceLabelKeyOf(item.source))
                  }
                ),
                item.pageLabel && /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: toolviews_default.badge, children: item.pageLabel }),
                item.matchedFields?.map((field2) => /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: toolviews_default.badge, "data-tone": "warning", children: t(field2 === "comment" ? "matchedInComment" : "matchedInText") }, field2))
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: toolviews_default.itemActions, children: [
                /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
                  CopyButton,
                  {
                    value: item.preview,
                    label: t("copy"),
                    copiedLabel: t("copied"),
                    className: toolviews_default.lineAction
                  }
                ),
                item.pdfUrl && /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
                  ZoteroOpenLink,
                  {
                    url: item.pdfUrl,
                    verdict: "open",
                    label: t("openPdf"),
                    t,
                    className: toolviews_default.actionLink
                  }
                ),
                item.selectUrl && /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
                  ZoteroOpenLink,
                  {
                    url: item.selectUrl,
                    verdict: "open",
                    label: t("openInZotero"),
                    t,
                    className: toolviews_default.actionLink
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: toolviews_default.evidenceText, children: [
              item.preview,
              item.previewTruncated ? ` ${t("truncatedPreview")}` : ""
            ] })
          ] }, `${item.sourceRef}-${index}`)) }) : rawText ? /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") })
        ] });
      }
    }
  );
}

// src/client/toolviews/ExportToolView.tsx
var import_react17 = require("react");
var import_dsh_client_ui_primitives21 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime33 = require("react/jsx-runtime");
function ExportToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const {
    icon,
    format,
    formatLabel,
    refsCount,
    style: style12,
    locale,
    summary,
    errorSummary,
    items,
    rawText,
    job
  } = (0, import_react17.useMemo)(() => {
    const raw = (resultTextOf(block) ?? "").trim();
    const errSummary = errorSummaryOf(block, raw);
    const args = argsOf(block);
    const formatArg = stringField(args ?? {}, "format") ?? "bibtex";
    const meta = metaOf(block);
    const exportView = meta !== null ? exportMetaOf(meta) : null;
    const job2 = meta !== null ? jobArmOf(meta) : null;
    const rawFmt = exportView?.format || formatArg;
    const label = formatLabelOf(rawFmt, t);
    const count = exportView?.refs.length ?? (Array.isArray(args?.["refs"]) ? args["refs"].length : 0);
    let sum = "";
    if ("phase" in block && block.phase === "start") {
      sum = t("toolExportRunning");
    } else {
      sum = job2 === null ? t("toolSummaryExport", { format: label, count }) : t(jobSummaryKeyOf(job2), { jobId: job2.jobId });
    }
    const mappedItems = (exportView?.items ?? []).map((item) => ({
      ...item,
      selectUrl: selectUrlOf(item.ref)
    }));
    return {
      icon: /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(import_dsh_client_ui_primitives21.IconCopyOutlineRegular, { size: 14 }),
      // The translator id, not its display label: the download's extension and
      // MIME type are the format's, and a localized label is neither.
      format: rawFmt,
      formatLabel: label,
      refsCount: count,
      // The CSL style and locale the call actually resolved. Without them a
      // citation's rendering is unknowable from the card, and the Exports
      // panel already states both beside the format.
      style: exportView?.style ?? null,
      locale: exportView?.locale ?? null,
      summary: sum,
      errorSummary: errSummary,
      items: mappedItems,
      // A job arm's text is only an acknowledgement, never an export
      // artifact. Keep it out of the code/download surface until job_output
      // supplies the completed translator text.
      rawText: job2 === null ? raw : "",
      job: job2
    };
  }, [block, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
    ZoteroToolRow,
    {
      toolName,
      block,
      useDisclosure,
      inspect,
      t,
      icon,
      title: t("toolTitleExport"),
      summary,
      summarySuffix: null,
      errorSummary,
      children: ({ isRunning }) => {
        if (isRunning) {
          return /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(RunningNotice, { text: t("toolExportRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)(import_jsx_runtime33.Fragment, { children: [
          job !== null ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolSummaryJobPending", { jobId: job.jobId }) }) : rawText ? /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: toolviews_default.codeWrap, children: [
            /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: toolviews_default.codeHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: toolviews_default.evidenceBadges, children: [
                /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: toolviews_default.badge, "data-tone": "info", children: formatLabel }),
                refsCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: toolviews_default.badge, children: t("exportRefCount", { count: refsCount }) }),
                style12 !== null && /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: toolviews_default.badge, children: style12 }),
                locale !== null && /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: toolviews_default.badge, children: locale })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: toolviews_default.itemActions, children: [
                /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
                  CopyButton,
                  {
                    value: rawText,
                    label: t("copy"),
                    copiedLabel: t("copied"),
                    className: toolviews_default.lineAction
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
                  "button",
                  {
                    type: "button",
                    className: toolviews_default.lineAction,
                    onClick: () => {
                      downloadBlob(rawText, fileNameForFormat(format), mimeOf(format));
                    },
                    children: `${t("downloadArtifact")} ${extensionOf(format)}`
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(RawTextFallback, { text: rawText })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") }),
          items.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: toolviews_default.notesSection, children: [
            /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: toolviews_default.sectionTitle, children: t("lensSources") }),
            /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("div", { className: toolviews_default.cardList, children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: toolviews_default.itemTitle, children: item.title || item.ref }),
              item.selectUrl && /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
                ZoteroOpenLink,
                {
                  url: item.selectUrl,
                  verdict: "open",
                  label: t("openInZotero"),
                  t,
                  className: toolviews_default.actionLink
                }
              )
            ] }, item.ref)) })
          ] })
        ] });
      }
    }
  );
}

// src/client/toolviews/ItemToolView.tsx
var import_react18 = require("react");
var import_dsh_client_ui_primitives22 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime34 = require("react/jsx-runtime");
function previewView(preview, index, kind) {
  const { selectUrl, pdfUrl } = childRowLinks({
    ref: preview.ref,
    parentRef: preview.parentRef,
    pageLabel: preview.pageLabel,
    kind
  });
  return {
    key: `${preview.ref}-${index}`,
    preview: preview.preview,
    pageLabel: preview.pageLabel,
    selectUrl,
    pdfUrl
  };
}
function ItemToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const {
    icon,
    ref,
    summary,
    errorSummary,
    getItemView,
    selectUrl,
    pdfUrl,
    childCounts,
    notePreviews,
    annotationPreviews,
    rawText
  } = (0, import_react18.useMemo)(() => {
    const args = argsOf(block);
    const itemRef = stringField(args ?? {}, "ref") ?? "";
    const meta = metaOf(block);
    const view = meta !== null ? getMetaOf(meta) : null;
    const raw = (resultTextOf(block) ?? "").trim();
    let sum = "";
    if ("phase" in block && block.phase === "start") {
      sum = itemRef || t("toolTitleGet");
    } else if (view?.title) {
      sum = view.year !== null && view.year !== void 0 && !view.title.includes(String(view.year)) ? t("toolSummaryItem", {
        title: view.title,
        year: String(view.year)
      }) : view.title;
    } else {
      sum = itemRef || t("toolTitleGet");
    }
    const errSummary = errorSummaryOf(block, raw);
    const sUrl = itemRef ? selectUrlOf(itemRef) : null;
    const pUrl = view?.bestAttachment?.ref ? pdfUrlOf(view.bestAttachment.ref) : null;
    const notesPreviews = view?.notesPreview ?? [];
    const annotationPreviews2 = view?.annotationsPreview ?? [];
    const counts = [
      {
        key: "notes",
        count: view?.notes ?? null,
        shown: notesPreviews.length,
        label: t(CHILD_KIND_LABEL.note)
      },
      {
        key: "annotations",
        count: view?.annotations ?? null,
        shown: annotationPreviews2.length,
        label: t(CHILD_KIND_LABEL.annotation)
      },
      {
        key: "attachments",
        count: view?.attachments ?? null,
        shown: null,
        label: t(CHILD_KIND_LABEL.attachment)
      }
    ];
    return {
      icon: /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(import_dsh_client_ui_primitives22.IconDeliverDocRegular, { size: 14 }),
      ref: itemRef,
      summary: sum,
      errorSummary: errSummary,
      getItemView: view,
      selectUrl: sUrl,
      pdfUrl: pUrl,
      childCounts: counts.flatMap(
        ({ key, count, shown, label }) => (
          // A kind the call did not ask for is absent, not zero: "no notes
          // exist" and "notes were not requested" are different facts.
          count === null ? [] : [{ key, label, count, shown }]
        )
      ),
      notePreviews: notesPreviews.map((preview, index) => previewView(preview, index, "note")),
      annotationPreviews: annotationPreviews2.map(
        (preview, index) => previewView(preview, index, "annotation")
      ),
      rawText: raw
    };
  }, [block, t]);
  const previewSection = (label, previews) => {
    if (previews.length === 0) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: toolviews_default.notesSection, children: [
      /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: toolviews_default.sectionTitle, children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("div", { className: toolviews_default.cardList, children: previews.map((preview) => /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: toolviews_default.itemCard, "data-child-row": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: toolviews_default.itemHeader, children: [
          preview.pageLabel !== null && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: toolviews_default.badge, children: preview.pageLabel }),
          /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: toolviews_default.itemMeta, children: preview.preview })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: toolviews_default.itemActions, children: [
          preview.pdfUrl !== null && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(
            ZoteroOpenLink,
            {
              url: preview.pdfUrl,
              verdict: "open",
              label: t("openPdf"),
              t,
              className: toolviews_default.actionLink
            }
          ),
          preview.selectUrl !== null && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(
            ZoteroOpenLink,
            {
              url: preview.selectUrl,
              verdict: "open",
              label: t("openInZotero"),
              t,
              className: toolviews_default.actionLink
            }
          )
        ] })
      ] }, preview.key)) })
    ] });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(
    ZoteroToolRow,
    {
      toolName,
      block,
      useDisclosure,
      inspect,
      t,
      icon,
      title: t("toolTitleGet"),
      summary,
      summarySuffix: null,
      errorSummary,
      children: ({ isRunning }) => {
        if (isRunning) {
          return /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)(import_jsx_runtime34.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: toolviews_default.itemCard, children: [
            /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              getItemView?.year !== null && getItemView?.year !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: toolviews_default.badge, children: getItemView.year }),
              getItemView?.bestAttachment && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: t("badgePdf") }),
              /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: toolviews_default.itemTitle, children: getItemView?.title ?? ref })
            ] }),
            getItemView?.creators && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("div", { className: toolviews_default.itemMeta, children: getItemView.creators }),
            getItemView?.venue && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("div", { className: toolviews_default.itemMeta, children: getItemView.venue }),
            childCounts.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("div", { className: toolviews_default.evidenceBadges, children: childCounts.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("span", { className: toolviews_default.badge, "data-child-count": entry.key, children: entry.shown === null ? (
              // No list of this kind on this card, so there is nothing
              // to pair the count against: state the count itself.
              `${entry.label} ${entry.count.returned}`
            ) : `${entry.label} ${countOfLabel(entry.count.total, entry.shown, t)}` }, entry.key)) }),
            /* @__PURE__ */ (0, import_jsx_runtime34.jsxs)("div", { className: toolviews_default.itemActions, children: [
              selectUrl && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(
                ZoteroOpenLink,
                {
                  url: selectUrl,
                  verdict: "open",
                  label: t("openInZotero"),
                  t,
                  className: toolviews_default.actionLink
                }
              ),
              pdfUrl && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(
                ZoteroOpenLink,
                {
                  url: pdfUrl,
                  verdict: "open",
                  label: t("openPdf"),
                  t,
                  className: toolviews_default.actionLink
                }
              )
            ] })
          ] }),
          previewSection(t(CHILD_KIND_LABEL.note), notePreviews),
          previewSection(t(CHILD_KIND_LABEL.annotation), annotationPreviews),
          rawText && /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(RawTextFallback, { text: rawText })
        ] });
      }
    }
  );
}

// src/client/toolviews/ChildrenToolView.tsx
var import_react19 = require("react");
var import_dsh_client_ui_primitives23 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime35 = require("react/jsx-runtime");
var sectionLabelKeyOf = (kind) => CHILD_KIND_LABEL[kind];
var CSS_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function annotationColorVar(color) {
  if (color === null || !CSS_HEX.test(color)) return void 0;
  return { "--zotero-annotation": color };
}
function rowTextOf(row) {
  return row.kind === "attachment" ? row.title : row.text;
}
function ChildSectionView({
  section,
  t
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: toolviews_default.notesSection, "data-child-kind": section.kind, children: [
    /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.sectionTitle, children: `${t(sectionLabelKeyOf(section.kind))} \xB7 ${countOfLabel(section.total, section.shown, t)}` }),
    section.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolChildrenNone") }) : /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("div", { className: toolviews_default.cardList, children: section.rows.map((row) => {
      const { selectUrl, pdfUrl } = childRowLinks(row);
      const swatch = annotationColorVar(row.kind === "annotation" ? row.color : null);
      return /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: toolviews_default.itemCard, "data-child-row": row.kind, children: [
        /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: toolviews_default.itemHeader, children: [
          swatch && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.annotationSwatch, style: swatch, "aria-hidden": true }),
          row.kind === "annotation" && row.pageLabel !== null && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.badge, children: row.pageLabel }),
          row.kind === "annotation" && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.badge, children: row.type }),
          row.kind === "attachment" && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: row.contentType }),
          /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.itemTitle, children: rowTextOf(row) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: toolviews_default.itemActions, children: [
          pdfUrl && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(
            ZoteroOpenLink,
            {
              url: pdfUrl,
              verdict: "open",
              label: t("openPdf"),
              t,
              className: toolviews_default.actionLink
            }
          ),
          selectUrl && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(
            ZoteroOpenLink,
            {
              url: selectUrl,
              verdict: "open",
              label: t("openInZotero"),
              t,
              className: toolviews_default.actionLink
            }
          )
        ] })
      ] }, row.ref);
    }) })
  ] });
}
function ChildrenToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const isAttachment = toolName === "zotero_attachment";
  const title = isAttachment ? t("toolTitleAttachment") : t("toolTitleChildren");
  const { icon, ref, summary, errorSummary, attachView, pdfUrl, sections, rawText } = (0, import_react19.useMemo)(() => {
    const args = argsOf(block);
    const itemRef = stringField(args ?? {}, "ref") ?? "";
    const meta = metaOf(block);
    const attachView2 = isAttachment && meta !== null ? attachmentMetaOf(meta) : null;
    const children = !isAttachment && meta !== null ? childrenMetaOf(meta) : null;
    const raw = (resultTextOf(block) ?? "").trim();
    const childTotal = (children?.sections ?? []).reduce((sum2, section) => sum2 + section.total, 0);
    let sum = "";
    if ("phase" in block && block.phase === "start") {
      sum = itemRef || title;
    } else if (attachView2?.title) {
      sum = t("toolSummaryAttachment", { title: attachView2.title });
    } else if ((children?.sections.length ?? 0) > 0) {
      sum = t("toolSummaryChildren", { count: childTotal });
    } else {
      sum = itemRef || title;
    }
    const errSummary = errorSummaryOf(block, raw);
    const pUrl = attachView2?.ref ? pdfUrlOf(attachView2.ref) : null;
    return {
      icon: /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(import_dsh_client_ui_primitives23.IconLinkOutlineMedium, { size: 14 }),
      ref: itemRef,
      summary: sum,
      errorSummary: errSummary,
      attachView: attachView2,
      pdfUrl: pUrl,
      sections: children?.sections ?? [],
      rawText: raw
    };
  }, [block, isAttachment, t, title]);
  return /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(
    ZoteroToolRow,
    {
      toolName,
      block,
      useDisclosure,
      inspect,
      t,
      icon,
      title,
      summary,
      summarySuffix: null,
      errorSummary,
      children: ({ isRunning }) => {
        if (isRunning) {
          return /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)(import_jsx_runtime35.Fragment, { children: [
          attachView && /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: toolviews_default.itemCard, children: [
            /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              attachView.kind && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.badge, children: attachView.kind.toUpperCase() }),
              attachView.contentType && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: attachView.contentType }),
              /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: toolviews_default.itemTitle, children: attachView.title ?? ref })
            ] }),
            attachView.location && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("div", { className: toolviews_default.itemMeta, children: attachView.location }),
            /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: toolviews_default.itemActions, children: [
              attachView.location && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(
                CopyButton,
                {
                  value: attachView.location,
                  label: t("copy"),
                  copiedLabel: t("copied"),
                  className: toolviews_default.lineAction
                }
              ),
              pdfUrl && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(
                ZoteroOpenLink,
                {
                  url: pdfUrl,
                  verdict: "open",
                  label: t("openPdf"),
                  t,
                  className: toolviews_default.actionLink
                }
              )
            ] })
          ] }),
          sections.map((section) => /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(ChildSectionView, { section, t }, section.kind)),
          rawText && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(RawTextFallback, { text: rawText })
        ] });
      }
    }
  );
}

// src/client/toolviews/WriteToolView.tsx
var import_react20 = require("react");
var import_dsh_client_ui_primitives24 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime36 = require("react/jsx-runtime");
var RECEIPT_BADGE = {
  applied: { label: "badgeSuccess", tone: "success" },
  noop: { label: "badgeNoOp", tone: "info" },
  // `unreported` is a warning, not the informational `noop`: nothing was proven
  // either way, which is a weaker position than a proven no-change and must
  // not read like one.
  unreported: { label: "badgeUnreported", tone: "warning" }
};
function noteTitleOf(markdown, defaultTitle) {
  if (!markdown) return defaultTitle;
  const firstLine = markdown.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return defaultTitle;
  const cleaned = firstLine.replace(/^[#*> \-\t]+/, "").trim();
  return cleaned || defaultTitle;
}
function stringList(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
}
var WRITE_DESCRIPTORS = {
  zotero_create_note: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleCreateNote",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryCreateNote", {
        title: noteTitleOf(stringField(args ?? {}, "markdown"), t("toolDefaultNoteTitle"))
      }),
      tone: "applied",
      tags: stringList(args?.["tags"]),
      parentRef: stringField(args ?? {}, "parentItem") ?? stringField(args ?? {}, "ref")
    })
  },
  zotero_update_item_tags: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconPlusOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateItemTags",
    describe: ({ args, write, t }) => {
      const requested = [...stringList(args?.["add"]), ...stringList(args?.["remove"])];
      if (write === null || write.addedCount === null && write.removedCount === null) {
        return {
          summary: t("toolSummaryUpdateItemTagsRequested", { count: requested.length }),
          tone: "unreported",
          tags: requested,
          parentRef: stringField(args ?? {}, "ref")
        };
      }
      const added = write.addedCount ?? 0;
      const removed = write.removedCount ?? 0;
      return {
        summary: added === 0 && removed === 0 ? t("toolNoTagsChanged") : t("toolSummaryUpdateItemTags", { added, removed }),
        tone: added === 0 && removed === 0 ? "noop" : "applied",
        tags: requested,
        parentRef: stringField(args ?? {}, "ref")
      };
    }
  },
  zotero_update_item_collections: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateItemCollections",
    describe: ({ args, write, t }) => {
      const requested = [...stringList(args?.["add"]), ...stringList(args?.["remove"])];
      if (write === null || write.addedCount === null && write.removedCount === null) {
        const name = requested[0] !== void 0 ? shortKeyOf(requested[0]) ?? requested[0].trim() : "";
        return {
          summary: t("toolSummaryUpdateItemCollectionsRequested", { name }),
          tone: "unreported",
          tags: [],
          parentRef: stringField(args ?? {}, "ref")
        };
      }
      const added = write.addedCount ?? 0;
      const removed = write.removedCount ?? 0;
      return {
        summary: added === 0 && removed === 0 ? t("toolNoMembershipChanged") : t("toolSummaryUpdateItemCollections", { added, removed }),
        tone: added === 0 && removed === 0 ? "noop" : "applied",
        tags: [],
        parentRef: stringField(args ?? {}, "ref")
      };
    }
  },
  zotero_create_collection: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleCreateCollection",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryCreateCollection", {
        name: (stringField(args ?? {}, "name") ?? "").trim()
      }),
      tone: "applied",
      tags: [],
      parentRef: stringField(args ?? {}, "parent")
    })
  },
  zotero_delete_collection: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleDeleteCollection",
    describe: ({ args, t }) => {
      const collectionArg = stringField(args ?? {}, "collection") ?? "";
      return {
        summary: t("toolSummaryDeleteCollection", {
          name: shortKeyOf(collectionArg) ?? collectionArg.trim()
        }),
        tone: "applied",
        tags: [],
        parentRef: collectionArg
      };
    }
  },
  zotero_create_item: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleCreateItem",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryCreateItem", {
        title: (stringField(args ?? {}, "title") ?? stringField(args ?? {}, "url") ?? "").trim()
      }),
      tone: "applied",
      tags: []
    })
  },
  zotero_update_item: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateItem",
    describe: ({ args, t }) => {
      const ref = stringField(args ?? {}, "ref");
      return {
        summary: t("toolSummaryUpdateItem", { ref: shortKeyOf(ref ?? "") ?? (ref ?? "").trim() }),
        tone: "applied",
        tags: [],
        parentRef: ref
      };
    }
  },
  zotero_delete_library_tags: {
    // A destructive glyph: this is the irreversible library-wide delete, and
    // the icon must not read like any other edit.
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(import_dsh_client_ui_primitives24.IconTrashOutlineRegular, { size: 14 }),
    titleKey: "toolTitleDeleteLibraryTags",
    describe: ({ args, write, t }) => {
      const tags = stringList(args?.["tags"]);
      if (write !== null && write.deletedCount !== null) {
        return {
          summary: t("toolSummaryDeleteLibraryTags", { count: write.deletedCount }),
          tone: "applied",
          tags
        };
      }
      return {
        summary: t("toolSummaryDeleteLibraryTagsRequested", { count: tags.length }),
        tone: "unreported",
        tags
      };
    }
  }
};
function WriteToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const {
    icon,
    title,
    summary,
    tone,
    errorSummary,
    parentRef,
    parentSelectUrl,
    tagsList,
    rawText
  } = (0, import_react20.useMemo)(() => {
    const descriptor = WRITE_DESCRIPTORS[toolName] ?? WRITE_DESCRIPTORS.zotero_create_note;
    const args = argsOf(block);
    const raw = (resultTextOf(block) ?? "").trim();
    const meta = metaOf(block);
    const write = meta !== null ? writeMetaOf(meta) : null;
    const described = descriptor.describe({ args, write, t });
    const pUrl = described.parentRef ? selectUrlOf(described.parentRef) : null;
    return {
      icon: descriptor.icon(),
      title: t(descriptor.titleKey),
      summary: described.summary,
      tone: described.tone,
      errorSummary: errorSummaryOf(block, raw),
      parentRef: described.parentRef,
      parentSelectUrl: pUrl,
      tagsList: described.tags,
      rawText: raw
    };
  }, [block, t, toolName]);
  return /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
    ZoteroToolRow,
    {
      toolName,
      block,
      useDisclosure,
      inspect,
      t,
      icon,
      title,
      summary,
      errorSummary,
      children: ({ isRunning, isDeclined, isUnverified, state }) => {
        if (isRunning) {
          return /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        if (isDeclined) {
          return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.receiptCard, "data-state": "declined", children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: toolviews_default.badge, "data-tone": "warning", children: t("toolDeclined") }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("div", { className: toolviews_default.itemMeta, children: rawText })
          ] });
        }
        if (isUnverified) {
          return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.receiptCard, "data-state": "unverified", children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolUnverifiedDetail") }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("div", { className: toolviews_default.itemMeta, children: rawText })
          ] });
        }
        if (state === "error") {
          return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.receiptCard, children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: toolviews_default.badge, "data-tone": "danger", children: t("toolFailed") }),
              /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: toolviews_default.receiptTitle, children: errorSummary })
            ] }),
            rawText && /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(RawTextFallback, { text: rawText })
          ] });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.receiptCard, "data-state": tone, children: [
          /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.itemHeader, children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: toolviews_default.badge, "data-tone": RECEIPT_BADGE[tone].tone, children: t(RECEIPT_BADGE[tone].label) }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: toolviews_default.receiptTitle, children: summary })
          ] }),
          parentSelectUrl && parentRef && /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.itemActions, children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("span", { className: toolviews_default.itemMeta, children: [
              t("toolParentItem"),
              ":"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
              ZoteroOpenLink,
              {
                url: parentSelectUrl,
                verdict: "open",
                label: parentRef,
                t,
                className: toolviews_default.actionLink
              }
            )
          ] }),
          tagsList.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { className: toolviews_default.notesSection, children: [
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolTags") }),
            /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("div", { className: toolviews_default.tagPills, children: tagsList.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
              "span",
              {
                className: toolviews_default.badge,
                "data-tone": tone === "applied" ? void 0 : RECEIPT_BADGE[tone].tone,
                children: tag
              },
              tag
            )) })
          ] }),
          rawText && /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(RawTextFallback, { text: rawText })
        ] });
      }
    }
  );
}

// src/client/toolviews/BrowseToolView.tsx
var import_react21 = require("react");
var import_dsh_client_ui_primitives25 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime37 = require("react/jsx-runtime");
var MAX_BROWSE_DEPTH = 4;
function shortRef(ref) {
  return ref === "" ? null : ref;
}
function browseRowView(row, index) {
  const key = `${row.kind}-${index}`;
  switch (row.kind) {
    case "library":
      return { key, name: row.name, detail: row.libraryId, ref: null, depth: 0 };
    case "collection":
      return {
        key,
        // The breadcrumb is the useful line: a nested collection is only
        // identifiable by where it sits, not by its leaf name.
        name: row.breadcrumb.join(" / "),
        detail: null,
        ref: shortRef(row.ref),
        depth: row.depth
      };
    case "savedSearch":
      return {
        key,
        name: row.name,
        detail: row.conditionCount === null ? null : String(row.conditionCount),
        ref: shortRef(row.ref),
        depth: 0
      };
    case "tag":
      return {
        key,
        name: row.tag,
        detail: row.count === null ? null : String(row.count),
        ref: null,
        depth: 0
      };
    case "itemType":
      return { key, name: row.itemType, detail: row.localized, ref: null, depth: 0 };
    case "field":
      return { key, name: row.field, detail: row.localized, ref: null, depth: 0 };
    case "creatorType":
      return { key, name: row.creatorType, detail: row.localized, ref: null, depth: 0 };
  }
}
var WITHHELD_REASON_LABEL = {
  "not-served": "withheldNotServed",
  "range-not-covered": "withheldRangeNotCovered",
  unreadable: "withheldUnreadable"
};
var WITHHELD_REMEDY = {
  "not-served": "withheldRemedyPermanent",
  "range-not-covered": "withheldRemedyRebaseline",
  unreadable: "withheldRemedyRerun"
};
function ChangesBody({
  changes,
  t
}) {
  const cursor = changes.cursor;
  const fulltext = changes.changed.find((section) => section.key === "fulltextAttachments");
  return /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)(import_jsx_runtime37.Fragment, { children: [
    changes.fromVersion !== null && /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.itemMeta, "data-changes-range": true, children: t("toolChangesRange", {
      from: changes.fromVersion,
      to: cursor?.version ?? t("toolChangesRangeUnknown")
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.cardList, "data-changes-sections": true, children: changes.changed.map((section) => /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.itemCard, "data-changes-kind": section.key, children: [
      /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.itemHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.itemTitle, children: t(section.label) }),
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.badge, children: countOfLabel(section.total, section.entries.length, t) })
      ] }),
      section.entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.itemMeta, "data-changes-entry": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { children: entry.key }),
        /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("span", { className: toolviews_default.badge, children: [
          "v",
          entry.version
        ] })
      ] }, entry.key)),
      section === fulltext && /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.itemMeta, "data-changes-caveat": true, children: t("toolChangesFulltextCaveat") })
    ] }, section.key)) }),
    changes.deleted.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.notesSection, "data-changes-deleted": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.sectionTitle, children: changes.deletedTotal === null ? t("toolDeletedNone") : t("toolDeletedTitle", { count: changes.deletedTotal }) }),
      /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.cardList, children: changes.deleted.map((section) => /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.itemCard, "data-changes-kind": section.key, children: [
        /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.itemHeader, children: [
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.itemTitle, children: t(section.label) }),
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.badge, children: countOfLabel(section.total, section.keys.length, t) })
        ] }),
        section.keys.map((key) => /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.itemMeta, "data-changes-entry": true, children: /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { children: key }) }, key))
      ] }, section.key)) })
    ] }),
    changes.withheld !== null && /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.notesSection, "data-changes-withheld": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolChangesWithheld") }),
      changes.withheld.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.itemMeta, children: t("availabilityEntry", {
        source: `${entry.kind}: ${t(WITHHELD_REASON_LABEL[entry.reason])}`,
        detail: t(WITHHELD_REMEDY[entry.reason])
      }) }, `${entry.kind}-${entry.reason}`))
    ] }),
    cursor !== null ? /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.notesSection, "data-changes-cursor": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolChangesCursor") }),
      /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.itemHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.itemMeta, children: t("toolChangesCursorValue", { version: cursor.version, serverId: cursor.serverId }) }),
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(
          CopyButton,
          {
            value: JSON.stringify({
              version: cursor.version,
              serverId: cursor.serverId
            }),
            label: t("copy"),
            copiedLabel: t("copied"),
            className: toolviews_default.lineAction
          }
        )
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.coverageNotice, "data-changes-no-cursor": true, children: t("toolChangesNoCursor") })
  ] });
}
function BrowseToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const isChanges = toolName === "zotero_changes";
  const title = isChanges ? t("toolTitleChanges") : t("toolTitleBrowse");
  const { icon, summary, errorSummary, rows, empty, nextOffset, changes, job, rawText } = (0, import_react21.useMemo)(() => {
    const raw = (resultTextOf(block) ?? "").trim();
    const errSummary = errorSummaryOf(block, raw);
    const args = argsOf(block);
    const askedKind = stringField(args ?? {}, "kind");
    const meta = metaOf(block);
    let sum = "";
    let rowViews = [];
    let empty2 = false;
    let next = null;
    let changesView = null;
    let job2 = null;
    if ("phase" in block && block.phase === "start") {
      sum = t("toolRunning");
    } else if (isChanges) {
      job2 = meta !== null ? jobArmOf(meta) : null;
      if (job2 === null) {
        const changes2 = meta !== null ? changesMetaOf(meta) : null;
        changesView = changes2;
        sum = changes2?.changedTotal != null ? t("toolSummaryChanges", { count: changes2.changedTotal }) : t("toolTitleChanges");
      } else {
        sum = t(jobSummaryKeyOf(job2), { jobId: job2.jobId });
      }
    } else {
      const browse = meta !== null ? browseMetaOf(meta) : null;
      const kind = browse?.kind ?? askedKind;
      if (browse !== null && browse.returned !== null && browse.total !== null) {
        sum = t("toolSummaryBrowsePage", {
          kind: kind ?? t("toolTitleBrowse"),
          returned: browse.returned,
          total: browse.total
        });
      } else if (kind !== void 0) {
        sum = t("toolSummaryBrowseKind", { kind });
      } else {
        sum = t("toolTitleBrowse");
      }
      rowViews = (browse?.rows ?? []).map(browseRowView);
      empty2 = browse?.rows != null && browse.rows.length === 0;
      next = browse?.nextOffset ?? null;
    }
    return {
      // The icon rides the memo with everything else the header renders, so a
      // re-render that leaves the call's own facts alone reuses the same node
      // and the `DisclosureRow` above it can skip the work.
      icon: isChanges ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(import_dsh_client_ui_primitives25.IconRefreshOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(import_dsh_client_ui_primitives25.IconBrowseOutlineRegular, { size: 14 }),
      summary: sum,
      errorSummary: errSummary,
      rows: rowViews,
      empty: empty2,
      nextOffset: next,
      changes: changesView,
      job: job2,
      rawText: raw
    };
  }, [block, isChanges, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(
    ZoteroToolRow,
    {
      toolName,
      block,
      useDisclosure,
      inspect,
      t,
      icon,
      title,
      summary,
      errorSummary,
      children: ({ isRunning }) => {
        if (isRunning) {
          return /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        if (isChanges) {
          if (changes !== null && (changes.changed.length > 0 || changes.deleted.length > 0)) {
            return /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(ChangesBody, { changes, t });
          }
          if (job !== null) {
            return /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.coverageNotice, "data-job-arm": job.kind, children: rawText || t("toolSummaryJobPending") });
          }
          return rawText ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") });
        }
        if (rows.length === 0) {
          if (empty) {
            return /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") });
          }
          return rawText ? /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)(import_jsx_runtime37.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.cardList, children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)(
            "div",
            {
              className: toolviews_default.itemCard,
              "data-browse-row": row.key,
              "data-depth": row.depth > 0 ? Math.min(row.depth, MAX_BROWSE_DEPTH) : void 0,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)("div", { className: toolviews_default.itemHeader, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.itemTitle, children: row.name }),
                  row.detail !== null && /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: toolviews_default.badge, children: row.detail })
                ] }),
                row.ref !== null && /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.itemMeta, children: row.ref })
              ]
            },
            row.key
          )) }),
          nextOffset !== null && /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolBrowseNextPage", { offset: nextOffset }) })
        ] });
      }
    }
  );
}

// src/client/toolviews/index.ts
var REGISTRATIONS = [
  ["zotero_search", SearchToolView],
  ["zotero_retrieve", RetrieveToolView],
  ["zotero_export", ExportToolView],
  ["zotero_get", ItemToolView],
  ["zotero_children", ChildrenToolView],
  ["zotero_attachment", ChildrenToolView],
  ["zotero_create_note", WriteToolView],
  ["zotero_update_item_tags", WriteToolView],
  ["zotero_update_item_collections", WriteToolView],
  ["zotero_create_collection", WriteToolView],
  ["zotero_delete_collection", WriteToolView],
  ["zotero_create_item", WriteToolView],
  ["zotero_update_item", WriteToolView],
  ["zotero_delete_library_tags", WriteToolView],
  ["zotero_browse", BrowseToolView],
  ["zotero_changes", BrowseToolView]
];
function registerZoteroToolviews(ctx) {
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const [key, component] of REGISTRATIONS) {
      yield ctx.slots.register({ name: "tool.call.toolview", key, locale: "zotero" }, component);
    }
  });
}

// src/client/locales.ts
var en = {
  nav: "Zotero",
  title: "Zotero",
  description: "Connect to your local Zotero library for search, passages, and citations.",
  overridden: "Overridden",
  reset: "Reset to default",
  readOnly: "This deployment stores settings read-only.",
  discard: "Discard changes",
  unsaved: "Unsaved",
  save: "Save",
  saving: "Saving\u2026",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  unavailable: "This deployment does not serve the Zotero settings namespace, so there is nothing to configure here.",
  invalidNumber: "Enter a number, or leave blank to use the default.",
  groupConnection: "Connection",
  groupSearch: "Search limits",
  groupOutput: "Output limits",
  groupDefaults: "Citation defaults",
  groupWrite: "Writing",
  writeEnabled: "Allow writes",
  writeEnabledHint: "The agent can change the library: notes, tags, collections, and items.",
  writeRiskTitle: "Enable writes?",
  writeRiskDescription: "Turning this on lets the agent change your Zotero library \u2014 notes, tags, collections, and items. Deletions cannot be undone. AI can make mistakes; review before enabling.",
  writeRiskAcknowledge: "I understand this will modify my Zotero library and that AI can make mistakes.",
  writeRiskConfirm: "Allow writes",
  writeRiskCancel: "Cancel",
  writeRiskClose: "Close",
  writePersistKey: "Remember the Zotero write key",
  writePersistKeyHint: 'Stores an "Always Allow" key from the Zotero dialog so writes stop asking every time. One-time approvals are never stored.',
  writeNoteMaxChars: "Note body cap",
  writeNoteMaxCharsHint: "Most characters one research note body may carry.",
  writeListMaxItems: "Write list cap",
  writeListMaxItemsHint: "Most items one write call may carry in a list argument.",
  writeAuthorizeDeadlineMs: "Authorize dialog deadline (ms)",
  writeAuthorizeDeadlineMsHint: "How long the Zotero authorization dialog may stay open during a write.",
  baseUrl: "Zotero local API address",
  baseUrlHint: "Loopback HTTP only (127.0.0.1, localhost, or ::1).",
  provider: "Provider id",
  providerHint: "Which registered provider serves requests; the built-in one is local.",
  timeoutMs: "Request timeout (ms)",
  timeoutMsHint: "How long one request may run before it is given up.",
  maxInFlightRequests: "Concurrent request cap",
  maxInFlightRequestsHint: "Most requests the plugin keeps in flight against the Local API.",
  maxSearchResults: "Search result cap",
  maxSearchResultsHint: "Most items one search returns.",
  maxNoteScanRecords: "Note scan cap",
  maxNoteScanRecordsHint: "Most notes a search scans for body matches.",
  searchConcurrency: "Search concurrency",
  searchConcurrencyHint: "Parallel parent-attribution queries one search keeps in flight.",
  maxEvidenceChars: "Passage character budget",
  maxEvidenceCharsHint: "Total characters kept across retrieved passages.",
  maxEvidencePassages: "Passage cap",
  maxEvidencePassagesHint: "Most passages one retrieval returns.",
  maxDetailChars: "Abstract preview budget",
  maxDetailCharsHint: "Characters shown in the abstract preview of an item.",
  maxNoteBodyChars: "Note body budget",
  maxNoteBodyCharsHint: "Characters kept from a note\u2019s own body.",
  maxNoteChars: "Note preview budget",
  maxNoteCharsHint: "Characters kept per note preview.",
  maxNoteRecords: "Note record cap",
  maxNoteRecordsHint: "Most notes returned for one item.",
  maxAnnotationRecords: "Annotation record cap",
  maxAnnotationRecordsHint: "Most annotations returned for one item.",
  fulltextChunkWords: "Full-text chunk words",
  fulltextChunkWordsHint: "Word count of each full-text chunk entering passage ranking.",
  maxFulltextChars: "Full-text character bound",
  maxFulltextCharsHint: "Most full-text characters considered when ranking passages.",
  retrieveAttachmentCap: "Attachment cap per retrieval",
  retrieveAttachmentCapHint: "Most attachments one retrieval ranks full text from.",
  graphConcurrency: "Retrieve concurrency",
  graphConcurrencyHint: "Parallel attachment reads one retrieval keeps in flight.",
  maxResponseBytes: "Response byte cap",
  maxResponseBytesHint: "Hard byte limit for one API response body.",
  maxExportChars: "Export character cap",
  maxExportCharsHint: "Most characters one export may produce.",
  maxExportRefs: "Export ref cap",
  maxExportRefsHint: "Most references one export accepts.",
  maxBrowseResults: "Browse result cap",
  maxBrowseResultsHint: "Most items one browse call returns.",
  maxChangesResults: "Changes listing cap",
  maxChangesResultsHint: "Most rows one changes listing shows per kind \u2014 display only; the diff still covers the whole range and totals report the true counts.",
  scopeListingTtlMs: "Scope listing cache (ms)",
  scopeListingTtlMsHint: "How long a collections/searches listing is trusted before a re-read.",
  defaultStyle: "Default citation style",
  defaultStyleHint: "CSL style id used for citations and bibliographies (e.g. apa).",
  defaultLocale: "Default citation locale",
  defaultLocaleHint: "CSL locale used for citations and bibliographies (e.g. en-US).",
  groupJobs: "Background tasks",
  enableRunInBackground: "Allow background tasks",
  enableRunInBackgroundHint: "Allow tools like export and changes to be started in the background via run_in_background. Slow-task promotion is controlled separately.",
  promoteOnTimeout: "Promote slow tasks to background",
  promoteOnTimeoutHint: "Automatically promote long-running operations to background jobs when foreground wait expires.",
  foregroundWaitMs: "Foreground wait timeout (ms)",
  foregroundWaitMsHint: "How long to wait synchronously before promoting an operation to a background job.",
  groupWeb: "Literature tab",
  webEnabled: "Show literature tab",
  webEnabledHint: "Shows a Zotero literature tab at the top of conversations, with literature, passages, and exports.",
  copy: "Copy",
  copied: "Copied",
  commandInputAria: "Command input",
  checking: "Checking\u2026",
  statusUnavailable: "Unavailable",
  statusConnectedNote: "Connected to Zotero",
  detailsLabel: "Diagnostics",
  apiVersionLabel: "API version",
  schemaVersionLabel: "Schema version",
  zoteroVersionLabel: "Zotero version",
  serverIdLabel: "Server ID",
  writeLabel: "Write",
  writeAuthorizedLabel: "enabled, key stored",
  writeUnauthorizedLabel: "enabled, no key yet",
  writeDisabledLabel: "disabled",
  buildInfoLabel: "Build",
  diagnosisLabel: "Diagnosis",
  diagnosisNotRunning: 'Zotero is not running or unreachable. Please launch Zotero and enable "Allow other applications on this computer to communicate with Zotero" in Settings \u2192 Advanced, then click Refresh.',
  diagnosisApiDisabled: 'Zotero local API is disabled. In Zotero Settings \u2192 Advanced, check "Allow other applications on this computer to communicate with Zotero", then click Refresh.',
  diagnosisApiVersion: "Incompatible Zotero API version. This plugin requires Zotero 7 or later.",
  diagnosisTimeout: "Connection to local Zotero timed out. Please check if Zotero is responsive or if the port is busy.",
  diagnosisNotComposed: "The Zotero plugin service is not loaded in this session. Open Plugins and enable dsh-zotero, then refresh.",
  diagnosisProviderUnavailable: "The configured Zotero provider is not registered. Check the provider id in Settings \u2192 Zotero.",
  diagnosisCapabilityUnavailable: "The selected Zotero provider does not serve this capability. Switch provider or enable the feature.",
  diagnosisUnknown: "Connection error",
  refresh: "Refresh",
  lastCheckedLabel: "Last checked",
  quickConfigTitle: "Quick settings",
  quickConfigHint: "Toggle the core Zotero features here. Full settings live in Settings \u2192 Zotero.",
  detailSectionTitle: "Service status & quick start",
  activationTitle: "Enable Zotero Plugin",
  activationClose: "Close guidance",
  activationDescription: "Before letting agents search and cite your library, please make sure your local environment is ready:",
  activationStep1: "Ensure local Zotero app (v7+) is running.",
  activationStep2: 'In Zotero Settings \u2192 Advanced, check "Allow other applications on this computer to communicate with Zotero".',
  activationStep2Note: "Leaving this unchecked causes HTTP 403 Forbidden errors when connecting to the local API.",
  activationStatusLabel: "Connection status",
  activationReady: "Connected to local Zotero. Ready to use!",
  activationReadyVersion: "Connected to local Zotero ({version}). Ready to use!",
  activationLater: "Later",
  activationDetails: "Open Details",
  activationDone: "Done",
  activationCheckAgain: "Check Again",
  tipsLabel: "Quick tips",
  tipNoKey: "No API key needed: it talks to the Zotero app on this computer.",
  tipFulltext: "Full-text search: index PDFs in Zotero so the agent can quote real passages.",
  tipSettingsNav: "Fine-tune connection, limits, and citation style in Settings \u2192 Zotero.",
  lensSources: "Literature",
  lensExports: "Exports",
  lensBarLabel: "Literature views",
  filterBarLabel: "Source filters",
  inspectorTabsLabel: "Source detail panels",
  panelOverview: "Overview",
  panelEvidence: "Passages",
  panelExports: "Exports",
  backToList: "Back to list",
  selectionHiddenNote: "This source is hidden by the active filter; the details stay available here.",
  inspectorEmptyNote: "Select a source to see its details.",
  scopeLine: "Scope",
  filterLine: "Filters",
  modeLine: "Mode",
  modeMetadata: "Metadata",
  modeEverything: "Metadata and full text",
  overviewScopeLibrary: "Library",
  overviewScopePublications: "My Publications",
  overviewScopeCollection: "Collection",
  overviewScopeSavedSearch: "Saved search",
  searchDetailOpen: "Search details",
  searchDetailClose: "Hide search details",
  refLine: "Ref",
  overviewNoSearch: "This source was referenced directly, not through a search.",
  retrievalRunCount: "{count} retrieves",
  retrievalKeptCount: "{count} passages kept",
  retrievalReportedCount: "{count} reported",
  availabilityTitle: "Latest state of each retrieve source",
  evidenceEntryLabel: "Passage overview ({count})",
  backToSources: "Back to literature",
  downloadArtifact: "Download",
  filterAll: "All",
  filterPdf: "PDF",
  filterRetrieved: "Content retrieved",
  filterEvidence: "With passages",
  filterExported: "Exported",
  filterIssues: "Issues",
  filterClear: "Clear filter",
  filterEmptyNote: "No sources match this filter.",
  filterScrollLeft: "Scroll filters left",
  filterScrollRight: "Scroll filters right",
  omittedRowsNote: "{count} more search results are not listed individually.",
  noSources: "No Zotero papers in this session yet.",
  searchFrom: 'Search "{query}"',
  searchFromBrowse: "Search without a query",
  provenanceMismatch: "Belongs to a different Zotero database",
  evidenceBadge: "{count} passages",
  exportBadge: "{count} exports",
  failedBadge: "{count} failed",
  runningBadge: "{count} running",
  stoppedBadge: "{count} stopped",
  badgePdf: "PDF",
  issuesBadge: "Issues",
  bestAttachmentLabel: "Best attachment",
  localFile: "Local file",
  linkedUrl: "Linked URL",
  copyRef: "Copy ref",
  copyExport: "Copy",
  copyCite: "\\cite{\u2026}",
  copyAll: "Copy all",
  downloadAll: "Download all",
  unresolvedItemsNote: "{count} more documents cannot be shown individually",
  downloadFull: "Download full",
  askAboutItem: "Ask about this",
  askTemplate: "About this item ({ref}): ",
  citeTemplate: "Export this item from Zotero as BibTeX: {ref}",
  exportCitation: "Export citation",
  sourceAnnotation: "Annotation",
  sourceNote: "Note",
  sourceAbstract: "Abstract",
  sourceFulltext: "Full text",
  pageLabel: "p.{label}",
  matchedInText: "match in text",
  matchedInComment: "match in comment",
  truncatedPreview: "(truncated)",
  retrievedMultiple: "gathered across {count} retrieves",
  coverageLabel: "Indexing coverage",
  coveragePages: "{indexed}/{total} pages",
  coverageChars: "{indexed}/{total} chars",
  coverageComplete: " \xB7 complete",
  coverageIncomplete: " \xB7 incomplete",
  countOfReturned: "{total} in total, {shown} shown",
  budgetLimitedNote: "Results were limited by the global budget.",
  availReturned: "{count} matching passages",
  availUnavailable: "unavailable",
  availNoMatch: "no matching passages",
  evidenceRetrievedNone: "No matching passages were found this time.",
  evidenceNotRetrieved: "This paper's content has not been retrieved yet. Ask the Agent about it and the matching passages will appear here.",
  evidenceReportedNoPreview: "{count} passages reported across retrieves; no previews were kept.",
  evidenceEmptyNote: "No passages yet. Ask the Agent about a paper and the abstracts, annotations, notes, or full-text passages it finds will appear here.",
  exportsEmptyNote: "No successful exports in this session yet.",
  exportsIncompleteNote: "Exports that did not complete: {counts}",
  formatCitation: "Citations",
  formatBibliography: "Bibliography",
  formatUnknown: "Export",
  exportRefCount: "{count} refs",
  exportRefsOmitted: "{count} more not listed",
  openInZotero: "Open in Zotero",
  openPdf: "Open PDF",
  openAnnotation: "Open annotation",
  instanceUnverified: "cannot verify the current Zotero instance",
  openUnverifiedNote: " ({detail})",
  availabilityEntry: "{source}: {detail}",
  starterFind: "Find literature\u2026",
  starterFindTemplate: "Search my Zotero library for literature on: ",
  starterCompare: "Compare selected papers\u2026",
  starterCompareTemplate: "Compare the following Zotero papers: ",
  starterEvidence: "Find passages\u2026",
  starterEvidenceTemplate: "Find passages in this paper for the following question: ",
  starterExportSelected: "Export citations for selected items\u2026",
  starterExportSelectedTemplate: "Export these items from my Zotero library as citations: ",
  toolTitleSearch: "Zotero Search",
  toolTitleRetrieve: "Zotero Retrieve Evidence",
  toolTitleExport: "Zotero Export Citation",
  toolTitleGet: "Zotero Item Details",
  toolTitleChildren: "Zotero Item Children",
  toolTitleAttachment: "Zotero Attachment",
  toolTitleCreateNote: "Zotero Create Note",
  toolTitleUpdateItemTags: "Zotero Update Item Tags",
  toolTitleUpdateItemCollections: "Zotero Update Item Collections",
  toolTitleCreateCollection: "Zotero Create Collection",
  toolTitleDeleteCollection: "Zotero Delete Collection",
  toolTitleCreateItem: "Zotero Create Item",
  toolTitleUpdateItem: "Zotero Update Item",
  toolTitleDeleteLibraryTags: "Zotero Delete Library Tags",
  toolTitleBrowse: "Zotero Browse",
  toolTitleChanges: "Zotero Sync Changes",
  toolRunning: "Running\u2026",
  toolFailed: "Failed",
  toolStopped: "Stopped",
  toolDeclined: "Write plan was declined; not executed",
  toolUnverified: "Committed, not verified; do not retry",
  toolUnverifiedDetail: "What Zotero reported",
  toolSummaryJobPending: "Still running; nothing to read yet.",
  toolOmittedPassages: "{count} further passages are not listed here.",
  toolInspect: "Inspect",
  toolSearchRunning: "Searching Zotero library\u2026",
  toolRetrieveRunning: "Retrieving evidence passages\u2026",
  toolExportRunning: "Exporting citations\u2026",
  toolSummaryFound: "found {count} items",
  toolSummaryFoundWithNotes: "found {count} items (+{notes} notes)",
  toolSummaryEvidence: "extracted {count} passages",
  toolSummaryExport: "exported {format} ({count} items)",
  toolSummaryItem: "{title} ({year})",
  toolSummaryChildren: "{count} child objects",
  toolSummaryAttachment: "Attachment: {title}",
  toolSummaryCreateNote: 'Created note "{title}"',
  toolSummaryUpdateItemTags: "Updated tags: +{added} \u2212{removed}",
  toolSummaryUpdateItemTagsRequested: "Requested {count} tag changes",
  toolNoTagsChanged: "The tag set already matches; nothing was written",
  toolSummaryUpdateItemCollections: "Updated membership: +{added} \u2212{removed}",
  toolSummaryUpdateItemCollectionsRequested: 'Requested membership in "{name}"',
  toolNoMembershipChanged: "The membership already matches; nothing was written",
  toolSummaryCreateCollection: 'Created collection "{name}"',
  toolSummaryDeleteCollection: 'Deleted collection "{name}"',
  toolSummaryCreateItem: 'Created item "{title}"',
  toolSummaryUpdateItem: "Updated item {ref}",
  toolSummaryDeleteLibraryTags: "Deleted {count} library tags",
  toolSummaryDeleteLibraryTagsRequested: "Requested deletion of {count} library tags",
  toolSummaryBrowseKind: "Browsing {kind}",
  toolSummaryBrowsePage: "Browsing {kind}: {returned} of {total}",
  toolBrowseNextPage: "More results start at offset {offset}",
  toolSummaryChanges: "Sync changes: {count} records",
  toolChangesItems: "Items",
  toolChangesChildItems: "Child objects",
  toolChangesTrashedItems: "Items in the trash",
  toolChangesCollections: "Collections",
  toolChangesSavedSearches: "Saved searches",
  toolChangesFulltext: "Full-text reindexed",
  toolChangesCursor: "Cursor",
  toolChangesCursorValue: "version {version} on instance {serverId}",
  toolChangesRange: "Range: version {from} \u2192 {to}",
  toolChangesRangeUnknown: "an unverified end",
  toolChangesNoCursor: "This read withheld a cursor, so it is not a settled range and not safe to resume from.",
  toolChangesWithheld: "Not covered by this read",
  toolChangesFulltextCaveat: "Index versions count on their own, so these rows are a listing.",
  withheldNotServed: "not served by this Zotero build",
  withheldRangeNotCovered: "older than the change history this build keeps",
  withheldUnreadable: "the answer was unreadable",
  withheldRemedyPermanent: "nothing to do; this build never reports it",
  withheldRemedyRebaseline: "take a fresh baseline to track it from here",
  withheldRemedyRerun: "run the call again",
  toolDeletedTitle: "Deletions: {count}",
  toolDeletedNone: "Deletions: none in this range.",
  toolDeletedItems: "Deleted items",
  toolDeletedCollections: "Deleted collections",
  toolDeletedSavedSearches: "Deleted saved searches",
  toolDeletedTags: "Deleted tags",
  toolDeletedOther: "Other deleted objects",
  toolSummaryJobBackground: "background job {jobId}",
  toolSummaryJobPromoted: "promoted to job {jobId}",
  toolParentItem: "Parent Item",
  toolTags: "Tags",
  toolChildrenNotes: "Notes",
  toolChildrenAnnotations: "Annotations",
  toolChildrenAttachments: "Attachments",
  toolChildrenNone: "None of this kind.",
  toolNoResults: "No matching results found",
  toolDefaultNoteTitle: "Note",
  badgeSuccess: "OK",
  badgeNoOp: "No change",
  badgeUnreported: "Outcome unreported",
  commandChecking: "Connecting to local API\u2026",
  commandFailed: "Command failed",
  statusServerIdUnreported: "Not reported (this build does not identify database)",
  statusLocalApiAddress: "Local API Address"
};
var zh = {
  nav: "Zotero",
  title: "Zotero",
  description: "\u8FDE\u63A5\u672C\u673A Zotero\uFF0C\u68C0\u7D22\u6587\u732E\u3001\u63D0\u53D6\u76F8\u5173\u7247\u6BB5\u5E76\u5BFC\u51FA\u5F15\u7528\u3002",
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  discard: "\u653E\u5F03\u4FEE\u6539",
  unsaved: "\u672A\u4FDD\u5B58",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saveFailed: "\u672C\u90E8\u7F72\u6CA1\u6709\u63A5\u53D7\u8FD9\u4E9B\u503C\uFF0C\u5DF2\u4FDD\u7559\u4F9B\u4F60\u4FEE\u6539\u3002",
  unavailable: "\u672C\u90E8\u7F72\u6CA1\u6709\u63D0\u4F9B Zotero \u8BBE\u7F6E\u9879\uFF0C\u8FD9\u91CC\u6682\u65E0\u53EF\u914D\u7F6E\u5185\u5BB9\u3002",
  invalidNumber: "\u8BF7\u586B\u6570\u5B57\uFF1B\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u9ED8\u8BA4\u503C\u3002",
  groupConnection: "\u8FDE\u63A5",
  groupSearch: "\u68C0\u7D22\u9650\u5236",
  groupOutput: "\u8F93\u51FA\u9650\u5236",
  groupDefaults: "\u5F15\u6587\u9ED8\u8BA4\u503C",
  groupWrite: "\u5199\u5165",
  writeEnabled: "\u5141\u8BB8\u5199\u5165",
  writeEnabledHint: "\u53EF\u4FEE\u6539\u6587\u5E93\uFF1A\u7B14\u8BB0\u3001\u6807\u7B7E\u3001\u5408\u96C6\u4E0E\u6761\u76EE\u3002",
  writeRiskTitle: "\u5F00\u542F\u5199\u5165\uFF1F",
  writeRiskDescription: "\u5F00\u542F\u540E\u667A\u80FD\u4F53\u53EF\u4EE5\u4FEE\u6539\u4F60\u7684 Zotero \u6587\u732E\u5E93\uFF1A\u7B14\u8BB0\u3001\u6807\u7B7E\u3001\u5408\u96C6\u4E0E\u6761\u76EE\u3002\u5220\u9664\u4E0D\u53EF\u64A4\u9500\u3002AI \u53EF\u80FD\u4F1A\u51FA\u9519\uFF0C\u8BF7\u786E\u8BA4\u540E\u518D\u5F00\u542F\u3002",
  writeRiskAcknowledge: "\u6211\u4E86\u89E3\u8FD9\u4F1A\u4FEE\u6539\u6211\u7684 Zotero \u6587\u732E\u5E93\uFF0C\u4E14 AI \u53EF\u80FD\u51FA\u9519",
  writeRiskConfirm: "\u5141\u8BB8\u5199\u5165",
  writeRiskCancel: "\u53D6\u6D88",
  writeRiskClose: "\u5173\u95ED",
  writePersistKey: "\u8BB0\u4F4F Zotero \u5199\u5165\u6388\u6743",
  writePersistKeyHint: "\u4FDD\u5B58 Zotero \u5F39\u7A97\u91CC\u300C\u59CB\u7EC8\u5141\u8BB8\u300D\u7684\u6388\u6743\u5BC6\u94A5\uFF0C\u4E4B\u540E\u5199\u5165\u4E0D\u518D\u53CD\u590D\u5F39\u7A97\u3002\u4E00\u6B21\u6027\u6388\u6743\u4E0D\u4F1A\u4FDD\u5B58\u3002",
  writeNoteMaxChars: "\u7B14\u8BB0\u6B63\u6587\u5B57\u6570\u4E0A\u9650",
  writeNoteMaxCharsHint: "\u5355\u6761\u7814\u7A76\u7B14\u8BB0\u6B63\u6587\u6700\u591A\u5BB9\u7EB3\u7684\u5B57\u7B26\u6570\u3002",
  writeListMaxItems: "\u5199\u5165\u5217\u8868\u4E0A\u9650",
  writeListMaxItemsHint: "\u5355\u6B21\u5199\u5165\u8C03\u7528\u7684\u5217\u8868\u53C2\u6570\u6700\u591A\u5BB9\u7EB3\u7684\u6761\u6570\u3002",
  writeAuthorizeDeadlineMs: "\u6388\u6743\u5F39\u7A97\u65F6\u9650\uFF08\u6BEB\u79D2\uFF09",
  writeAuthorizeDeadlineMsHint: "\u5199\u5165\u65F6\u7B49\u5F85 Zotero \u6388\u6743\u5F39\u7A97\u7684\u6700\u957F\u65F6\u95F4\u3002",
  baseUrl: "Zotero \u672C\u5730\u63A5\u53E3\u5730\u5740",
  baseUrlHint: "\u4EC5\u9650\u672C\u673A\u5730\u5740\uFF08127.0.0.1\u3001localhost \u6216 ::1\uFF09\u3002",
  provider: "\u63D0\u4F9B\u65B9 ID",
  providerHint: "\u5904\u7406\u8BF7\u6C42\u7684\u5DF2\u6CE8\u518C\u63D0\u4F9B\u65B9\uFF1B\u5185\u7F6E\u63D0\u4F9B\u65B9\u4E3A local\u3002",
  timeoutMs: "\u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
  timeoutMsHint: "\u5355\u6B21\u8BF7\u6C42\u6700\u957F\u7B49\u5F85\u591A\u4E45\u540E\u653E\u5F03\u3002",
  maxInFlightRequests: "\u5E76\u53D1\u8BF7\u6C42\u6570\u4E0A\u9650",
  maxInFlightRequestsHint: "\u63D2\u4EF6\u540C\u65F6\u5BF9\u672C\u5730\u63A5\u53E3\u4FDD\u6301\u7684\u6700\u591A\u5728\u9014\u8BF7\u6C42\u6570\u3002",
  maxSearchResults: "\u641C\u7D22\u7ED3\u679C\u4E0A\u9650",
  maxSearchResultsHint: "\u5355\u6B21\u641C\u7D22\u6700\u591A\u8FD4\u56DE\u7684\u6761\u76EE\u6570\u3002",
  maxNoteScanRecords: "\u7B14\u8BB0\u626B\u63CF\u4E0A\u9650",
  maxNoteScanRecordsHint: "\u641C\u7D22\u6B63\u6587\u65F6\u6700\u591A\u626B\u63CF\u7684\u7B14\u8BB0\u6761\u6570\u3002",
  searchConcurrency: "\u641C\u7D22\u5E76\u53D1\u6570",
  searchConcurrencyHint: "\u5355\u6B21\u641C\u7D22\u53EF\u540C\u65F6\u53D1\u8D77\u7684\u5F52\u5C5E\u67E5\u8BE2\u6570\u3002",
  maxEvidenceChars: "\u76F8\u5173\u7247\u6BB5\u603B\u5B57\u6570",
  maxEvidenceCharsHint: "\u5355\u6B21\u53D6\u6587\u4FDD\u7559\u7684\u76F8\u5173\u7247\u6BB5\u5408\u8BA1\u5B57\u6570\u3002",
  maxEvidencePassages: "\u76F8\u5173\u7247\u6BB5\u6761\u6570",
  maxEvidencePassagesHint: "\u5355\u6B21\u53D6\u6587\u6700\u591A\u8FD4\u56DE\u7684\u76F8\u5173\u7247\u6BB5\u6570\u3002",
  maxDetailChars: "\u6458\u8981\u9884\u89C8\u5B57\u6570",
  maxDetailCharsHint: "\u6761\u76EE\u8BE6\u60C5\u91CC\u6458\u8981\u9884\u89C8\u7684\u5B57\u6570\u4E0A\u9650\u3002",
  maxNoteBodyChars: "\u7B14\u8BB0\u6B63\u6587\u5B57\u6570",
  maxNoteBodyCharsHint: "\u5355\u6761\u7B14\u8BB0\u6B63\u6587\u6700\u591A\u4FDD\u7559\u7684\u5B57\u6570\u3002",
  maxNoteChars: "\u7B14\u8BB0\u9884\u89C8\u5B57\u6570",
  maxNoteCharsHint: "\u6BCF\u6761\u7B14\u8BB0\u9884\u89C8\u7684\u5B57\u6570\u4E0A\u9650\u3002",
  maxNoteRecords: "\u7B14\u8BB0\u6761\u6570\u4E0A\u9650",
  maxNoteRecordsHint: "\u5355\u4E2A\u6761\u76EE\u6700\u591A\u8FD4\u56DE\u7684\u7B14\u8BB0\u6761\u6570\u3002",
  maxAnnotationRecords: "\u6279\u6CE8\u6761\u6570\u4E0A\u9650",
  maxAnnotationRecordsHint: "\u5355\u4E2A\u6761\u76EE\u6700\u591A\u8FD4\u56DE\u7684\u6279\u6CE8\u6761\u6570\u3002",
  fulltextChunkWords: "\u5168\u6587\u5206\u5757\u8BCD\u6570",
  fulltextChunkWordsHint: "\u5168\u6587\u6309\u8BCD\u6570\u5206\u5757\u540E\u53C2\u4E0E\u76F8\u5173\u7247\u6BB5\u6392\u5E8F\u3002",
  maxFulltextChars: "\u5168\u6587\u5B57\u7B26\u4E0A\u9650",
  maxFulltextCharsHint: "\u53C2\u4E0E\u76F8\u5173\u7247\u6BB5\u6392\u5E8F\u7684\u5168\u6587\u6700\u591A\u5B57\u6570\u3002",
  retrieveAttachmentCap: "\u5355\u6B21\u53D6\u6587\u9644\u4EF6\u4E0A\u9650",
  retrieveAttachmentCapHint: "\u5355\u6B21\u53D6\u6587\u6700\u591A\u53C2\u4E0E\u5168\u6587\u6392\u5E8F\u7684\u9644\u4EF6\u6570\u3002",
  graphConcurrency: "\u53D6\u6587\u5E76\u53D1\u6570",
  graphConcurrencyHint: "\u5355\u6B21\u53D6\u6587\u540C\u65F6\u8BFB\u53D6\u9644\u4EF6\u7684\u5E76\u53D1\u6570\u3002",
  maxResponseBytes: "\u5355\u6B21\u54CD\u5E94\u5B57\u8282\u4E0A\u9650",
  maxResponseBytesHint: "\u6BCF\u6B21\u63A5\u53E3\u54CD\u5E94\u4F53\u7684\u5B57\u8282\u4E0A\u9650\u3002",
  maxExportChars: "\u5BFC\u51FA\u5B57\u6570\u4E0A\u9650",
  maxExportCharsHint: "\u5355\u6B21\u5BFC\u51FA\u5185\u5BB9\u7684\u5B57\u6570\u4E0A\u9650\u3002",
  maxExportRefs: "\u5BFC\u51FA\u6761\u6570\u4E0A\u9650",
  maxExportRefsHint: "\u5355\u6B21\u5BFC\u51FA\u6700\u591A\u5305\u542B\u7684\u6587\u732E\u6761\u6570\u3002",
  maxBrowseResults: "\u6D4F\u89C8\u7ED3\u679C\u4E0A\u9650",
  maxBrowseResultsHint: "\u5355\u6B21\u6D4F\u89C8\u6700\u591A\u8FD4\u56DE\u7684\u6761\u76EE\u6570\u3002",
  maxChangesResults: "\u53D8\u66F4\u5217\u8868\u6761\u6570\u4E0A\u9650",
  maxChangesResultsHint: "\u53D8\u66F4\u5217\u8868\u6BCF\u6B21\u6700\u591A\u5217\u51FA\u7684\u6761\u6570\uFF08\u4EC5\u5F71\u54CD\u663E\u793A\uFF09\uFF1A\u5DEE\u5F02\u4ECD\u4F1A\u6574\u6BB5\u8BA1\u7B97\uFF0C\u7EDF\u8BA1\u7ED9\u51FA\u771F\u5B9E\u6570\u91CF\u3002",
  scopeListingTtlMs: "\u8303\u56F4\u5217\u8868\u7F13\u5B58\uFF08\u6BEB\u79D2\uFF09",
  scopeListingTtlMsHint: "\u96C6\u5408\u4E0E\u68C0\u7D22\u5217\u8868\u5728\u91CD\u65B0\u62C9\u53D6\u524D\u7684\u7F13\u5B58\u65F6\u957F\u3002",
  defaultStyle: "\u9ED8\u8BA4\u5F15\u6587\u6837\u5F0F",
  defaultStyleHint: "\u5F15\u6587\u4E0E\u53C2\u8003\u6587\u732E\u4F7F\u7528\u7684 CSL \u6837\u5F0F id\uFF08\u5982 apa\uFF09\u3002",
  defaultLocale: "\u9ED8\u8BA4\u5F15\u6587\u8BED\u8A00",
  defaultLocaleHint: "\u5F15\u6587\u4E0E\u53C2\u8003\u6587\u732E\u4F7F\u7528\u7684\u533A\u57DF\u8BBE\u7F6E\uFF08\u5982 en-US\uFF09\u3002",
  groupJobs: "\u540E\u53F0\u4EFB\u52A1",
  enableRunInBackground: "\u5141\u8BB8\u540E\u53F0\u4EFB\u52A1",
  enableRunInBackgroundHint: "\u5141\u8BB8\u6587\u732E\u5BFC\u51FA\u3001\u53D8\u66F4\u626B\u63CF\u7B49\u5DE5\u5177\u901A\u8FC7 run_in_background \u663E\u5F0F\u653E\u5165\u540E\u53F0\uFF1B\u8D85\u65F6\u81EA\u52A8\u63D0\u5347\u7531\u53E6\u4E00\u9879\u5355\u72EC\u63A7\u5236\u3002",
  promoteOnTimeout: "\u8D85\u65F6\u81EA\u52A8\u8F6C\u4E3A\u540E\u53F0\u4EFB\u52A1",
  promoteOnTimeoutHint: "\u5F53\u540C\u6B65\u7B49\u5F85\u8D85\u65F6\u65F6\uFF0C\u81EA\u52A8\u5C06\u8017\u65F6\u64CD\u4F5C\u8F6C\u4E3A\u540E\u53F0\u4EFB\u52A1\u7EE7\u7EED\u6267\u884C\u3002",
  foregroundWaitMs: "\u524D\u53F0\u7B49\u5F85\u8D85\u65F6 (\u6BEB\u79D2)",
  foregroundWaitMsHint: "\u540C\u6B65\u7B49\u5F85\u8017\u65F6\u64CD\u4F5C\u5B8C\u6210\u7684\u6700\u5927\u6BEB\u79D2\u6570\uFF0C\u8D85\u51FA\u540E\u8F6C\u5165\u540E\u53F0\u4EFB\u52A1\u3002",
  groupWeb: "\u6587\u732E\u6807\u7B7E",
  webEnabled: "\u663E\u793A\u6587\u732E\u6807\u7B7E",
  webEnabledHint: "\u5728\u4F1A\u8BDD\u9876\u90E8\u663E\u793A Zotero \u6587\u732E\u6807\u7B7E\uFF0C\u5305\u62EC\u6587\u732E\u3001\u76F8\u5173\u7247\u6BB5\u548C\u5BFC\u51FA\u3002",
  copy: "\u590D\u5236",
  copied: "\u5DF2\u590D\u5236",
  commandInputAria: "\u6307\u4EE4\u8F93\u5165",
  checking: "\u68C0\u67E5\u4E2D\u2026",
  statusUnavailable: "\u4E0D\u53EF\u7528",
  statusConnectedNote: "\u5DF2\u8FDE\u63A5\u5230 Zotero",
  detailsLabel: "\u8BCA\u65AD\u8BE6\u60C5",
  apiVersionLabel: "API \u7248\u672C",
  schemaVersionLabel: "Schema \u7248\u672C",
  zoteroVersionLabel: "Zotero \u7248\u672C",
  serverIdLabel: "\u670D\u52A1\u5668 ID",
  writeLabel: "\u5199\u5165",
  writeAuthorizedLabel: "\u5DF2\u542F\u7528\uFF0C\u5BC6\u94A5\u5DF2\u4FDD\u5B58",
  writeUnauthorizedLabel: "\u5DF2\u542F\u7528\uFF0C\u5C1A\u672A\u6388\u6743",
  writeDisabledLabel: "\u5DF2\u5173\u95ED",
  buildInfoLabel: "\u6784\u5EFA",
  diagnosisLabel: "\u8BCA\u65AD",
  diagnosisNotRunning: "\u672A\u68C0\u6D4B\u5230\u6B63\u5728\u8FD0\u884C\u7684 Zotero \u5BA2\u6237\u7AEF\u3002\u8BF7\u542F\u52A8 Zotero\uFF0C\u5E76\u5728 [\u8BBE\u7F6E -> \u9AD8\u7EA7] \u4E2D\u52FE\u9009\u201C\u5141\u8BB8\u6B64\u8BA1\u7B97\u673A\u4E0A\u7684\u5176\u4ED6\u5E94\u7528\u7A0B\u5E8F\u4E0E Zotero \u901A\u4FE1\u201D\uFF0C\u7136\u540E\u70B9\u51FB\u5237\u65B0\u91CD\u8BD5\u3002",
  diagnosisApiDisabled: "Zotero \u672C\u5730 API \u672A\u542F\u7528\u3002\u8BF7\u5728 Zotero \u7684 [\u8BBE\u7F6E -> \u9AD8\u7EA7] \u4E2D\u52FE\u9009\u201C\u5141\u8BB8\u6B64\u8BA1\u7B97\u673A\u4E0A\u7684\u5176\u4ED6\u5E94\u7528\u7A0B\u5E8F\u4E0E Zotero \u901A\u4FE1\u201D\uFF0C\u7136\u540E\u70B9\u51FB\u5237\u65B0\u91CD\u8BD5\u3002",
  diagnosisApiVersion: "\u672C\u5730 Zotero API \u7248\u672C\u4E0D\u517C\u5BB9\uFF0C\u672C\u63D2\u4EF6\u9700\u8981\u4E0E Zotero 7 \u53CA\u4EE5\u4E0A\u7248\u672C\u914D\u5408\u4F7F\u7528\u3002",
  diagnosisTimeout: "\u8FDE\u63A5\u672C\u5730 Zotero \u5B9E\u4F8B\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5 Zotero \u662F\u5426\u6B63\u5728\u54CD\u5E94\u6216\u7AEF\u53E3\u88AB\u5360\u7528\u3002",
  diagnosisNotComposed: "\u672C\u4F1A\u8BDD\u5C1A\u672A\u88C5\u8F7D Zotero \u63D2\u4EF6\u670D\u52A1\u3002\u8BF7\u5728\u63D2\u4EF6\u9875\u542F\u7528 dsh-zotero \u540E\u5237\u65B0\u3002",
  diagnosisProviderUnavailable: "\u914D\u7F6E\u7684 Zotero \u63D0\u4F9B\u65B9\u672A\u6CE8\u518C\u3002\u8BF7\u5230 [\u8BBE\u7F6E -> Zotero] \u68C0\u67E5\u63D0\u4F9B\u65B9 ID\u3002",
  diagnosisCapabilityUnavailable: "\u5F53\u524D Zotero \u63D0\u4F9B\u65B9\u4E0D\u652F\u6301\u8BE5\u80FD\u529B\u3002\u8BF7\u5207\u6362\u63D0\u4F9B\u65B9\u6216\u542F\u7528\u5BF9\u5E94\u529F\u80FD\u3002",
  diagnosisUnknown: "\u8FDE\u63A5\u5F02\u5E38",
  refresh: "\u5237\u65B0",
  lastCheckedLabel: "\u4E0A\u6B21\u68C0\u67E5",
  quickConfigTitle: "\u5E38\u7528\u5FEB\u901F\u8BBE\u7F6E",
  quickConfigHint: "\u5728\u6B64\u5FEB\u901F\u5F00\u5173\u6838\u5FC3\u529F\u80FD\u3002\u5B8C\u6574\u914D\u7F6E\u8BF7\u524D\u5F80 [\u8BBE\u7F6E -> Zotero]\u3002",
  detailSectionTitle: "\u670D\u52A1\u72B6\u6001\u4E0E\u4F7F\u7528\u6307\u5357",
  activationTitle: "\u542F\u7528 Zotero \u63D2\u4EF6",
  activationClose: "\u5173\u95ED\u65B0\u624B\u5F15\u5BFC",
  activationDescription: "\u5728\u8BA9\u667A\u80FD\u4F53\u68C0\u7D22\u548C\u5F15\u7528\u672C\u5730\u6587\u732E\u5E93\u524D\uFF0C\u8BF7\u786E\u4FDD\u5B8C\u6210\u4EE5\u4E0B\u51C6\u5907\u5DE5\u4F5C\uFF1A",
  activationStep1: "\u786E\u4FDD\u672C\u5730 Zotero \u5BA2\u6237\u7AEF (v7+) \u5904\u4E8E\u8FD0\u884C\u72B6\u6001\u3002",
  activationStep2: "\u5728 Zotero \u7684 [\u8BBE\u7F6E -> \u9AD8\u7EA7] \u4E2D\u52FE\u9009\u201C\u5141\u8BB8\u6B64\u8BA1\u7B97\u673A\u4E0A\u7684\u5176\u4ED6\u5E94\u7528\u7A0B\u5E8F\u4E0E Zotero \u901A\u4FE1\u201D\u3002",
  activationStep2Note: "\u82E5\u672A\u52FE\u9009\u6B64\u9879\uFF0C\u672C\u5730 API \u8BF7\u6C42\u5C06\u76F4\u63A5\u8FD4\u56DE 403 \u6743\u9650\u53D7\u963B\u9519\u8BEF\u3002",
  activationStatusLabel: "\u8FDE\u901A\u6027\u81EA\u68C0",
  activationReady: "\u5DF2\u8FDE\u63A5\u5230\u672C\u5730 Zotero\uFF0C\u670D\u52A1\u5C31\u7EEA\uFF01",
  activationReadyVersion: "\u5DF2\u8FDE\u63A5\u5230\u672C\u5730 Zotero ({version})\uFF0C\u670D\u52A1\u5C31\u7EEA\uFF01",
  activationLater: "\u7A0D\u540E\u8BBE\u7F6E",
  activationDetails: "\u524D\u5F80\u914D\u7F6E\u8BE6\u60C5",
  activationDone: "\u5B8C\u6210",
  activationCheckAgain: "\u91CD\u65B0\u68C0\u6D4B",
  tipsLabel: "\u4F7F\u7528\u5C0F\u8D34\u58EB",
  tipNoKey: "\u514D\u914D API Key\uFF1A\u76F4\u63A5\u4E0E\u672C\u673A Zotero \u901A\u4FE1\uFF0C\u6570\u636E\u4E0D\u7ECF\u8FC7\u4E91\u7AEF\u3002",
  tipFulltext: "\u5168\u6587\u68C0\u7D22\uFF1A\u5728 Zotero \u4E2D\u4E3A PDF \u5EFA\u7ACB\u7D22\u5F15\u540E\uFF0C\u667A\u80FD\u4F53\u53EF\u5F15\u7528\u539F\u6587\u7247\u6BB5\u3002",
  tipSettingsNav: "\u8FDE\u63A5\u3001\u9650\u5236\u4E0E\u5F15\u6587\u683C\u5F0F\u53EF\u5728 [\u8BBE\u7F6E -> Zotero] \u4E2D\u8C03\u6574\u3002",
  lensSources: "\u6587\u732E",
  lensExports: "\u5BFC\u51FA",
  lensBarLabel: "\u6587\u732E\u89C6\u56FE",
  filterBarLabel: "\u6587\u732E\u7B5B\u9009",
  inspectorTabsLabel: "\u6587\u732E\u8BE6\u60C5\u9762\u677F",
  panelOverview: "\u6982\u89C8",
  panelEvidence: "\u76F8\u5173\u7247\u6BB5",
  panelExports: "\u5BFC\u51FA",
  backToList: "\u8FD4\u56DE\u5217\u8868",
  selectionHiddenNote: "\u8FD9\u7BC7\u6587\u732E\u5728\u5F53\u524D\u7B5B\u9009\u4E0B\u88AB\u9690\u85CF\uFF1B\u8BE6\u60C5\u4ECD\u7136\u4FDD\u7559\u5728\u8FD9\u91CC\u3002",
  inspectorEmptyNote: "\u9009\u62E9\u4E00\u7BC7\u6587\u732E\u67E5\u770B\u8BE6\u60C5\u3002",
  scopeLine: "\u8303\u56F4",
  filterLine: "\u7B5B\u9009",
  modeLine: "\u6A21\u5F0F",
  modeMetadata: "\u5143\u6570\u636E",
  modeEverything: "\u5143\u6570\u636E\u4E0E\u5168\u6587",
  overviewScopeLibrary: "\u6587\u732E\u5E93",
  overviewScopePublications: "\u6211\u7684\u51FA\u7248\u7269",
  overviewScopeCollection: "\u5408\u96C6",
  overviewScopeSavedSearch: "\u4FDD\u5B58\u7684\u68C0\u7D22",
  searchDetailOpen: "\u67E5\u770B\u68C0\u7D22\u6761\u4EF6",
  searchDetailClose: "\u6536\u8D77\u68C0\u7D22\u6761\u4EF6",
  refLine: "ref",
  overviewNoSearch: "\u8FD9\u7BC7\u6587\u732E\u662F\u76F4\u63A5\u5F15\u7528\u7684\uFF0C\u4E0D\u662F\u901A\u8FC7\u68C0\u7D22\u83B7\u5F97\u3002",
  retrievalRunCount: "\u68C0\u7D22 {count} \u6B21",
  retrievalKeptCount: "\u4FDD\u7559 {count} \u6761",
  retrievalReportedCount: "\u62A5\u544A {count} \u6761",
  availabilityTitle: "\u6700\u8FD1\u4E00\u6B21\u5404\u68C0\u7D22\u6765\u6E90\u72B6\u6001",
  evidenceEntryLabel: "\u7247\u6BB5\u603B\u89C8 {count}",
  backToSources: "\u8FD4\u56DE\u6587\u732E",
  downloadArtifact: "\u4E0B\u8F7D",
  filterAll: "\u5168\u90E8",
  filterPdf: "PDF",
  filterRetrieved: "\u5DF2\u67E5",
  filterEvidence: "\u6709\u7247\u6BB5",
  filterExported: "\u5DF2\u5BFC\u51FA",
  filterIssues: "\u5F02\u5E38",
  filterClear: "\u6E05\u9664\u7B5B\u9009",
  filterEmptyNote: "\u8FD9\u4E2A\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u6587\u732E\u3002",
  filterScrollLeft: "\u5411\u5DE6\u6EDA\u52A8\u7B5B\u9009",
  filterScrollRight: "\u5411\u53F3\u6EDA\u52A8\u7B5B\u9009",
  omittedRowsNote: "\u53E6\u6709 {count} \u6761\u68C0\u7D22\u7ED3\u679C\u672A\u9010\u6761\u5217\u51FA\u3002",
  noSources: "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709 Zotero \u6587\u732E\u3002",
  searchFrom: '\u641C\u7D22 "{query}"',
  searchFromBrowse: "\u6D4F\u89C8\u68C0\u7D22",
  provenanceMismatch: "\u5C5E\u4E8E\u53E6\u4E00\u4E2A Zotero \u6570\u636E\u5E93",
  evidenceBadge: "\u7247\u6BB5 {count}",
  exportBadge: "\u5BFC\u51FA {count}",
  failedBadge: "\u5931\u8D25 {count}",
  runningBadge: "\u8FDB\u884C\u4E2D {count}",
  stoppedBadge: "\u5DF2\u505C\u6B62 {count}",
  badgePdf: "PDF",
  issuesBadge: "\u5F02\u5E38",
  bestAttachmentLabel: "\u6700\u4F73\u9644\u4EF6",
  localFile: "\u672C\u5730\u6587\u4EF6",
  linkedUrl: "\u94FE\u63A5\u5730\u5740",
  copyRef: "\u590D\u5236 ref",
  copyExport: "\u590D\u5236",
  copyCite: "\\cite{\u2026}",
  copyAll: "\u590D\u5236\u5168\u90E8",
  downloadAll: "\u4E0B\u8F7D\u5168\u90E8",
  unresolvedItemsNote: "\u53E6\u6709 {count} \u7BC7\u65E0\u6CD5\u5355\u72EC\u663E\u793A",
  downloadFull: "\u4E0B\u8F7D\u5B8C\u6574",
  askAboutItem: "\u95EE\u8FD9\u7BC7",
  askTemplate: "\u5173\u4E8E\u8FD9\u7BC7\u6587\u732E\uFF08{ref}\uFF09\uFF1A",
  citeTemplate: "\u628A\u8FD9\u7BC7\u6587\u732E\u4ECE Zotero \u5BFC\u51FA\u4E3A BibTeX\uFF1A{ref}",
  exportCitation: "\u5BFC\u51FA\u5F15\u7528",
  sourceAnnotation: "\u6279\u6CE8",
  sourceNote: "\u7B14\u8BB0",
  sourceAbstract: "\u6458\u8981",
  sourceFulltext: "\u5168\u6587",
  pageLabel: "\u7B2C{label}\u9875",
  matchedInText: "\u547D\u4E2D\u539F\u6587",
  matchedInComment: "\u547D\u4E2D\u6279\u6CE8",
  truncatedPreview: "(\u622A\u65AD)",
  retrievedMultiple: "\u7ECF {count} \u6B21\u68C0\u7D22\u53D6\u5F97",
  coverageLabel: "\u7D22\u5F15\u8986\u76D6",
  coveragePages: "{indexed}/{total} \u9875",
  coverageChars: "{indexed}/{total} \u5B57\u7B26",
  coverageComplete: " \xB7 \u5DF2\u5B8C\u6574",
  coverageIncomplete: " \xB7 \u672A\u5B8C\u6574",
  countOfReturned: "\u5171 {total} \u6761\uFF0C\u5217\u51FA {shown} \u6761",
  budgetLimitedNote: "\u7ED3\u679C\u53D7\u5168\u5C40\u9884\u7B97\u9650\u5236\u3002",
  availReturned: "\u8FD4\u56DE {count} \u6761\u5339\u914D",
  availUnavailable: "\u8BE5\u6765\u6E90\u4E0D\u53EF\u7528",
  availNoMatch: "\u6CA1\u6709\u8FD4\u56DE\u5339\u914D",
  evidenceRetrievedNone: "\u8FD9\u6B21\u6CA1\u6709\u627E\u5230\u76F8\u5173\u7247\u6BB5\u3002",
  evidenceNotRetrieved: "\u8FD8\u6CA1\u6709\u67E5\u8FC7\u8FD9\u7BC7\u6587\u732E\u7684\u5185\u5BB9\u3002\u5411 Agent \u63D0\u95EE\u8FD9\u7BC7\u6587\u732E\u540E\uFF0C\u76F8\u5173\u7247\u6BB5\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002",
  evidenceReportedNoPreview: "\u5404\u6B21\u68C0\u7D22\u5171\u62A5\u544A {count} \u6761\u76F8\u5173\u7247\u6BB5\uFF0C\u672A\u4FDD\u7559\u9884\u89C8\u3002",
  evidenceEmptyNote: "\u8FD8\u6CA1\u6709\u76F8\u5173\u7247\u6BB5\u3002\u5411 Agent \u63D0\u95EE\u67D0\u7BC7\u6587\u732E\u7684\u5185\u5BB9\u540E\uFF0C\u627E\u5230\u7684\u6458\u8981\u3001\u6279\u6CE8\u3001\u7B14\u8BB0\u6216\u5168\u6587\u7247\u6BB5\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  exportsEmptyNote: "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u6210\u529F\u5BFC\u51FA\u3002",
  exportsIncompleteNote: "\u672A\u5B8C\u6210\u7684\u5BFC\u51FA\u64CD\u4F5C\uFF1A{counts}",
  formatCitation: "\u5F15\u6587",
  formatBibliography: "\u53C2\u8003\u6587\u732E\u8868",
  formatUnknown: "\u5BFC\u51FA",
  exportRefCount: "{count} \u6761\u6587\u732E",
  exportRefsOmitted: "\u53E6\u6709 {count} \u6761\u672A\u5217\u51FA",
  openInZotero: "\u5728 Zotero \u4E2D\u6253\u5F00",
  openPdf: "\u6253\u5F00 PDF",
  openAnnotation: "\u6253\u5F00\u6279\u6CE8",
  instanceUnverified: "\u65E0\u6CD5\u9A8C\u8BC1\u5F53\u524D Zotero \u5B9E\u4F8B",
  openUnverifiedNote: "\uFF08{detail}\uFF09",
  availabilityEntry: "{source}\uFF1A{detail}",
  starterFind: "\u627E\u6587\u732E\u2026",
  starterFindTemplate: "\u5E2E\u6211\u5728 Zotero \u6587\u732E\u5E93\u91CC\u68C0\u7D22\u8FD9\u4E2A\u4E3B\u9898\u7684\u6587\u732E\uFF1A",
  starterCompare: "\u6BD4\u8F83\u9009\u4E2D\u7684\u6587\u732E\u2026",
  starterCompareTemplate: "\u6BD4\u8F83\u4E0B\u9762\u51E0\u7BC7 Zotero \u6587\u732E\uFF1A",
  starterEvidence: "\u67E5\u627E\u76F8\u5173\u7247\u6BB5\u2026",
  starterEvidenceTemplate: "\u5728\u8FD9\u7BC7\u6587\u732E\u4E2D\u67E5\u627E\u76F8\u5173\u7247\u6BB5\uFF0C\u95EE\u9898\u662F\uFF1A",
  starterExportSelected: "\u5BFC\u51FA\u9009\u4E2D\u6761\u76EE\u7684\u5F15\u7528\u2026",
  starterExportSelectedTemplate: "\u628A\u4E0B\u9762\u51E0\u7BC7\u4ECE\u6211\u7684 Zotero \u5E93\u5BFC\u51FA\u4E3A\u5F15\u7528\uFF1A",
  toolTitleSearch: "Zotero \u68C0\u7D22\u6587\u732E",
  toolTitleRetrieve: "Zotero \u63D0\u53D6\u8BC1\u636E",
  toolTitleExport: "Zotero \u5BFC\u51FA\u5F15\u6587",
  toolTitleGet: "Zotero \u6587\u732E\u8BE6\u60C5",
  toolTitleChildren: "Zotero \u5B50\u9879\u4E0E\u9644\u4EF6",
  toolTitleAttachment: "Zotero \u9644\u4EF6",
  toolTitleCreateNote: "Zotero \u521B\u5EFA\u7B14\u8BB0",
  toolTitleUpdateItemTags: "Zotero \u66F4\u65B0\u6761\u76EE\u6807\u7B7E",
  toolTitleUpdateItemCollections: "Zotero \u66F4\u65B0\u6761\u76EE\u5408\u96C6",
  toolTitleCreateCollection: "Zotero \u521B\u5EFA\u5408\u96C6",
  toolTitleDeleteCollection: "Zotero \u5220\u9664\u5408\u96C6",
  toolTitleCreateItem: "Zotero \u521B\u5EFA\u6761\u76EE",
  toolTitleUpdateItem: "Zotero \u66F4\u65B0\u6761\u76EE",
  toolTitleDeleteLibraryTags: "Zotero \u5220\u9664\u5168\u5E93\u6807\u7B7E",
  toolTitleBrowse: "Zotero \u6D4F\u89C8\u5206\u7C7B",
  toolTitleChanges: "Zotero \u540C\u6B65\u8BB0\u5F55",
  toolRunning: "\u6267\u884C\u4E2D\u2026",
  toolFailed: "\u6267\u884C\u5931\u8D25",
  toolStopped: "\u5DF2\u4E2D\u65AD",
  toolDeclined: "\u5199\u64CD\u4F5C\u672A\u83B7\u6279\u51C6\uFF0C\u5DF2\u53D6\u6D88\u6267\u884C",
  toolUnverified: "\u5DF2\u63D0\u4EA4\u4F46\u672A\u6838\u9A8C\uFF0C\u8BF7\u52FF\u91CD\u8BD5",
  toolUnverifiedDetail: "Zotero \u7684\u539F\u59CB\u8FD4\u56DE",
  toolSummaryJobPending: "\u4ECD\u5728\u8FD0\u884C\u4E2D\uFF0C\u6682\u65F6\u6CA1\u6709\u53EF\u8BFB\u7684\u7ED3\u679C\u3002",
  toolOmittedPassages: "\u53E6\u6709 {count} \u6761\u8BC1\u636E\u7247\u6BB5\u672A\u5728\u6B64\u5217\u51FA\u3002",
  toolInspect: "\u68C0\u67E5\u8C03\u7528",
  toolSearchRunning: "\u6B63\u5728\u68C0\u7D22 Zotero \u6587\u732E\u5E93\u2026",
  toolRetrieveRunning: "\u6B63\u5728\u63D0\u53D6\u6587\u732E\u8BC1\u636E\u2026",
  toolExportRunning: "\u6B63\u5728\u5BFC\u51FA\u5F15\u6587\u2026",
  toolSummaryFound: "\u627E\u5230 {count} \u7BC7\u6587\u732E",
  toolSummaryFoundWithNotes: "\u627E\u5230 {count} \u7BC7\u6587\u732E (+{notes} \u6761\u7B14\u8BB0)",
  toolSummaryEvidence: "\u63D0\u53D6 {count} \u6761\u8BC1\u636E\u7247\u6BB5",
  toolSummaryExport: "\u5BFC\u51FA {format} ({count} \u7BC7)",
  toolSummaryItem: "{title} ({year})",
  toolSummaryChildren: "{count} \u4E2A\u5B50\u5BF9\u8C61",
  toolSummaryAttachment: "\u9644\u4EF6: {title}",
  toolSummaryCreateNote: '\u5DF2\u521B\u5EFA\u7B14\u8BB0 "{title}"',
  toolSummaryUpdateItemTags: "\u5DF2\u66F4\u65B0\u6807\u7B7E\uFF1A\u65B0\u589E {added}\uFF0C\u79FB\u9664 {removed}",
  toolSummaryUpdateItemTagsRequested: "\u8BF7\u6C42\u4FEE\u6539 {count} \u4E2A\u6807\u7B7E",
  toolNoTagsChanged: "\u6807\u7B7E\u96C6\u5408\u5DF2\u4E00\u81F4\uFF0C\u672A\u5199\u5165\u4EFB\u4F55\u5185\u5BB9",
  toolSummaryUpdateItemCollections: "\u5DF2\u66F4\u65B0\u5F52\u5C5E\uFF1A\u65B0\u589E {added}\uFF0C\u79FB\u9664 {removed}",
  toolSummaryUpdateItemCollectionsRequested: '\u8BF7\u6C42\u52A0\u5165\u5408\u96C6 "{name}"',
  toolNoMembershipChanged: "\u5F52\u5C5E\u5DF2\u4E00\u81F4\uFF0C\u672A\u5199\u5165\u4EFB\u4F55\u5185\u5BB9",
  toolSummaryCreateCollection: '\u5DF2\u521B\u5EFA\u5408\u96C6 "{name}"',
  toolSummaryDeleteCollection: '\u5DF2\u5220\u9664\u5408\u96C6 "{name}"',
  toolSummaryCreateItem: '\u5DF2\u521B\u5EFA\u6761\u76EE "{title}"',
  toolSummaryUpdateItem: "\u5DF2\u66F4\u65B0\u6761\u76EE {ref}",
  toolSummaryDeleteLibraryTags: "\u5DF2\u5220\u9664\u5168\u5E93\u6807\u7B7E {count} \u4E2A",
  toolSummaryDeleteLibraryTagsRequested: "\u8BF7\u6C42\u5220\u9664\u5168\u5E93\u6807\u7B7E {count} \u4E2A",
  toolSummaryBrowseKind: "\u6B63\u5728\u6D4F\u89C8 {kind}",
  toolSummaryBrowsePage: "\u6D4F\u89C8 {kind}\uFF1A{returned} / {total}",
  toolBrowseNextPage: "\u66F4\u591A\u7ED3\u679C\u4ECE offset {offset} \u5F00\u59CB",
  toolSummaryChanges: "\u540C\u6B65\u53D8\u66F4: {count} \u6761",
  toolChangesItems: "\u6761\u76EE",
  toolChangesChildItems: "\u5B50\u5BF9\u8C61",
  toolChangesTrashedItems: "\u56DE\u6536\u7AD9\u4E2D\u7684\u6761\u76EE",
  toolChangesCollections: "\u5408\u96C6",
  toolChangesSavedSearches: "\u4FDD\u5B58\u7684\u68C0\u7D22",
  toolChangesFulltext: "\u91CD\u65B0\u7D22\u5F15\u7684\u5168\u6587",
  toolChangesCursor: "\u6E38\u6807",
  toolChangesCursorValue: "\u7248\u672C {version}\uFF0C\u5B9E\u4F8B {serverId}",
  toolChangesRange: "\u533A\u95F4\uFF1A\u7248\u672C {from} \u2192 {to}",
  toolChangesRangeUnknown: "\u672A\u6838\u9A8C\u7684\u7EC8\u70B9",
  toolChangesNoCursor: "\u672C\u6B21\u8BFB\u53D6\u6CA1\u6709\u7ED9\u51FA\u6E38\u6807\uFF0C\u56E0\u6B64\u533A\u95F4\u5E76\u672A\u843D\u5B9A\uFF0C\u4E5F\u4E0D\u80FD\u4F5C\u4E3A\u7EED\u8BFB\u8D77\u70B9\u3002",
  toolChangesWithheld: "\u672C\u6B21\u8BFB\u53D6\u672A\u8986\u76D6\u7684\u5BF9\u8C61",
  toolChangesFulltextCaveat: "\u7D22\u5F15\u7248\u672C\u4F7F\u7528\u72EC\u7ACB\u8BA1\u6570\u5668\uFF0C\u56E0\u6B64\u8FD9\u4E9B\u884C\u53EA\u662F\u4E00\u4EFD\u6E05\u5355\u3002",
  withheldNotServed: "\u5F53\u524D Zotero \u6784\u5EFA\u672A\u63D0\u4F9B",
  withheldRangeNotCovered: "\u65E9\u4E8E\u8BE5\u6784\u5EFA\u4FDD\u7559\u7684\u53D8\u66F4\u5386\u53F2",
  withheldUnreadable: "\u8FD4\u56DE\u5185\u5BB9\u65E0\u6CD5\u8BFB\u53D6",
  withheldRemedyPermanent: "\u65E0\u9700\u5904\u7406\uFF0C\u8BE5\u6784\u5EFA\u672C\u5C31\u4E0D\u62A5\u544A\u8FD9\u4E00\u9879",
  withheldRemedyRebaseline: "\u91CD\u65B0\u53D6\u4E00\u4E2A\u57FA\u7EBF\uFF0C\u624D\u80FD\u4ECE\u6B64\u523B\u5F00\u59CB\u8DDF\u8E2A",
  withheldRemedyRerun: "\u91CD\u65B0\u6267\u884C\u8FD9\u6B21\u8C03\u7528",
  toolDeletedTitle: "\u5220\u9664: {count}",
  toolDeletedNone: "\u5220\u9664: \u6B64\u533A\u95F4\u5185\u6CA1\u6709\u5220\u9664\u3002",
  toolDeletedItems: "\u5DF2\u5220\u9664\u7684\u6761\u76EE",
  toolDeletedCollections: "\u5DF2\u5220\u9664\u7684\u5408\u96C6",
  toolDeletedSavedSearches: "\u5DF2\u5220\u9664\u7684\u4FDD\u5B58\u68C0\u7D22",
  toolDeletedTags: "\u5DF2\u5220\u9664\u7684\u6807\u7B7E",
  toolDeletedOther: "\u5176\u4ED6\u5DF2\u5220\u9664\u5BF9\u8C61",
  toolSummaryJobBackground: "\u540E\u53F0\u4EFB\u52A1 {jobId}",
  toolSummaryJobPromoted: "\u5DF2\u8F6C\u4E3A\u540E\u53F0\u4EFB\u52A1 {jobId}",
  toolParentItem: "\u6240\u5C5E\u7236\u6761\u76EE",
  toolTags: "\u6807\u7B7E",
  toolChildrenNotes: "\u7B14\u8BB0",
  toolChildrenAnnotations: "\u6279\u6CE8",
  toolChildrenAttachments: "\u9644\u4EF6",
  toolChildrenNone: "\u6CA1\u6709\u8FD9\u4E00\u7C7B\u5B50\u5BF9\u8C61",
  toolNoResults: "\u672A\u68C0\u7D22\u5230\u5339\u914D\u7ED3\u679C",
  toolDefaultNoteTitle: "\u7B14\u8BB0",
  badgeSuccess: "\u6210\u529F",
  badgeNoOp: "\u65E0\u53D8\u66F4",
  badgeUnreported: "\u7ED3\u679C\u672A\u62A5\u544A",
  commandChecking: "\u6B63\u5728\u63A2\u6D4B\u8FDE\u63A5\u2026",
  commandFailed: "\u6267\u884C\u5931\u8D25",
  statusServerIdUnreported: "\u672A\u62A5\u544A\uFF08\u5F53\u524D\u6784\u5EFA\u4E0D\u652F\u6301\u6570\u636E\u5E93\u6807\u8BC6\uFF09",
  statusLocalApiAddress: "\u672C\u5730 API \u5730\u5740"
};

// src/client/index.ts
var NS = "zotero";
var inject = ["locale", "slots", "remote", "configForms", "uiConversation"];
function mountedNamespace(ctx) {
  return ctx.reflect.get("remote.zotero");
}
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-zotero: page dictionaries");
  registerZoteroToolviews(ctx);
  ctx.effect(
    () => ctx.uiConversation.events.register(zoteroCommandInputDefinition),
    "dsh-zotero: zotero command-input projection"
  );
  ctx.slots.inject(
    "conversation.chat.node",
    () => ctx.slots.register(
      {
        name: "conversation.chat.node",
        key: "zotero-command-input",
        locale: NS
      },
      ZoteroCommandInputView
    )
  );
  const form = ctx.configForms.get(ZOTERO_SETTINGS_NAMESPACE);
  const card = new ZoteroCardController(form);
  ctx.effect(
    () => () => {
      card.dispose();
    },
    "dsh-zotero: card form"
  );
  const t = ctx.locale.bind(NS);
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "zotero",
        order: 25,
        label: () => t("nav"),
        locale: NS,
        inject: () => card.inject()
      },
      ZoteroSettingsSection
    )
  );
  let mountState = "mount not attempted";
  let inFlightProbe;
  const probe = () => {
    if (inFlightProbe !== void 0) return inFlightProbe;
    const face = mountedNamespace(ctx);
    if (face === void 0) {
      return Promise.reject(
        new Error(`dsh-zotero: the zotero Remote namespace is not mounted (${mountState})`)
      );
    }
    const task = face.status().finally(() => {
      if (inFlightProbe === task) inFlightProbe = void 0;
    });
    inFlightProbe = task;
    return task;
  };
  ctx.slots.inject(
    "plugins.bundle.activation",
    () => ctx.slots.register(
      {
        name: "plugins.bundle.activation",
        key: ZOTERO_REMOTE_PACKAGE,
        inject: () => ({ t, probe })
      },
      ZoteroActivationGuide
    )
  );
  ctx.slots.inject(
    "plugins.bundle.config",
    () => ctx.slots.register(
      {
        name: "plugins.bundle.config",
        key: ZOTERO_REMOTE_PACKAGE,
        inject: () => zoteroQuickConfigFace(form, t)
      },
      ZoteroBundleQuickConfig
    )
  );
  ctx.slots.inject(
    "plugins.detail.section",
    () => ctx.slots.register(
      {
        name: "plugins.detail.section",
        id: "zotero-status",
        inject: () => ({ t, probe })
      },
      ZoteroPluginDetailSection
    )
  );
  ctx.slots.inject(
    "conversation.chat.commandview",
    () => ctx.slots.register(
      {
        name: "conversation.chat.commandview",
        key: "zotero",
        locale: NS,
        inject: () => ({ probe })
      },
      ZoteroCommandCard
    )
  );
  let tabDispose;
  const tabT = ctx.locale.bind(NS);
  const sync = () => {
    const snapshot = form.getSnapshot();
    const enabled = snapshot.status !== "ready" || snapshot.value?.webEnabled !== false;
    if (enabled && tabDispose === void 0) {
      tabDispose = ctx.slots.inject(
        "conversation.view",
        () => ctx.slots.register(
          {
            name: "conversation.view",
            id: "zotero",
            order: 30,
            locale: NS,
            label: () => tabT("nav"),
            // Read through the mutable binding, so a probe that arrives after
            // the tab was mounted is the one the strip actually calls.
            inject: () => ({ status: () => probe() })
          },
          SourcesTab
        )
      );
    } else if (!enabled && tabDispose !== void 0) {
      tabDispose();
      tabDispose = void 0;
    }
  };
  ctx.effect(() => {
    const unsubscribe = form.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      tabDispose?.();
      tabDispose = void 0;
    };
  }, "dsh-zotero: conversation tab");
  ctx.effect(async () => {
    let dispose;
    mountState = "mount pending";
    try {
      dispose = await ctx.remote.$mount(ZOTERO_REMOTE);
      mountState = "mount settled";
    } catch (error) {
      mountState = `mount failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error("dsh-zotero: mounting the zotero Remote namespace failed", error);
    }
    if (mountedNamespace(ctx) === void 0) {
      console.error(`dsh-zotero: ${mountState}`);
    }
    return async () => {
      await dispose?.();
    };
  }, "dsh-zotero: remote");
}
return module.exports; } });
//# sourceMappingURL=client.js.map
