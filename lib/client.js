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
var ZoteroCommandInputView_default = { "stack": "ytsxFq_stack", "row": "ytsxFq_row", "bubble": "ytsxFq_bubble" };

// src/client/ZoteroCommandInputView.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function ZoteroCommandInputView({ node, t }) {
  const data = node.data;
  const split = data.text.search(/\s/u);
  const head = split === -1 ? data.text : data.text.slice(0, split);
  const rest = split === -1 ? "" : data.text.slice(split);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: ZoteroCommandInputView_default.row, "data-command-input": "", role: "group", "aria-label": t("commandInputAria"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: ZoteroCommandInputView_default.stack, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: ZoteroCommandInputView_default.bubble, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.ReferenceChip, { appearance: "command", label: head, title: head }),
    rest !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.UserTextRun, { text: rest })
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
var style2 = `.WtsoIq_diagnosisBox{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);flex-direction:column;gap:4px;padding:8px 10px;display:flex}.WtsoIq_diagnosisHead{align-items:center;gap:6px;display:flex}.WtsoIq_diagnosisLabelText{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);font-weight:600}.WtsoIq_diagnosisCode{font:var(--dsw-font-markdown-code-block-small);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-markdown-inline-code);color:var(--dsw-alias-state-warn-label);padding:1px 4px}.WtsoIq_diagnosisMessage{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/DiagnosisBox.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/DiagnosisBox.module.css");
  tag.textContent = style2;
  document.head.appendChild(tag);
}
var DiagnosisBox_default = { "diagnosisBox": "WtsoIq_diagnosisBox", "diagnosisHead": "WtsoIq_diagnosisHead", "diagnosisLabelText": "WtsoIq_diagnosisLabelText", "diagnosisCode": "WtsoIq_diagnosisCode", "diagnosisMessage": "WtsoIq_diagnosisMessage" };

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
function probeStateOf(status) {
  return {
    loading: false,
    data: status,
    error: status.connected ? void 0 : status.diagnosis
  };
}
function useZoteroProbe(probe, options) {
  const [state, setState] = (0, import_react.useState)(
    () => options?.initialData !== void 0 ? probeStateOf(options.initialData) : { loading: options?.initialAutoRun === true }
  );
  const [settled, setSettled] = (0, import_react.useState)(false);
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
        setState(probeStateOf(res.value));
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
      if (!unmountedRef.current) setSettled(true);
    }
  }, [probe]);
  (0, import_react.useEffect)(() => {
    if (options?.initialAutoRun && probe) {
      void runProbe();
    }
  }, [options?.initialAutoRun, probe, runProbe]);
  return { state, settled, runProbe };
}

// src/client/components/write-label.ts
function writeStatusLabel(write, t) {
  if (write === void 0) return "-";
  if (!write.enabled) return t("writeDisabledLabel");
  return write.authorized ? t("writeAuthorizedLabel") : t("writeUnauthorizedLabel");
}

// src/client/ZoteroCommandCard.module.css
var style3 = `.cZkZ3W_root{flex-direction:column;display:flex}.cZkZ3W_summarySep{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-label-caption);flex:none;width:2px;height:2px;margin:0 8px}.cZkZ3W_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);transition:color .12s var(--ds-ease-in-out);flex:auto;overflow:hidden}.cZkZ3W_summary[data-error=true]{color:var(--dsw-alias-state-error-primary)}.cZkZ3W_summaryBadge{align-items:center;gap:6px;display:inline-flex}.cZkZ3W_bodyWrap{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);flex-direction:column;gap:12px;padding:8px 12px 12px 28px;display:flex}.cZkZ3W_cardGrid{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;display:grid}.cZkZ3W_cardItem{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));flex-direction:column;gap:3px;padding:8px 12px;display:flex}.cZkZ3W_itemLabel{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.4px;font-weight:500}.cZkZ3W_itemValue{font:var(--dsw-font-markdown-code);color:var(--dsw-alias-label-primary);word-break:break-all;font-weight:500}.cZkZ3W_actionsRow{justify-content:flex-start;align-items:center;gap:8px;margin-top:2px;display:flex}.cZkZ3W_errorBody{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap;margin:0;padding:8px 12px}@media (prefers-reduced-motion:reduce){.cZkZ3W_summary{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/ZoteroCommandCard.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/ZoteroCommandCard.module.css");
  tag.textContent = style3;
  document.head.appendChild(tag);
}
var ZoteroCommandCard_default = { "actionsRow": "cZkZ3W_actionsRow", "summary": "cZkZ3W_summary", "bodyWrap": "cZkZ3W_bodyWrap", "errorBody": "cZkZ3W_errorBody", "summarySep": "cZkZ3W_summarySep", "itemLabel": "cZkZ3W_itemLabel", "root": "cZkZ3W_root", "summaryBadge": "cZkZ3W_summaryBadge", "itemValue": "cZkZ3W_itemValue", "cardGrid": "cZkZ3W_cardGrid", "cardItem": "cZkZ3W_cardItem" };

// src/client/ZoteroCommandCard.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function ZoteroCommandCard({
  node,
  t,
  probe,
  useProjection
}) {
  const [expanded, setExpanded] = (0, import_react2.useState)(false);
  const { state: probeState, runProbe } = useZoteroProbe(probe);
  const projected = useProjection("zoteroStatus");
  const outcome = node.outcome;
  const isRunning = outcome === null;
  const isError = outcome?.kind === "error";
  const rawText = outcome?.text ?? "";
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
  const effectiveStatus = (0, import_react2.useMemo)(() => {
    const raw = probeState.data ?? projected;
    return {
      connected: probeState.data !== void 0 ? probeState.data.connected : probeState.error !== void 0 ? false : projected?.connected === true,
      endpoint: raw?.endpoint,
      version: raw?.zoteroVersion,
      apiVersion: raw?.apiVersion,
      schemaVersion: raw?.schemaVersion,
      serverId: raw?.serverId,
      serverIdUnreported: probeState.data !== void 0 ? probeState.data.serverId === void 0 : probeState.error === void 0 && projected != null && projected.serverId === void 0,
      write: raw?.write,
      diagnosis: probeState.error ?? probeState.data?.diagnosis ?? projected?.diagnosis
    };
  }, [probeState.data, probeState.error, projected]);
  const hasFacts = probeState.data !== void 0 || projected != null;
  const headerPrefix = (0, import_react2.useMemo)(() => {
    let dotState = "done";
    if (probeState.loading || isRunning) {
      dotState = "ongoing";
    } else if (isError || !effectiveStatus.connected) {
      dotState = "error";
    }
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.summaryBadge, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: dotState, size: 10 }) });
  }, [probeState.loading, isRunning, isError, effectiveStatus.connected]);
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
    if (hasFacts) {
      const summaryText = effectiveStatus.connected ? `${effectiveStatus.version ?? t("badgeSuccess")}` : `${effectiveStatus.diagnosis ?? t("statusUnavailable")}`;
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
    hasFacts,
    effectiveStatus.connected,
    effectiveStatus.version,
    effectiveStatus.diagnosis,
    rawText,
    t
  ]);
  const writeDisplay = (0, import_react2.useMemo)(
    () => writeStatusLabel(effectiveStatus.write, t),
    [effectiveStatus.write, t]
  );
  const expandable = !isRunning && (hasFacts || rawText !== "");
  const open = expanded && expandable;
  const body = (0, import_react2.useMemo)(() => {
    if (!open) return null;
    const actions = probe === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: ZoteroCommandCard_default.actionsRow, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      import_dsh_client_ui_primitives2.Button,
      {
        variant: "outline",
        size: "sm",
        icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutlineRegular, { size: 14 }),
        disabled: probeState.loading,
        onClick: handleRecheck,
        children: probeState.loading ? t("checking") : t("refresh")
      }
    ) });
    const endpointRow = effectiveStatus.endpoint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("statusLocalApiAddress") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: effectiveStatus.endpoint })
    ] });
    if (!hasFacts || isError && node.outcome?.sourceEventSeq === void 0 && probeState.data === void 0) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.bodyWrap, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { className: ZoteroCommandCard_default.errorBody, children: rawText }),
        actions
      ] });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.bodyWrap, "data-zotero-command-card-body": true, children: [
      effectiveStatus.connected ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardGrid, children: [
        endpointRow,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("zoteroVersionLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: effectiveStatus.version ?? "-" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("apiVersionLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: ZoteroCommandCard_default.itemValue, children: [
            effectiveStatus.apiVersion ?? "-",
            effectiveStatus.schemaVersion !== void 0 ? ` (${t("schemaVersionLabel")}: ${effectiveStatus.schemaVersion})` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("serverIdLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: effectiveStatus.serverId ?? (effectiveStatus.serverIdUnreported ? t("statusServerIdUnreported") : "-") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemLabel, children: t("writeLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: ZoteroCommandCard_default.itemValue, children: writeDisplay })
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: ZoteroCommandCard_default.cardGrid, children: [
        endpointRow,
        effectiveStatus.diagnosis && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DiagnosisBox, { diagnosis: effectiveStatus.diagnosis, t })
      ] }),
      actions
    ] });
  }, [
    open,
    hasFacts,
    isError,
    node.outcome?.sourceEventSeq,
    effectiveStatus,
    writeDisplay,
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
var import_react5 = require("react");
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/ZoteroSettingsForm.tsx
var import_react4 = require("react");
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
var style4 = `.Km44ca_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.Km44ca_field+.Km44ca_field{border-top:.5px solid var(--dsw-alias-border-l2)}.Km44ca_badges{align-items:center;gap:8px;display:inline-flex}.Km44ca_reset{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0}@media (hover:hover){.Km44ca_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}}.Km44ca_reset:disabled{cursor:default}.Km44ca_hint{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0}.Km44ca_toggleRow{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}@media (pointer:coarse){.Km44ca_field input{font-size:16px}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/fields.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/fields.module.css");
  tag.textContent = style4;
  document.head.appendChild(tag);
}
var fields_default = { "badges": "Km44ca_badges", "field": "Km44ca_field", "hint": "Km44ca_hint", "reset": "Km44ca_reset", "toggleRow": "Km44ca_toggleRow" };

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
        import_dsh_client_ui_primitives3.Checkbox,
        {
          checked: enabled,
          disabled: props.disabled,
          label: props.label,
          onChange: (next) => {
            if (next && risk !== void 0 && !enabled) {
              gate.request();
              return;
            }
            stage(next);
          }
        }
      ),
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

// src/client/helpers/form-scope.ts
function asFormScope(form) {
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener) => form.subscribe(listener),
    mutate: (ops, expectedRevision) => form.mutate(
      ops.map(
        (op) => op.op === "set" ? { op: "set", path: [...op.path], value: op.value } : { op: "unset", path: [...op.path] }
      ),
      expectedRevision
    )
  };
}

// src/client/helpers/settings-fields.ts
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

// src/client/zotero-card-controller.ts
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
  { key: "maxSearchResults", kind: "number", group: "groupSearchQuery" },
  { key: "maxNoteScanRecords", kind: "number", group: "groupSearchQuery" },
  { key: "searchConcurrency", kind: "number", group: "groupSearchQuery" },
  { key: "graphConcurrency", kind: "number", group: "groupSearchQuery" },
  { key: "retrieveAttachmentCap", kind: "number", group: "groupSearchQuery" },
  { key: "maxEvidenceChars", kind: "number", group: "groupSearchEvidence" },
  { key: "maxEvidencePassages", kind: "number", group: "groupSearchEvidence" },
  { key: "maxDetailChars", kind: "number", group: "groupSearchEvidence" },
  { key: "maxNoteBodyChars", kind: "number", group: "groupSearchEvidence" },
  { key: "maxNoteChars", kind: "number", group: "groupSearchEvidence" },
  { key: "maxNoteRecords", kind: "number", group: "groupSearchEvidence" },
  { key: "maxAnnotationRecords", kind: "number", group: "groupSearchEvidence" },
  { key: "maxAttachmentRecords", kind: "number", group: "groupSearchEvidence" },
  { key: "fulltextChunkWords", kind: "number", group: "groupSearchEvidence" },
  { key: "maxFulltextChars", kind: "number", group: "groupSearchEvidence" },
  { key: "maxResponseBytes", kind: "number", group: "groupOutput" },
  { key: "maxExportChars", kind: "number", group: "groupOutput" },
  { key: "maxExportRefs", kind: "number", group: "groupOutput" },
  { key: "maxBrowseResults", kind: "number", group: "groupOutput" },
  { key: "maxChangesResults", kind: "number", group: "groupOutput" },
  { key: "defaultStyle", kind: "text", group: "groupDefaults" },
  { key: "defaultLocale", kind: "text", group: "groupDefaults" },
  { key: "enableRunInBackground", kind: "boolean", group: "groupJobs" },
  { key: "promoteOnTimeout", kind: "boolean", group: "groupJobs" },
  { key: "foregroundWaitMs", kind: "number", group: "groupJobs" },
  { key: "debug", kind: "boolean", group: "groupDiagnostics" }
];
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
var SETTINGS_TABS = [
  {
    id: "features",
    labelKey: "tabFeatures",
    groupKeys: ["groupWeb", "groupWrite", "groupDefaults"]
  },
  {
    id: "connection",
    labelKey: "tabConnection",
    groupKeys: ["groupConnection"]
  },
  {
    id: "search",
    labelKey: "tabSearch",
    groupKeys: ["groupSearchQuery", "groupSearchEvidence"]
  },
  {
    id: "library",
    labelKey: "tabLibrary",
    groupKeys: []
  },
  {
    id: "scholarly",
    labelKey: "tabScholarly",
    groupKeys: []
  },
  {
    id: "advanced",
    labelKey: "tabAdvanced",
    groupKeys: ["groupOutput", "groupJobs", "groupDiagnostics"]
  }
];
var BOOLEAN_FIELD_KEYS = new Set(
  FIELD_SPECS.filter((spec) => spec.kind === "boolean").map((spec) => spec.key)
);
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
var style5 = `.KieWbq_tabsContainer{margin:16px 0 20px}.KieWbq_tabPanel{flex-direction:column;display:flex}.KieWbq_tabPanel[hidden]{display:none!important}.KieWbq_group{flex-direction:column;gap:12px;padding:16px 0;display:flex}.KieWbq_group:first-child{padding-top:0}.KieWbq_groupHeader{flex-direction:column;gap:4px;display:flex}.KieWbq_groupHeading{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);margin:0;font-weight:600}.KieWbq_groupNote{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0}.KieWbq_fields{flex-direction:column;display:flex}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/ZoteroSettingsForm.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/ZoteroSettingsForm.module.css");
  tag.textContent = style5;
  document.head.appendChild(tag);
}
var ZoteroSettingsForm_default = { "groupNote": "KieWbq_groupNote", "group": "KieWbq_group", "tabPanel": "KieWbq_tabPanel", "tabsContainer": "KieWbq_tabsContainer", "groupHeading": "KieWbq_groupHeading", "fields": "KieWbq_fields", "groupHeader": "KieWbq_groupHeader" };

// src/client/ZoteroSettingsForm.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var FIELDS_BY_GROUP = new Map(
  FIELD_GROUPS.map(({ key, fields }) => [key, fields])
);
function ZoteroSettingsForm(props) {
  const { t, state, actions, showTabs = true } = props;
  const [internalTab, setInternalTab] = (0, import_react4.useState)("features");
  const activeTab = props.activeTab ?? internalTab;
  const handleTabChange = (next) => {
    const tabId = next;
    if (props.onTabChange) {
      props.onTabChange(tabId);
    } else {
      setInternalTab(tabId);
    }
  };
  const tabItems = (0, import_react4.useMemo)(
    () => SETTINGS_TABS.filter((tab) => tab.id !== "scholarly").map((tab) => ({
      value: tab.id,
      label: t(tab.labelKey),
      id: `zotero-tab-${tab.id}`,
      panelId: `zotero-panel-${tab.id}`
    })),
    [t]
  );
  const groupFieldsOf = (group) => FIELDS_BY_GROUP.get(group) ?? [];
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    showTabs && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: ZoteroSettingsForm_default.tabsContainer, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      import_dsh_client_ui_primitives5.SegmentedTabs,
      {
        items: tabItems,
        value: activeTab,
        onChange: handleTabChange,
        label: t("configTabsLabel")
      }
    ) }),
    SETTINGS_TABS.filter((tab) => tab.groupKeys.length > 0).map((tab) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "div",
      {
        role: "tabpanel",
        id: `zotero-panel-${tab.id}`,
        "aria-labelledby": `zotero-tab-${tab.id}`,
        hidden: activeTab !== tab.id,
        className: ZoteroSettingsForm_default.tabPanel,
        children: tab.groupKeys.map(
          (group) => renderGroupSection(t, state, actions, group, groupFieldsOf(group))
        )
      },
      tab.id
    ))
  ] });
}
function renderGroupSection(t, state, actions, groupKey, fields) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: ZoteroSettingsForm_default.group, "aria-label": t(groupKey), children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: ZoteroSettingsForm_default.groupHeader, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { className: ZoteroSettingsForm_default.groupHeading, children: t(groupKey) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: ZoteroSettingsForm_default.groupNote, children: t(`${groupKey}Desc`) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: ZoteroSettingsForm_default.fields, children: fields.map((key) => field(t, state, actions, key)) })
  ] }, groupKey);
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

// src/client/ScholarlySettingsForm.tsx
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/scholarly-form-controller.ts
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
var SCHOLARLY_NUMERIC_KEYS = ["maxResults", "maxContentChars"];
function secretFieldSpec(field2) {
  return {
    field: field2,
    format: () => "",
    parse: (text) => {
      const trimmed = text.trim();
      if (trimmed === "") return void 0;
      return { kind: "set", value: trimmed };
    }
  };
}
function fieldSpecs2() {
  return [
    (0, import_dsh_client_ui_primitives6.settingsTextField)("email"),
    secretFieldSpec("s2Key"),
    secretFieldSpec("ncbiKey"),
    secretFieldSpec("openalexKey"),
    (0, import_dsh_client_ui_primitives6.settingsNumberField)("maxResults"),
    (0, import_dsh_client_ui_primitives6.settingsNumberField)("maxContentChars")
  ];
}
var ScholarlyFormController = class {
  constructor(form) {
    this.form = form;
    const scope = asFormScope(form);
    this.model = new import_dsh_client_ui_primitives6.SettingsFormModel(scope, fieldSpecs2());
    this.store = this.model.bind(() => this.project());
  }
  form;
  model;
  store;
  /** Current snapshot projected from model state. */
  project() {
    const shell = this.model.shell();
    const snapshot = this.form.getSnapshot();
    const disabled = !shell.writable || shell.saving;
    const secretStateOf = (key) => {
      const field2 = this.model.field(key);
      const val = snapshot.value?.[key];
      const userVal = snapshot.user?.[key];
      const hasStored = typeof val === "string" && val.trim() !== "" || typeof userVal === "string" && userVal.trim() !== "";
      return {
        text: field2.text,
        configured: hasStored,
        disabled
      };
    };
    return {
      ...shell,
      email: this.model.field("email"),
      maxResults: this.model.field("maxResults"),
      maxContentChars: this.model.field("maxContentChars"),
      s2Key: secretStateOf("s2Key"),
      ncbiKey: secretStateOf("ncbiKey"),
      openalexKey: secretStateOf("openalexKey")
    };
  }
  inject() {
    const actions = this.model.actions();
    return {
      hooks: {
        scholarlyCard: this.store
      },
      edit: actions.edit,
      resetField: actions.resetField,
      save: actions.save,
      discard: actions.discard
    };
  }
  dispose() {
    this.model.dispose();
  }
};

// src/client/ScholarlySettingsForm.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var NUMERIC_FIELDS = new Set(SCHOLARLY_NUMERIC_KEYS);
function ScholarlySettingsForm(props) {
  const { t, state, actions } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: ZoteroSettingsForm_default.group, "aria-label": t("groupScholarlyAuth"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsForm_default.groupHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { className: ZoteroSettingsForm_default.groupHeading, children: t("groupScholarlyAuth") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: ZoteroSettingsForm_default.groupNote, children: t("groupScholarlyAuthDesc") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsForm_default.fields, children: [
        renderValueField(t, state, actions, "email"),
        renderSecretField(t, state, actions, "s2Key"),
        renderSecretField(t, state, actions, "ncbiKey"),
        renderSecretField(t, state, actions, "openalexKey")
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: ZoteroSettingsForm_default.group, "aria-label": t("groupScholarlyLimits"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsForm_default.groupHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { className: ZoteroSettingsForm_default.groupHeading, children: t("groupScholarlyLimits") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: ZoteroSettingsForm_default.groupNote, children: t("groupScholarlyLimitsDesc") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: ZoteroSettingsForm_default.fields, children: [
        renderValueField(t, state, actions, "maxResults"),
        renderValueField(t, state, actions, "maxContentChars")
      ] })
    ] })
  ] });
}
function renderValueField(t, state, actions, key) {
  const field2 = state[key];
  const labelKey = `scholarly${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const hintKey = `${labelKey}Hint`;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
    import_dsh_client_ui_primitives7.SettingsValueField,
    {
      id: `scholarly-settings-${key}`,
      label: t(labelKey),
      hint: t(hintKey),
      text: field2.text,
      overridden: field2.overridden,
      invalid: field2.invalid,
      overriddenLabel: t("overridden"),
      resetLabel: t("reset"),
      invalidLabel: t("invalidNumber"),
      disabled: !state.writable || state.saving,
      numeric: NUMERIC_FIELDS.has(key),
      onEdit: (text) => actions.edit(key, text),
      onReset: () => actions.resetField(key)
    },
    key
  );
}
function renderSecretField(t, state, actions, key) {
  const secret = state[key];
  const labelKey = `scholarly${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const hintKey = `${labelKey}Hint`;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
    import_dsh_client_ui_primitives7.SettingsSecretField,
    {
      id: `scholarly-settings-${key}`,
      label: t(labelKey),
      hint: t(hintKey),
      text: secret.text,
      configured: secret.configured,
      stateLabel: secret.configured ? t("secretConfigured") : t("secretNotConfigured"),
      disabled: !state.writable || state.saving,
      onEdit: (text) => actions.edit(key, text)
    },
    key
  );
}

// src/client/LibrarySettingsForm.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function LibrarySettingsForm(props) {
  const { t, state, actions } = props;
  const disabled = !state.writable || state.saving;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: ZoteroSettingsForm_default.group, "aria-label": t("groupLibrarySidebar"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: ZoteroSettingsForm_default.groupHeader, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { className: ZoteroSettingsForm_default.groupHeading, children: t("groupLibrarySidebar") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: ZoteroSettingsForm_default.groupNote, children: t("groupLibrarySidebarDesc") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: ZoteroSettingsForm_default.fields, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      BooleanField,
      {
        label: t("rightSidebarEnabled"),
        hint: t("rightSidebarHint"),
        text: state.rightSidebarEnabled.text,
        overridden: state.rightSidebarEnabled.overridden,
        overriddenLabel: t("overridden"),
        resetLabel: t("reset"),
        disabled,
        onEdit: (text) => actions.edit("rightSidebarEnabled", text),
        onReset: () => actions.resetField("rightSidebarEnabled")
      }
    ) })
  ] });
}

// src/client/ZoteroSettingsSection.module.css
var style6 = `.TLM_wW_page{flex-direction:column;width:100%;display:flex}.TLM_wW_tabsContainer{margin:0 0 20px}.TLM_wW_tabPanel{flex-direction:column;display:flex}.TLM_wW_note{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);margin:0}.TLM_wW_tabPanel[hidden]{display:none!important}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/ZoteroSettingsSection.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/ZoteroSettingsSection.module.css");
  tag.textContent = style6;
  document.head.appendChild(tag);
}
var ZoteroSettingsSection_default = { "note": "TLM_wW_note", "tabsContainer": "TLM_wW_tabsContainer", "page": "TLM_wW_page", "tabPanel": "TLM_wW_tabPanel" };

// src/client/ZoteroSettingsSection.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function formLabels(t) {
  return {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving")
  };
}
function ZoteroSettingsSection(props) {
  const { t } = props;
  const [activeTab, setActiveTab] = (0, import_react5.useState)("features");
  const zoteroState = props.useZoteroCard((snapshot) => snapshot);
  const scholarlyState = props.useScholarlyCard ? props.useScholarlyCard((snapshot) => snapshot) : void 0;
  const libraryState = props.useLibraryCard ? props.useLibraryCard((snapshot) => snapshot) : void 0;
  const labels = (0, import_react5.useMemo)(() => formLabels(t), [t]);
  const tabItems = (0, import_react5.useMemo)(
    () => SETTINGS_TABS.map((tab) => ({
      value: tab.id,
      label: t(tab.labelKey),
      id: `zotero-tab-${tab.id}`,
      panelId: `zotero-panel-${tab.id}`
    })),
    [t]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: ZoteroSettingsSection_default.page, "data-zotero-config-page": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: ZoteroSettingsSection_default.tabsContainer, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      import_dsh_client_ui_primitives8.SegmentedTabs,
      {
        items: tabItems,
        value: activeTab,
        onChange: (tab) => setActiveTab(tab),
        label: t("configTabsLabel")
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: ZoteroSettingsSection_default.tabPanel, hidden: activeTab === "scholarly" || activeTab === "library", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      import_dsh_client_ui_primitives8.SettingsForm,
      {
        labels,
        state: zoteroState,
        onSave: props.save,
        onDiscard: props.discard,
        children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          ZoteroSettingsForm,
          {
            t,
            state: zoteroState,
            actions: props,
            activeTab,
            showTabs: false
          }
        )
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: ZoteroSettingsSection_default.tabPanel, hidden: activeTab !== "library", children: props.library && libraryState?.available ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      import_dsh_client_ui_primitives8.SettingsForm,
      {
        labels,
        state: libraryState,
        onSave: props.library.save,
        onDiscard: props.library.discard,
        children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "div",
          {
            role: "tabpanel",
            id: "zotero-panel-library",
            "aria-labelledby": "zotero-tab-library",
            className: ZoteroSettingsSection_default.tabPanel,
            children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(LibrarySettingsForm, { t, state: libraryState, actions: props.library })
          }
        )
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "div",
      {
        role: "tabpanel",
        id: "zotero-panel-library",
        "aria-labelledby": "zotero-tab-library",
        className: ZoteroSettingsSection_default.tabPanel,
        children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: ZoteroSettingsSection_default.note, role: "status", children: t("libraryDisabled") })
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: ZoteroSettingsSection_default.tabPanel, hidden: activeTab !== "scholarly", children: props.scholarly && scholarlyState?.available ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      import_dsh_client_ui_primitives8.SettingsForm,
      {
        labels,
        state: scholarlyState,
        onSave: props.scholarly.save,
        onDiscard: props.scholarly.discard,
        children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "div",
          {
            role: "tabpanel",
            id: "zotero-panel-scholarly",
            "aria-labelledby": "zotero-tab-scholarly",
            className: ZoteroSettingsSection_default.tabPanel,
            children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ScholarlySettingsForm, { t, state: scholarlyState, actions: props.scholarly })
          }
        )
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "div",
      {
        role: "tabpanel",
        id: "zotero-panel-scholarly",
        "aria-labelledby": "zotero-tab-scholarly",
        className: ZoteroSettingsSection_default.tabPanel,
        children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: ZoteroSettingsSection_default.note, role: "status", children: t("scholarlyDisabled") })
      }
    ) })
  ] });
}

// src/client/ScholarlySettingsSection.tsx
var import_react6 = require("react");
var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime9 = require("react/jsx-runtime");
function ScholarlySettingsSection(props) {
  const { t, view } = props;
  const state = props.useScholarlyCard((snapshot) => snapshot);
  const labels = (0, import_react6.useMemo)(() => formLabels(t), [t]);
  if (view === "summary") {
    return t("tabScholarlyDesc");
  }
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: ZoteroSettingsSection_default.page, "data-scholarly-config-page": true, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.SettingsForm, { labels, state, onSave: props.save, onDiscard: props.discard, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ScholarlySettingsForm, { t, state, actions: props }) }) });
}

// src/client/components/SourcesTab.tsx
var import_react20 = require("react");

// node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js
var FILE_ADDRESS_PREFIX = "dsh-resource://file/";
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}
function encodePath(path) {
  return path.split("/").map(encodeSegment).join("/");
}
function sessionFileAddress(sessionId, path) {
  const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}
function isWindowsStylePath(value) {
  return /^[A-Za-z]:[/\\]/.test(value) || value.startsWith("\\\\");
}
function isAbsoluteWorkspacePath(path) {
  return path.startsWith("/") || isWindowsStylePath(path);
}
function fileAddressFor(sessionId, cwd, path) {
  const normalized = path.replace(/\\/g, "/");
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd === void 0 ? "" : cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
  if (root !== "" && normalized.startsWith(`${root}/`)) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  return sessionFileAddress(sessionId, normalized);
}

// src/evidence-item.ts
var EVIDENCE_SOURCES = /* @__PURE__ */ new Set([
  "annotation",
  "note",
  "fulltext",
  "abstract"
]);
function isEvidenceSource(source) {
  return EVIDENCE_SOURCES.has(source);
}

// node_modules/@deepseek-ai/dsh-util-values/lib/index.js
var SIMPLE_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
var CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
function isWhitespace(c) {
  return c === " " || c === "\n" || c === "\r" || c === "	";
}
function isHex(c) {
  return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
}
var PartialArguments = class PartialArguments2 {
  /** The view of a call with no arguments available. */
  static EMPTY = PartialArguments2.fromObject({});
  /**
  * View finished argument text without scanning it until a reader asks.
  * @param text - the complete argument JSON text.
  * @returns a sealed view.
  */
  static fromText(text) {
    const view = new PartialArguments2();
    view.append(text);
    view.sealed = true;
    return view;
  }
  /**
  * View an already parsed argument payload, such as a PTC dispatch object.
  * @param value - the parsed argument value.
  * @returns a sealed view; a non-object payload has no fields.
  */
  static fromObject(value) {
    const view = new PartialArguments2();
    view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    view.sealed = true;
    return view;
  }
  /**
  * The source: text so far or a parsed object, plus whether it can still grow.
  * These are the only enumerable fields, so two views over the same source
  * compare equal structurally however far each has been read.
  */
  chunks = [];
  object;
  sealed = false;
  #ends = [];
  #size = 0;
  #consumed = 0;
  #mode = "root";
  #escape = false;
  #keyStart = 0;
  #keyEscaped = false;
  #key = "";
  #current = null;
  #nestedEnds = [];
  #nestedInString = false;
  #invalidAt;
  #invalidValue = false;
  #entries = /* @__PURE__ */ new Map();
  #order = [];
  #reads = /* @__PURE__ */ new Map();
  /** Whether this view rejects further appends; does not scan text or register reads. */
  get isSealed() {
    return this.sealed;
  }
  /** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
  get invalid() {
    this.scan();
    return this.#mode === "invalid" || this.#invalidValue;
  }
  /**
  * Retain streamed argument text without scanning or comparing observed answers.
  * @param fragment - the text following every fragment appended before.
  */
  append(fragment) {
    if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
    if (fragment.length === 0) return;
    this.chunks.push(fragment);
    this.#size += fragment.length;
    this.#ends.push(this.#size);
  }
  /**
  * Reconcile a streamed prefix with authoritative complete text without joining the fragments.
  * @param text - the final argument text, which replaces missing or conflicting deltas.
  * @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
  */
  settle(text) {
    if (this.object !== void 0 || text.length !== this.#size) return PartialArguments2.fromText(text);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!text.startsWith(chunk, offset)) return PartialArguments2.fromText(text);
      offset += chunk.length;
    }
    this.chunks = text.length === 0 ? [] : [text];
    this.#ends = text.length === 0 ? [] : [text.length];
    this.sealed = true;
    return this;
  }
  /**
  * Compare observed answers and advance their publication baseline. Unread views remain unscanned.
  * @returns whether any observed answer changed since its first read or the preceding refresh.
  */
  refresh() {
    if (this.#reads.size === 0) return false;
    this.scan();
    let changed = false;
    let completions = false;
    for (const read of this.#reads.values()) {
      if (read.completion) {
        completions = true;
        continue;
      }
      changed = this.refreshRead(read) || changed;
    }
    if (completions) {
      for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
    }
    if (this.sealed) this.#reads.clear();
    return changed;
  }
  refreshRead(read) {
    const now = read.answer();
    if (Object.is(now, read.last)) return false;
    read.last = now;
    return true;
  }
  /**
  * Check whether no further fields can arrive.
  * @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
  */
  closed() {
    return this.remember("closed", "", () => this.closedNow());
  }
  /**
  * List discovered fields in first-appearance order.
  * @returns top-level keys seen so far, in first-appearance order.
  */
  keys() {
    return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
  }
  /**
  * Check whether a top-level field has appeared.
  * @param key - argument name.
  * @returns whether the field has appeared (a string opened or another value began).
  */
  has(key) {
    return this.remember("has", key, () => this.hasNow(key));
  }
  /**
  * Check whether a field's closing delimiter has arrived, without validating its contents.
  * @param key - argument name.
  * @returns whether its delimiter arrived and no content reader has reported an error for this value.
  */
  complete(key) {
    return this.remember("complete", key, () => this.completeNow(key));
  }
  /**
  * Read string length without materializing its text.
  * @param key - argument name.
  * @param options - change granularity for a streaming string.
  * @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
  */
  stringLength(key, options) {
    const step = Math.max(1, Math.floor(options?.step ?? 1));
    const offset = options?.offset ?? 0;
    return this.remember(`length:${step}:${offset}`, key, () => this.lengthNow(key), (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step));
  }
  /**
  * Check a string against a decoded UTF-16 length limit without materializing it.
  * @param key - argument name.
  * @param maxLength - decoded UTF-16 limit, floored to at least zero.
  * @returns whether the string is longer than the limit; false when absent or not a string.
  */
  stringExceeds(key, maxLength) {
    const limit = Math.max(0, Math.floor(maxLength));
    return this.remember(`exceeds:${limit}`, key, () => (this.lengthNow(key, limit + 1) ?? 0) > limit);
  }
  /**
  * Read a decoded string, including a streaming prefix.
  * @param key - argument name.
  * @returns the string field's decoded text so far; undefined when absent or not a string.
  */
  text(key) {
    return this.remember("text", key, () => this.textNow(key));
  }
  /**
  * Read at most the first decoded UTF-16 units of a string.
  * @param key - argument name.
  * @param maxLength - maximum decoded UTF-16 length, floored to at least one.
  * @returns the bounded string prefix; undefined when absent or not a string.
  */
  textPrefix(key, maxLength) {
    const limit = Math.max(1, Math.floor(maxLength));
    return this.remember(`prefix:${limit}`, key, () => this.textPrefixNow(key, limit));
  }
  /**
  * Read a completed non-string argument.
  * @param key - argument name.
  * @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
  */
  value(key) {
    return this.remember("value", key, () => this.valueNow(key));
  }
  /** Answer a question and, on a streaming view, remember it for change detection. */
  remember(kind, key, read, comparison) {
    this.scan();
    const result = read();
    if (!this.sealed) {
      const id = `${kind}/${key}`;
      if (!this.#reads.has(id)) this.#reads.set(id, {
        completion: kind === "complete",
        answer: comparison === void 0 ? read : () => comparison(read()),
        last: comparison === void 0 ? result : comparison(result)
      });
    }
    return result;
  }
  closedNow() {
    return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
  }
  keysNow() {
    return this.object === void 0 ? this.#order : Object.keys(this.object);
  }
  hasNow(key) {
    return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
  }
  completeNow(key) {
    if (this.object !== void 0) return Object.hasOwn(this.object, key);
    const entry = this.#entries.get(key);
    return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
  }
  lengthNow(key, limit = Number.POSITIVE_INFINITY) {
    if (this.object !== void 0) {
      const field2 = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field2 === "string" ? field2.length : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
    const read = entry.length ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
    this.readString(entry, read, limit, false);
    return read.length;
  }
  textNow(key) {
    if (this.object !== void 0) {
      const field2 = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field2 === "string" ? field2 : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
      let text;
      try {
        text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
      } catch (_error) {
      }
      if (text !== void 0) entry.text = {
        at: entry.end,
        length: text.length,
        text
      };
    }
    const read = entry.text ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
    this.readString(entry, read, Number.POSITIVE_INFINITY, true);
    return read.text;
  }
  textPrefixNow(key, maxLength) {
    if (this.object !== void 0) {
      const field2 = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field2 === "string" ? field2.slice(0, maxLength) : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
    let read = prefixes.get(maxLength);
    if (read === void 0) {
      read = {
        at: entry.start,
        length: 0,
        text: ""
      };
      prefixes.set(maxLength, read);
    }
    this.readString(entry, read, maxLength, true);
    return read.text;
  }
  valueNow(key) {
    if (this.object !== void 0) {
      if (!Object.hasOwn(this.object, key)) return void 0;
      const field2 = this.object[key];
      return typeof field2 === "string" ? void 0 : field2;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
    if (entry.parsed === void 0) try {
      entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
    } catch (_error) {
      entry.invalid = true;
      this.#invalidValue = true;
    }
    return entry.parsed;
  }
  chunkAt(at) {
    let low = 0;
    let high = this.#ends.length;
    while (low < high) {
      const mid = low + high >>> 1;
      if (this.#ends[mid] <= at) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  /** Materialize only a requested range, never the cumulative source. */
  slice(start, end) {
    if (start >= end) return "";
    const first = this.chunkAt(start);
    const last = this.chunkAt(end - 1);
    const base = first === 0 ? 0 : this.#ends[first - 1];
    if (first === last) return this.chunks[first].slice(start - base, end - base);
    const parts = [this.chunks[first].slice(start - base)];
    for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
    parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
    return parts.join("");
  }
  readString(entry, read, limit, materialize) {
    const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
    if (!entry.needsDecoding) {
      const length = Math.min(end - read.at, limit - read.length);
      if (length <= 0) return;
      if (materialize) read.text += this.slice(read.at, read.at + length);
      read.at += length;
      read.length += length;
      return;
    }
    let chunkIndex = this.chunkAt(read.at);
    while (read.at < end && read.length < limit) {
      const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
      const chunk = this.chunks[chunkIndex];
      const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
      const boundary = remaining.search(CONTENT_ESCAPE);
      const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
      if (length > 0) {
        if (materialize) read.text += remaining.slice(0, length);
        read.at += length;
        read.length += length;
        if (read.at === base + chunk.length) chunkIndex++;
        continue;
      }
      const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
      let decoded;
      let width = 2;
      if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
      if (remaining[0] === "\\" && type === "u") {
        const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
        let valid = true;
        for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
        if (valid) {
          if (hex.length < 4 && entry.end < 0) return;
          if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
        }
        width = 6;
      } else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
      if (decoded === void 0) {
        entry.invalidAt = read.at;
        this.#invalidValue = true;
        return;
      }
      if (materialize) read.text += decoded;
      read.length++;
      read.at += width;
      while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
    }
  }
  /** Locate new field ranges without decoding or parsing their contents. */
  scan() {
    if (this.object !== void 0 || this.#consumed === this.#size) return;
    for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
      const pending = this.chunks[i];
      const base = i === 0 ? 0 : this.#ends[i - 1];
      for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
        if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
          const end = this.stringBoundary(pending, index);
          this.#consumed += end - index;
          index = end;
          if (index === pending.length) break;
        }
        this.step(pending[index], this.#consumed);
        this.#consumed++;
      }
    }
  }
  /** Only raw quotes and their preceding backslash runs can terminate a string. */
  stringBoundary(fragment, start) {
    let at = start;
    while (true) {
      const quote = fragment.indexOf('"', at);
      const end = quote < 0 ? fragment.length : quote;
      if (this.#mode === "string") {
        const entry = this.#current;
        if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
      }
      let slashStart = end;
      while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
      const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
      this.#escape = quote < 0 && escaped;
      if (quote < 0 || !escaped) return end;
      at = quote + 1;
    }
  }
  step(c, at) {
    switch (this.#mode) {
      case "root":
        if (isWhitespace(c)) return;
        if (c === "{") {
          this.#mode = "key-or-end";
          return;
        }
        this.fail();
        return;
      case "key-or-end":
        if (isWhitespace(c)) return;
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key-only":
        if (isWhitespace(c)) return;
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key":
        this.stepKey(c, at);
        return;
      case "colon":
        if (isWhitespace(c)) return;
        if (c === ":") {
          this.#mode = "value";
          return;
        }
        this.fail();
        return;
      case "value":
        this.beginValue(c, at);
        return;
      case "string": {
        const entry = this.#current;
        entry.end = at;
        this.#current = null;
        this.#mode = "comma-or-end";
        return;
      }
      case "scalar":
        this.stepScalar(c, at);
        return;
      case "nested":
        this.stepNested(c, at);
        return;
      case "comma-or-end":
        if (isWhitespace(c)) return;
        if (c === ",") {
          this.#mode = "key-only";
          return;
        }
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        this.fail();
        return;
      case "closed":
        if (isWhitespace(c)) return;
        this.fail();
        return;
      /* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
      case "invalid":
        return;
      /* v8 ignore next 2 -- Every scanner mode has a handler above. */
      default:
        assertNever(this.#mode);
    }
  }
  fail() {
    this.#invalidAt = this.#consumed;
    this.#mode = "invalid";
    this.#current = null;
  }
  beginKey(at) {
    this.#mode = "key";
    this.#keyStart = at + 1;
    this.#keyEscaped = false;
    this.#escape = false;
  }
  stepKey(c, at) {
    if (c < " ") {
      this.fail();
      return;
    }
    if (this.#escape) {
      this.#escape = false;
      return;
    }
    if (c === "\\") {
      this.#escape = true;
      this.#keyEscaped = true;
      return;
    }
    if (c !== '"') return;
    const raw = this.slice(this.#keyStart, at);
    if (this.#keyEscaped) try {
      this.#key = JSON.parse(`"${raw}"`);
    } catch (_error) {
      this.fail();
      return;
    }
    else this.#key = raw;
    this.#mode = "colon";
  }
  open(entry) {
    if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
    this.#entries.set(this.#key, entry);
    this.#current = entry;
  }
  beginValue(c, at) {
    if (isWhitespace(c)) return;
    if (c === '"') {
      this.open({
        kind: "string",
        start: at + 1,
        end: -1,
        needsDecoding: false,
        invalidAt: void 0,
        length: void 0,
        text: void 0,
        prefixes: void 0
      });
      this.#escape = false;
      this.#mode = "string";
      return;
    }
    if (c === "}" || c === "," || c === ":" || c === "]") {
      this.fail();
      return;
    }
    this.open({
      kind: "value",
      start: at,
      end: -1,
      parsed: void 0,
      invalid: false
    });
    if (c === "{" || c === "[") {
      this.#mode = "nested";
      this.#nestedEnds = [c === "{" ? "}" : "]"];
      this.#nestedInString = false;
      this.#escape = false;
      return;
    }
    this.#mode = "scalar";
  }
  stepScalar(c, at) {
    if (c !== "," && c !== "}" && !isWhitespace(c)) return;
    this.closeValue(at);
    this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
  }
  stepNested(c, at) {
    if (this.#nestedInString) {
      this.#nestedInString = false;
      return;
    }
    if (c === '"') {
      this.#nestedInString = true;
      return;
    }
    if (c === "{" || c === "[") {
      this.#nestedEnds.push(c === "{" ? "}" : "]");
      return;
    }
    if (c === "}" || c === "]") {
      if (this.#nestedEnds.pop() !== c) {
        this.fail();
        return;
      }
      if (this.#nestedEnds.length === 0) {
        this.closeValue(at + 1);
        this.#mode = "comma-or-end";
      }
    }
  }
  closeValue(end) {
    const entry = this.#current;
    entry.end = end;
    this.#current = null;
  }
};
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}

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
function refFieldsOf(ref) {
  const fields = REF_PATTERN.exec(ref)?.groups;
  if (fields === void 0) return void 0;
  return {
    ...fields.serverId !== void 0 ? { serverId: fields.serverId } : {},
    libraryType: fields.libraryType,
    libraryId: fields.libraryId,
    kind: fields.kind,
    key: fields.key
  };
}
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
function isToolRunning(block) {
  return !isSettledTool(block);
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
function argsViewOf(block) {
  return block.args;
}
function textArg(view, key) {
  return view.text(key);
}
function valueArg(view, key) {
  return view.value(key);
}
function listArg(view, key) {
  const value = valueArg(view, key);
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
function boolArg(view, key) {
  return valueArg(view, key) === true;
}
function recordArg(view, key) {
  const value = valueArg(view, key);
  return isRecord(value) ? value : null;
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
    if (!isEvidenceSource(source)) return null;
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
function formatTime(dateOrMs, includeSeconds = true) {
  const date = typeof dateOrMs === "number" ? new Date(dateOrMs) : dateOrMs;
  const pad = (value) => String(value).padStart(2, "0");
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  if (!includeSeconds) {
    return `${hours}:${minutes}`;
  }
  return `${hours}:${minutes}:${pad(date.getSeconds())}`;
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

// src/client/sources/decoders.ts
function detailOmittedOf(meta) {
  return boolField(meta, "detailOmitted") === true;
}
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
    rows,
    detailOmitted: detailOmittedOf(meta)
  };
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
  if (kind === "library") {
    const lib = decodeSupportedLibrary(value["library"]);
    if (lib === null) return null;
    return { kind: "library", library: lib };
  }
  if (kind === "publications") {
    const lib = decodeSupportedLibrary(value["library"]);
    if (lib === null || lib.type !== "user") return null;
    return { kind: "publications", library: lib };
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
    noteMatches: numberField(meta, "noteMatches") ?? null,
    scope: decodeResolvedScope(meta["scope"]),
    library: decodeSupportedLibrary(meta["library"]),
    detailOmitted: detailOmittedOf(meta)
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
    annotationsPreview: childPreviewsOf(meta["annotationsPreview"]),
    detailOmitted: detailOmittedOf(meta)
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
  return {
    itemType: stringField(meta, "itemType") ?? null,
    sections,
    detailOmitted: detailOmittedOf(meta)
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
    sourceAvailability: decodeSourceAvailability(meta["sourceAvailability"]),
    detailOmitted: detailOmittedOf(meta)
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
    ref: stringField(meta, "ref") ?? null,
    detailOmitted: detailOmittedOf(meta)
  };
}

// src/client/sources/export-decoder.ts
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
function exportMetaOf(meta) {
  return {
    format: stringField(meta, "format") ?? null,
    style: stringField(meta, "style") ?? null,
    locale: stringField(meta, "locale") ?? null,
    refs: stringArrayOf(meta["refs"]),
    refsOmitted: numberField(meta, "refsOmitted") ?? 0,
    items: exportItemsOf(meta["items"]),
    detailOmitted: detailOmittedOf(meta)
  };
}

// src/client/sources/evidence-match.ts
function normalizeRefKey(ref) {
  return ref.split("?", 1)[0].toLowerCase();
}
function serverIdOf(ref) {
  const query = ref.split("?", 2)[1];
  if (query === void 0) return void 0;
  const match = /(?:^|&)server=([A-Za-z0-9_-]{1,64})(?:&|$)/.exec(query);
  return match?.[1];
}
function evidenceMatchOf(serverIds, currentServerId) {
  if (currentServerId === void 0 || serverIds.size === 0) return "unknown";
  for (const id of serverIds) {
    if (id !== currentServerId) return "mismatch";
  }
  return "verified";
}

// src/client/sources/reducer.ts
function emptyFacts() {
  return {
    reportedEvidenceCount: 0
  };
}
function emptyOperations() {
  return { running: 0, failed: 0, stopped: 0 };
}
function rawLibraryArg(args) {
  const libArg = recordArg(args, "library");
  if (libArg === null) return null;
  return { type: libArg["type"], id: libArg["id"] };
}
function searchIdentityOf(args, overrides) {
  if (args.invalid) return null;
  const query = textArg(args, "query") ?? "";
  const mode = textArg(args, "mode") === "everything" ? "everything" : "metadata";
  const itemTypes = normalizedListOf(listArg(args, "itemTypes"));
  const tags = normalizedListOf(listArg(args, "tags"));
  const tagMatch = textArg(args, "tagMatch") === "any" ? "any" : "all";
  const excludeTags = normalizedListOf(listArg(args, "excludeTags"));
  const includeTrashed = boolArg(args, "includeTrashed");
  const sort = textArg(args, "sort") ?? "";
  const direction = textArg(args, "direction") ?? "";
  const library = overrides?.resolvedLibrary ?? (() => {
    const raw = rawLibraryArg(args);
    if (raw !== null && (raw.type === "user" || raw.type === "group") && typeof raw.id === "number") {
      return { type: raw.type, id: raw.id };
    }
    return { type: "user", id: 0 };
  })();
  return JSON.stringify({
    query,
    mode,
    library,
    scope: overrides !== void 0 ? resolvedToSourceScope(overrides.resolvedScope) : scopeOf(valueArg(args, "scope")),
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
  if (scope.kind === "savedSearch") return { kind: "savedSearch", ref: scope.ref, name: scope.name };
  return { kind: "library", library: scope.library };
}
function refArgOf(args) {
  const ref = textArg(args, "ref");
  return ref === void 0 || ref === "" ? null : ref;
}
function exportRefsOf(metaView, args) {
  if (args.has("refs")) {
    const refs = args.value("refs");
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
  const pushEvidence = (draft, meta, callId, seq) => {
    const view = retrieveMetaOf(meta);
    if (view.items === null && view.count === null) return;
    if (!draft.successfulRetrieveCallIds.has(callId)) {
      draft.successfulRetrieveCallIds.add(callId);
      draft.retrievalSummary = {
        runCount: draft.successfulRetrieveCallIds.size,
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
    const args = argsViewOf(block);
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
          const scopeForEpisode = resolvedScope !== null ? resolvedToSourceScope(resolvedScope) : scopeOf(valueArg(args, "scope"));
          const libraryForEpisode = resolvedLibrary ?? (() => {
            const raw = rawLibraryArg(args);
            if (raw === null) return void 0;
            if (raw.type === "user" && raw.id === 0) return { type: "user", id: 0 };
            if (raw.type === "group" && typeof raw.id === "number" && Number.isSafeInteger(raw.id) && raw.id > 0) {
              return { type: "group", id: raw.id };
            }
            return void 0;
          })();
          const query = textArg(args, "query");
          lastEpisode = {
            identity,
            callId: block.callId,
            ...query !== void 0 && query !== "" ? { query } : {},
            mode: textArg(args, "mode") === "everything" ? "everything" : "metadata",
            scope: scopeForEpisode,
            ...libraryForEpisode ? { library: libraryForEpisode } : {},
            itemTypes: normalizedListOf(listArg(args, "itemTypes")),
            tags: normalizedListOf(listArg(args, "tags")),
            tagMatch: textArg(args, "tagMatch") === "any" ? "any" : "all",
            excludeTags: normalizedListOf(listArg(args, "excludeTags")),
            includeTrashed: boolArg(args, "includeTrashed"),
            returned: 0,
            omitted: 0,
            ...view.total === null ? {} : { total: view.total },
            ...view.noteMatches === null ? {} : { noteMatches: view.noteMatches },
            keys: /* @__PURE__ */ new Set()
          };
          episodes.push(lastEpisode);
        }
        lastEpisode.returned += view.returned ?? view.rows.length;
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
          pushEvidence(draft, meta, block.callId, seq);
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
    const searchRecord = {
      callId: episode.callId,
      ...episode.query === void 0 ? {} : { query: episode.query },
      mode: episode.mode,
      scope: episode.scope,
      ...episode.library ? { library: episode.library } : {},
      itemTypes: episode.itemTypes,
      tags: episode.tags,
      ...episode.tagMatch ? { tagMatch: episode.tagMatch } : {},
      excludeTags: episode.excludeTags,
      includeTrashed: episode.includeTrashed,
      returned: episode.returned,
      ...episode.total === void 0 ? {} : { total: episode.total },
      ...episode.noteMatches === void 0 ? {} : { noteMatches: episode.noteMatches }
    };
    for (const key of episode.keys) {
      byKey.get(key).searches.push(searchRecord);
    }
  }
  const currentServerId = options.currentServerId;
  const sources = [...byKey.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt).map((draft) => {
    const evidence = [...draft.evidence.values()].sort((a, b) => a.seq - b.seq).map((entry) => entry.passage);
    return {
      key: draft.key,
      ref: draft.ref,
      evidenceMatch: evidenceMatchOf(draft.serverIds, currentServerId),
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

// src/client/components/ZoteroSurfaceBoundary.tsx
var import_react7 = require("react");
var import_dsh_client_ui_primitives10 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/error-text.ts
function messageOf(error) {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n")[0].trim();
  return firstLine || String(error);
}

// src/client/actions/error-reporter.ts
var activeReporter;
function setErrorReporter(reporter) {
  activeReporter = reporter;
}
function getErrorReporter() {
  return activeReporter;
}
var RETIRED_ENTRY = "slot entry retired after crash (abdicated)";
function reportCrashedSurface(surface, error, info, reporter) {
  const targetReporter = reporter ?? getErrorReporter();
  if (targetReporter === void 0) return;
  const message = messageOf(error) || "unknown failure";
  const componentStack = info === void 0 ? void 0 : info.kind === "slotEntry" && info.abdicated ? RETIRED_ENTRY : info.kind === "componentStack" && typeof info.componentStack === "string" ? info.componentStack : void 0;
  const report = {
    surface,
    message,
    ...error instanceof Error && error.stack !== void 0 ? { stack: error.stack } : {},
    ...componentStack === void 0 ? {} : { componentStack }
  };
  void targetReporter(report).catch(() => {
  });
}

// src/client/components/cards.module.css
var style7 = `._83fRkq_note{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);margin:0}._83fRkq_line{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0}._83fRkq_lineActions{flex:none;align-items:center;gap:4px;margin-left:auto;display:inline-flex}._83fRkq_chevron{color:var(--dsw-alias-label-caption);transition:transform .12s var(--ds-ease-in-out);flex:none}._83fRkq_chevronOpen{transform:rotate(180deg)}._83fRkq_card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);flex-direction:column;gap:6px;max-width:900px;padding:10px 12px;display:flex}._83fRkq_cardHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._83fRkq_cardTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);font-weight:500}._83fRkq_badge{border-radius:var(--dsw-radius-xs);height:18px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);align-items:center;padding:0 6px;font-weight:500;display:inline-flex}._83fRkq_link{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-link);font-weight:500;text-decoration:none}._83fRkq_link:focus-visible{text-underline-offset:3px;outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-link));outline-offset:1px;text-decoration:underline dotted}@media (hover:hover){._83fRkq_link:hover{text-underline-offset:3px;text-decoration:underline dotted}}._83fRkq_linkIcon{vertical-align:-.25em;flex:none;width:1.1em;height:1.1em;margin-right:4px}._83fRkq_passages{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}._83fRkq_passage{flex-direction:column;gap:2px;display:flex}._83fRkq_passageHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._83fRkq_sourceTag{border-radius:var(--dsw-radius-xs);height:18px;font:var(--dsw-font-xxxs-11);letter-spacing:.035em;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);align-items:center;padding:0 6px;font-weight:600;display:inline-flex}._83fRkq_availability{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}._83fRkq_exportRow{flex-direction:column;gap:4px;padding:6px 0;display:flex}._83fRkq_exportSection{flex-direction:column;gap:2px;display:flex}._83fRkq_exportStack{flex-direction:column;display:flex}._83fRkq_exportStack>*+*{border-top:.5px solid var(--dsw-alias-border-l2)}._83fRkq_exportSectionHead{flex-wrap:wrap;align-items:center;gap:4px 8px;padding:6px 0 4px;display:flex}._83fRkq_exportSectionTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);flex:none;font-weight:500}._83fRkq_exportSectionCount{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);flex:none}._83fRkq_exportSectionActions{align-items:center;gap:4px;margin-left:auto;display:inline-flex}._83fRkq_documentKey{text-overflow:ellipsis;white-space:nowrap;min-width:0;font:var(--dsw-font-markdown-code);color:var(--dsw-alias-label-primary);flex:auto;font-weight:500;overflow:hidden}._83fRkq_documentTitle{text-overflow:ellipsis;white-space:nowrap;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);margin:0;padding-left:2px;overflow:hidden}._83fRkq_exportHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._83fRkq_exportToggle{text-align:left;cursor:pointer;background:0 0;border:none;flex:auto;align-items:center;gap:8px;min-width:0;padding:2px 0;font-family:inherit;display:inline-flex}._83fRkq_exportToggle:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:var(--dsw-radius-xs)}._83fRkq_exportTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);flex:none;font-weight:500}._83fRkq_exportFacts{text-overflow:ellipsis;white-space:nowrap;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);flex:auto;overflow:hidden}._83fRkq_exportBody{flex-direction:column;gap:6px;max-width:960px;padding:4px 0 10px;display:flex}._83fRkq_exportCode{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);overflow:hidden}._83fRkq_exportCodeHead{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;min-height:32px;padding:0 10px;display:flex}._83fRkq_exportCodeLabel{min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);flex:auto}._83fRkq_exportKeys{flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0;display:flex}._83fRkq_exportKeysText{text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:480px;font:var(--dsw-font-markdown-code);color:var(--dsw-alias-label-secondary);overflow:hidden}._83fRkq_exportPre{max-height:280px;font:var(--dsw-font-markdown-code-block);color:var(--dsw-alias-label-secondary);white-space:pre;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);margin:0;padding:10px 12px;overflow:auto}._83fRkq_unresolvedItems{flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 0 6px;display:flex}._83fRkq_unresolvedItemsText{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption)}._83fRkq_surfaceError{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);flex-direction:column;gap:6px;margin:16px;padding:12px;display:flex}._83fRkq_surfaceErrorHeader{justify-content:space-between;align-items:center;gap:8px;display:flex}._83fRkq_surfaceErrorTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);margin:0;font-weight:600}._83fRkq_surfaceRetryButton{appearance:none;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-11);cursor:pointer;padding:2px 8px;font-weight:500}@media (hover:hover){._83fRkq_surfaceRetryButton:hover{background:var(--dsw-alias-bg-layer-1)}}._83fRkq_surfaceErrorDetail{font:var(--dsw-font-markdown-code-block-small);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}._83fRkq_cardError{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l3);margin:4px 0;padding:6px 10px}._83fRkq_cardErrorTitle{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);margin:0;font-weight:600}._83fRkq_cardErrorDetail{font:var(--dsw-font-markdown-code-block-small);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:2px 0 0}@media (prefers-reduced-motion:reduce){._83fRkq_chevron{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/cards.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/cards.module.css");
  tag.textContent = style7;
  document.head.appendChild(tag);
}
var cards_default = { "exportCodeHead": "_83fRkq_exportCodeHead", "passage": "_83fRkq_passage", "surfaceErrorDetail": "_83fRkq_surfaceErrorDetail", "passages": "_83fRkq_passages", "cardErrorDetail": "_83fRkq_cardErrorDetail", "lineActions": "_83fRkq_lineActions", "exportKeys": "_83fRkq_exportKeys", "cardTitle": "_83fRkq_cardTitle", "line": "_83fRkq_line", "exportToggle": "_83fRkq_exportToggle", "exportCode": "_83fRkq_exportCode", "surfaceErrorTitle": "_83fRkq_surfaceErrorTitle", "exportCodeLabel": "_83fRkq_exportCodeLabel", "chevronOpen": "_83fRkq_chevronOpen", "documentKey": "_83fRkq_documentKey", "exportHead": "_83fRkq_exportHead", "surfaceRetryButton": "_83fRkq_surfaceRetryButton", "linkIcon": "_83fRkq_linkIcon", "exportBody": "_83fRkq_exportBody", "exportSectionActions": "_83fRkq_exportSectionActions", "card": "_83fRkq_card", "exportPre": "_83fRkq_exportPre", "availability": "_83fRkq_availability", "cardHead": "_83fRkq_cardHead", "chevron": "_83fRkq_chevron", "cardError": "_83fRkq_cardError", "documentTitle": "_83fRkq_documentTitle", "unresolvedItems": "_83fRkq_unresolvedItems", "exportTitle": "_83fRkq_exportTitle", "badge": "_83fRkq_badge", "unresolvedItemsText": "_83fRkq_unresolvedItemsText", "passageHead": "_83fRkq_passageHead", "exportStack": "_83fRkq_exportStack", "note": "_83fRkq_note", "exportSection": "_83fRkq_exportSection", "exportFacts": "_83fRkq_exportFacts", "surfaceErrorHeader": "_83fRkq_surfaceErrorHeader", "sourceTag": "_83fRkq_sourceTag", "exportSectionHead": "_83fRkq_exportSectionHead", "exportRow": "_83fRkq_exportRow", "exportSectionCount": "_83fRkq_exportSectionCount", "exportKeysText": "_83fRkq_exportKeysText", "cardErrorTitle": "_83fRkq_cardErrorTitle", "surfaceError": "_83fRkq_surfaceError", "exportSectionTitle": "_83fRkq_exportSectionTitle", "link": "_83fRkq_link" };

// src/client/components/ZoteroSurfaceBoundary.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
var ZoteroSurfaceBoundary = class extends import_react7.Component {
  state = { message: null };
  static getDerivedStateFromError(error) {
    return { message: messageOf(error) };
  }
  componentDidCatch(error, info) {
    console.error(
      `dsh-zotero: the Zotero panel failed to render (${this.props.surface}):`,
      messageOf(error),
      info
    );
    reportCrashedSurface(this.props.surface, error, {
      kind: "componentStack",
      componentStack: info.componentStack
    });
  }
  componentDidUpdate(prevProps) {
    if (this.state.message !== null && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ message: null });
    }
  }
  handleRetry = () => {
    this.setState({ message: null });
  };
  render() {
    const { message } = this.state;
    if (message === null) return this.props.children;
    const { t } = this.props;
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: cards_default.surfaceError, "data-zotero-surface-error": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: cards_default.surfaceErrorHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: cards_default.surfaceErrorTitle, children: t("renderFailed") }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
          import_dsh_client_ui_primitives10.Button,
          {
            variant: "outline",
            size: "sm",
            className: cards_default.surfaceRetryButton,
            onClick: this.handleRetry,
            "data-zotero-surface-retry": true,
            children: t("refresh")
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: cards_default.surfaceErrorDetail, children: message })
    ] });
  }
};

// src/client/components/workspace/ZoteroWorkspaceView.tsx
var import_react19 = require("react");

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

// src/client/actions/protocol-dispatcher.ts
var activeDispatcher;
function setProtocolDispatcher(dispatcher) {
  activeDispatcher = dispatcher;
}
function getProtocolDispatcher() {
  return activeDispatcher;
}

// src/client/actions/open-zotero.ts
var REF_IDENTITY_CACHE_LIMIT = 500;
var refIdentityCache = /* @__PURE__ */ new Map();
var GENERAL_REF_PATTERN = /^zotero:\/\/(?<libraryType>user|group)\/(?<libraryId>\d+)\/(?<kind>item|attachment|annotation|collection|search)\/(?<key>[A-Za-z0-9_-]+)/;
function parseRefIdentity(ref) {
  const cached = refIdentityCache.get(ref);
  if (cached !== void 0) return cached;
  const match = REF_IN_TEXT_PATTERN.exec(ref) ?? GENERAL_REF_PATTERN.exec(ref);
  let result = null;
  if (match?.groups) {
    const { libraryType, libraryId, kind, key } = match.groups;
    result = {
      libraryType,
      libraryId,
      kind,
      key
    };
  }
  if (refIdentityCache.size >= REF_IDENTITY_CACHE_LIMIT) {
    const firstKey = refIdentityCache.keys().next().value;
    refIdentityCache.delete(firstKey);
  }
  refIdentityCache.set(ref, result);
  return result;
}
function itemTargetOf(identity) {
  return identity.libraryType === "group" ? `groups/${identity.libraryId}/items/${identity.key}` : `library/items/${identity.key}`;
}
function selectUrlOf(ref) {
  const identity = parseRefIdentity(ref);
  return identity === null ? null : `zotero://select/${itemTargetOf(identity)}`;
}
function pdfUrlOf(ref, options = {}) {
  const identity = parseRefIdentity(ref);
  if (identity === null) return null;
  const target = itemTargetOf(identity);
  const params = [];
  if (options.page !== void 0 && options.page !== "")
    params.push(`page=${encodeURIComponent(options.page)}`);
  if (options.annotation !== void 0 && options.annotation !== "")
    params.push(`annotation=${encodeURIComponent(options.annotation)}`);
  return `zotero://open-pdf/${target}${params.length === 0 ? "" : `?${params.join("&")}`}`;
}
function launchZoteroProtocol(url) {
  if (!url.startsWith("zotero://")) return false;
  const dispatcher = getProtocolDispatcher();
  if (dispatcher !== void 0) {
    void dispatcher(url).then((handled) => {
      if (!handled) {
        dispatchDomProtocol(url);
      }
    }).catch(() => {
      dispatchDomProtocol(url);
    });
    return true;
  }
  return dispatchDomProtocol(url);
}
function dispatchDomProtocol(url) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (!url.startsWith("zotero://")) return false;
  try {
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    return false;
  }
}

// src/media-types.ts
var PDF_CONTENT_TYPE = "application/pdf";
var HTML_CONTENT_TYPE = "text/html";
function isPdfContentType(contentType) {
  return contentType === PDF_CONTENT_TYPE;
}

// src/client/sources/source-capabilities.ts
function isHttpUrl(value) {
  return value.startsWith("https://") || value.startsWith("http://");
}
function pdfCapabilityOf(item) {
  const candidates = [];
  if (item.attachment !== void 0) {
    candidates.push({
      ref: item.attachment.ref,
      contentType: item.attachment.contentType,
      kind: item.attachment.kind,
      filePath: item.attachment.kind === "file" && item.attachment.location.length > 0 ? item.attachment.location : void 0
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
    if (parseRefIdentity(candidate.ref) === null) continue;
    return {
      kind: "file",
      ref: candidate.ref,
      ...candidate.filePath !== void 0 ? { filePath: candidate.filePath } : {}
    };
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
  return item.operations.failed > 0 || item.operations.stopped > 0 || item.evidenceMatch === "mismatch";
}
var SOURCE_FILTER_PREDICATES = {
  pdf: (item) => hasPdf(item),
  retrieved: (item) => item.retrievalFacts !== void 0,
  evidence: (item) => item.evidence.length > 0,
  exported: (item) => item.exports.length > 0,
  issues: (item) => hasIssue(item)
};
var FILTER_IDS = Object.keys(SOURCE_FILTER_PREDICATES);
function filterSources(sources, filter) {
  if (filter === "all") return sources;
  const predicate = SOURCE_FILTER_PREDICATES[filter];
  return predicate !== void 0 ? sources.filter(predicate) : sources;
}
function evidencePassageTotalOf(sources) {
  return sources.reduce((total, item) => total + item.evidence.length, 0);
}
function filterCountsOf(sources) {
  const counts = { all: sources.length, pdf: 0, retrieved: 0, evidence: 0, exported: 0, issues: 0 };
  for (const item of sources) {
    for (const id of FILTER_IDS) {
      if (SOURCE_FILTER_PREDICATES[id](item)) counts[id] += 1;
    }
  }
  return counts;
}
var DOCUMENT_FORMATS = /* @__PURE__ */ new Set(["bibtex", "biblatex", "ris", "csljson"]);
function parseCslRecords(artifact) {
  if (artifact.format !== "csljson") return void 0;
  try {
    const records = JSON.parse(artifact.text);
    return Array.isArray(records) ? records : void 0;
  } catch {
    return void 0;
  }
}
function entryTextOf(artifact, item, cslRecords) {
  if (artifact.format === "csljson") {
    if (item.entryIndex === void 0 || cslRecords === void 0) return void 0;
    const record = cslRecords[item.entryIndex];
    if (typeof record !== "object" || record === null) return void 0;
    return JSON.stringify(record);
  }
  if (item.start === void 0 || item.end === void 0) return void 0;
  return artifact.text.slice(item.start, item.end).trim();
}
function documentsOf(artifact) {
  if (artifact.items === void 0 || artifact.items.length === 0 || !DOCUMENT_FORMATS.has(artifact.format)) {
    return void 0;
  }
  const cslRecords = parseCslRecords(artifact);
  const documents = [];
  const unresolved = [];
  for (const item of artifact.items) {
    const text = entryTextOf(artifact, item, cslRecords);
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
var import_react8 = require("react");
var import_dsh_client_ui_primitives11 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/build-info.ts
function buildVersion() {
  return true ? "0.14.1" : "unknown";
}
function buildCommit() {
  return true ? "0ff6e9d" : "unknown";
}
function buildInfoOf() {
  return `${buildVersion()} \xB7 ${buildCommit()}`;
}

// src/client/components/quiet.module.css
var style8 = `._1NSS7W_quiet{height:24px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;align-items:center;padding:0 8px;display:inline-flex}._1NSS7W_quietDense{height:22px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out), border-color .12s var(--ds-ease-in-out);background:0 0;justify-content:center;align-items:center;gap:4px;padding:0 8px;display:inline-flex}._1NSS7W_tight{justify-content:center;min-width:28px;padding:0 6px}._1NSS7W_muted{color:var(--dsw-alias-label-tertiary)}@media (hover:hover){._1NSS7W_quiet:hover:not(:disabled):not([aria-disabled=true]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}._1NSS7W_quietDense:hover:not(:disabled):not([aria-disabled=true]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}}._1NSS7W_quiet:focus-visible,._1NSS7W_quietDense:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}._1NSS7W_quiet:disabled,._1NSS7W_quietDense:disabled{opacity:.5;cursor:default}@media (prefers-reduced-motion:reduce){._1NSS7W_quiet,._1NSS7W_quietDense{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/quiet.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/quiet.module.css");
  tag.textContent = style8;
  document.head.appendChild(tag);
}
var quiet_default = { "quietDense": "_1NSS7W_quietDense", "tight": "_1NSS7W_tight", "quiet": "_1NSS7W_quiet", "muted": "_1NSS7W_muted" };

// src/client/components/workspace/connection.ts
function connectionDiagnosisOf(connection, t) {
  if (connection.kind === "remote-error") return diagnosisLine(connection.message, t);
  if (connection.kind === "unavailable") {
    const diagnosis = connection.data.diagnosis;
    return diagnosis ? diagnosisLine(diagnosis, t) : t("diagnosisUnknown");
  }
  return "";
}

// src/client/components/workspace/workspace.module.css
var style9 = `._2JqWDq_view{background:var(--dsw-alias-bg-layer-1);height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;display:flex;container-type:inline-size}._2JqWDq_lensBar,._2JqWDq_workspace,._2JqWDq_exportsPage,._2JqWDq_evidencePage{box-sizing:border-box;width:100%;max-width:1440px;margin-inline:auto}._2JqWDq_toolbar{border-bottom:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap;flex:none;align-items:center;gap:4px 8px;min-height:36px;padding:5px 12px;display:flex}._2JqWDq_statusText{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);flex:none;font-weight:500}._2JqWDq_diagnosis{min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);white-space:normal;overflow-wrap:anywhere;flex:auto;overflow:hidden}._2JqWDq_spacer{flex:auto}._2JqWDq_menuButton,._2JqWDq_refresh{flex:none}._2JqWDq_lensBar{flex:none;align-items:stretch;gap:12px;padding:4px 12px 0;display:flex}._2JqWDq_lensTab{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color .12s var(--ds-ease-in-out);background:0 0;border:none;border-bottom:2px solid #0000;align-items:center;gap:6px;margin-bottom:-1px;padding:6px 2px;display:inline-flex}@media (hover:hover){._2JqWDq_lensTab:hover{color:var(--dsw-alias-label-primary)}}._2JqWDq_lensTab:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}._2JqWDq_lensTabActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}._2JqWDq_lensTabCount{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption)}._2JqWDq_workspace{flex:auto;grid-template-columns:clamp(280px,30cqi,400px) minmax(0,1fr);min-height:0;display:grid}._2JqWDq_sidebar{min-height:0;padding:8px 12px calc(var(--dsh-composer-height,152px) + 16px);border-right:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;display:flex;overflow:hidden}._2JqWDq_filterBar{scrollbar-width:none;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-wrap:nowrap;flex:none;align-items:center;gap:4px;display:flex;position:relative;overflow-x:auto}._2JqWDq_filterBar>*{flex:none}._2JqWDq_filterBar::-webkit-scrollbar{display:none}._2JqWDq_filterArrow{z-index:2;corner-shape:round;background:var(--dsw-specific-input-major);width:20px;height:20px;color:var(--dsw-alias-label-secondary);box-shadow:var(--dsw-elevation-panel);cursor:pointer;border:0;border-radius:999px;place-items:center;padding:0;display:grid;position:absolute;top:50%;transform:translateY(-50%)}@media (hover:hover){._2JqWDq_filterArrow:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}}._2JqWDq_filterArrowLeft{left:2px}._2JqWDq_filterArrowRight{right:2px}._2JqWDq_evidenceEntry{height:24px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-link);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;align-self:flex-start;align-items:center;margin-left:8px;padding:0;font-weight:500;text-decoration:none;display:inline-flex}@media (hover:hover){._2JqWDq_evidenceEntry:hover{text-underline-offset:3px;text-decoration:underline dotted}}._2JqWDq_evidenceEntry:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-link));outline-offset:1px}._2JqWDq_evidencePage{min-height:0;padding:8px 16px calc(var(--dsh-composer-height,152px) + 16px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:auto;gap:8px;display:flex;overflow-y:auto}._2JqWDq_emptyNote{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);margin:0}._2JqWDq_emptyWrap{flex-direction:column;align-items:flex-start;gap:6px;display:flex}._2JqWDq_listbox{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:auto;gap:2px;min-height:0;display:flex;overflow-y:auto}._2JqWDq_listItem{border-radius:var(--dsw-radius-sm);cursor:pointer;border-left:2px solid #0000;flex-direction:column;gap:1px;padding:6px 8px 6px 10px;display:flex}@media (hover:hover){._2JqWDq_listItem:hover{background:var(--dsw-alias-interactive-bg-hover)}}._2JqWDq_listItem:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}._2JqWDq_listItemSelected{background:var(--dsw-alias-interactive-bg-hover);border-left-color:var(--dsw-alias-state-business-primary)}._2JqWDq_listItemTitle{min-width:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);font-weight:500}._2JqWDq_listItemMeta{text-overflow:ellipsis;white-space:nowrap;min-width:0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);overflow:hidden}._2JqWDq_badges{flex-wrap:wrap;align-items:center;gap:4px;display:inline-flex}._2JqWDq_badge{border-radius:var(--dsw-radius-xs);height:18px;font:var(--dsw-font-xxxs-11);letter-spacing:.035em;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);align-items:center;padding:0 6px;font-weight:600;display:inline-flex}._2JqWDq_inspector{min-height:0;padding:8px 16px calc(var(--dsh-composer-height,152px) + 16px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;gap:8px;display:flex;overflow-y:auto}._2JqWDq_backAction{display:none}._2JqWDq_inspectorHead,._2JqWDq_inspectorTitleWrap{flex-direction:column;gap:2px;display:flex}._2JqWDq_inspectorTitle{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);font-weight:600}._2JqWDq_inspectorMeta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary)}._2JqWDq_inspectorTabs{border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none;align-items:stretch;gap:12px;display:flex}._2JqWDq_detailTab{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);cursor:pointer;transition:color .12s var(--ds-ease-in-out);background:0 0;border:none;border-bottom:2px solid #0000;align-items:center;gap:5px;margin-bottom:-1px;padding:4px 1px;display:inline-flex}@media (hover:hover){._2JqWDq_detailTab:hover{color:var(--dsw-alias-label-primary)}}._2JqWDq_detailTab:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}._2JqWDq_detailTabActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-label-primary)}._2JqWDq_detailTabCount{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-caption)}._2JqWDq_inspectorBody{flex-direction:column;gap:8px;min-height:0;display:flex}._2JqWDq_panel{flex-direction:column;gap:6px;max-width:900px;display:flex}._2JqWDq_section{flex-direction:column;gap:2px;display:flex}._2JqWDq_sectionLabel{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);margin:0}._2JqWDq_line{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0}._2JqWDq_note{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);margin:0}._2JqWDq_warning{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);margin:0}._2JqWDq_summaryLine{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);margin:0}._2JqWDq_actionRow{flex-wrap:wrap;align-items:center;gap:4px;display:flex}._2JqWDq_passages{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}._2JqWDq_passage{flex-direction:column;gap:2px;display:flex}._2JqWDq_passageHead{flex-wrap:wrap;align-items:center;gap:4px 8px;display:flex}._2JqWDq_sourceTag{border-radius:var(--dsw-radius-xs);height:18px;font:var(--dsw-font-xxxs-11);letter-spacing:.035em;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);align-items:center;padding:0 6px;font-weight:600;display:inline-flex}._2JqWDq_availability{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}._2JqWDq_detailToggle{height:22px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;align-self:flex-start;align-items:center;padding:0 2px;display:inline-flex}@media (hover:hover){._2JqWDq_detailToggle:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}}._2JqWDq_detailToggle:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}._2JqWDq_exportsPage{min-height:0;padding:8px 16px calc(var(--dsh-composer-height,152px) + 16px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:auto;gap:8px;display:flex;overflow-y:auto}._2JqWDq_empty{min-height:0;padding:72px 16px calc(var(--dsh-composer-height,152px) + 32px);flex-direction:column;flex:auto;align-items:center;gap:8px;display:flex}._2JqWDq_emptyIcon{color:var(--dsw-alias-label-caption)}._2JqWDq_emptyText{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:0}._2JqWDq_starterRow{flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;margin-top:4px;display:flex}@container (width<=640px){._2JqWDq_workspace{grid-template-columns:minmax(0,1fr)}._2JqWDq_workspace[data-pane=list] ._2JqWDq_inspector,._2JqWDq_workspace[data-pane=detail] ._2JqWDq_sidebar{display:none}._2JqWDq_backAction{height:24px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;align-self:flex-start;align-items:center;padding:0 8px;display:inline-flex}@media (hover:hover){._2JqWDq_backAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}._2JqWDq_backAction:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}}@container (width<=560px){._2JqWDq_lensBar{padding:4px 8px 0}._2JqWDq_sidebar{padding:8px 8px calc(var(--dsh-composer-height,152px) + 16px)}._2JqWDq_inspector,._2JqWDq_exportsPage{padding-left:12px;padding-right:12px}}@container (width<=460px){._2JqWDq_toolbar{padding:4px 8px}}@media (prefers-reduced-motion:reduce){._2JqWDq_lensTab,._2JqWDq_detailTab{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/workspace/workspace.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/workspace/workspace.module.css");
  tag.textContent = style9;
  document.head.appendChild(tag);
}
var workspace_default = { "filterArrowRight": "_2JqWDq_filterArrowRight", "refresh": "_2JqWDq_refresh", "spacer": "_2JqWDq_spacer", "menuButton": "_2JqWDq_menuButton", "lensTabCount": "_2JqWDq_lensTabCount", "exportsPage": "_2JqWDq_exportsPage", "inspectorTitle": "_2JqWDq_inspectorTitle", "availability": "_2JqWDq_availability", "empty": "_2JqWDq_empty", "backAction": "_2JqWDq_backAction", "line": "_2JqWDq_line", "statusText": "_2JqWDq_statusText", "passage": "_2JqWDq_passage", "sourceTag": "_2JqWDq_sourceTag", "lensBar": "_2JqWDq_lensBar", "inspectorTitleWrap": "_2JqWDq_inspectorTitleWrap", "inspectorMeta": "_2JqWDq_inspectorMeta", "emptyIcon": "_2JqWDq_emptyIcon", "passageHead": "_2JqWDq_passageHead", "detailTab": "_2JqWDq_detailTab", "warning": "_2JqWDq_warning", "actionRow": "_2JqWDq_actionRow", "filterBar": "_2JqWDq_filterBar", "starterRow": "_2JqWDq_starterRow", "view": "_2JqWDq_view", "emptyText": "_2JqWDq_emptyText", "lensTab": "_2JqWDq_lensTab", "listItemSelected": "_2JqWDq_listItemSelected", "emptyNote": "_2JqWDq_emptyNote", "evidencePage": "_2JqWDq_evidencePage", "workspace": "_2JqWDq_workspace", "sidebar": "_2JqWDq_sidebar", "section": "_2JqWDq_section", "evidenceEntry": "_2JqWDq_evidenceEntry", "listItemMeta": "_2JqWDq_listItemMeta", "filterArrowLeft": "_2JqWDq_filterArrowLeft", "passages": "_2JqWDq_passages", "diagnosis": "_2JqWDq_diagnosis", "listbox": "_2JqWDq_listbox", "toolbar": "_2JqWDq_toolbar", "listItemTitle": "_2JqWDq_listItemTitle", "badge": "_2JqWDq_badge", "detailTabCount": "_2JqWDq_detailTabCount", "sectionLabel": "_2JqWDq_sectionLabel", "inspectorBody": "_2JqWDq_inspectorBody", "inspector": "_2JqWDq_inspector", "listItem": "_2JqWDq_listItem", "inspectorHead": "_2JqWDq_inspectorHead", "inspectorTabs": "_2JqWDq_inspectorTabs", "detailToggle": "_2JqWDq_detailToggle", "filterArrow": "_2JqWDq_filterArrow", "emptyWrap": "_2JqWDq_emptyWrap", "detailTabActive": "_2JqWDq_detailTabActive", "badges": "_2JqWDq_badges", "summaryLine": "_2JqWDq_summaryLine", "lensTabActive": "_2JqWDq_lensTabActive", "panel": "_2JqWDq_panel", "note": "_2JqWDq_note" };

// src/client/components/workspace/WorkspaceToolbar.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function WorkspaceToolbar({ connection, onRefresh, t }) {
  const [menuOpen, setMenuOpen] = (0, import_react8.useState)(false);
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
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
    "div",
    {
      className: workspace_default.toolbar,
      role: "status",
      "aria-live": "polite",
      "aria-busy": connection.kind === "loading",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          import_dsh_client_ui_primitives11.StateDot,
          {
            state: connection.kind === "loading" ? "ongoing" : connection.kind === "connected" ? "done" : "error"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { className: workspace_default.statusText, children: [
          connection.kind === "loading" && t("checking"),
          connection.kind === "connected" && t("statusConnectedNote"),
          failed && t("statusUnavailable")
        ] }),
        failed && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: workspace_default.diagnosis, title: diagnosis, children: diagnosis }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: workspace_default.spacer }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          import_dsh_client_ui_primitives11.Menu,
          {
            open: menuOpen,
            anchor: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
              "button",
              {
                type: "button",
                className: clsx_default(quiet_default.quiet, quiet_default.tight, workspace_default.menuButton),
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
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          "button",
          {
            type: "button",
            className: clsx_default(quiet_default.quiet, workspace_default.refresh),
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
var import_react10 = require("react");
var import_dsh_client_ui_primitives12 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/workspace/SourceListItem.tsx
var import_react9 = require("react");
var import_jsx_runtime12 = require("react/jsx-runtime");
function badgesOf(item, t) {
  const badges = [];
  if (hasPdf(item)) badges.push(t("badgePdf"));
  if (item.evidence.length > 0) badges.push(t("evidenceBadge", { count: item.evidence.length }));
  if (item.exports.length > 0) badges.push(t("exportBadge", { count: item.exports.length }));
  if (hasIssue(item)) badges.push(t("issuesBadge"));
  return badges;
}
function SourceListItemComponent({
  item,
  index,
  selected,
  focused,
  setOptionRef,
  onSelect,
  t
}) {
  const badges = badgesOf(item, t);
  const handleSelect = (0, import_react9.useCallback)(() => {
    onSelect(item.key, index);
  }, [onSelect, item.key, index]);
  const refCallback = (0, import_react9.useCallback)(
    (el) => {
      setOptionRef?.(index, el);
    },
    [setOptionRef, index]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "div",
    {
      ref: refCallback,
      role: "option",
      "aria-selected": selected,
      tabIndex: focused ? 0 : -1,
      "data-evidence-match": item.evidenceMatch,
      className: clsx_default(workspace_default.listItem, selected && workspace_default.listItemSelected),
      onClick: handleSelect,
      onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelect();
        }
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: workspace_default.listItemTitle, children: item.title ?? item.ref }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: workspace_default.listItemMeta, children: joinNonEmpty(item.creators, item.year, item.venue) }),
        badges.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: workspace_default.badges, children: badges.map((badge) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: workspace_default.badge, "data-badge": true, children: badge }, badge)) })
      ]
    }
  );
}
var SourceListItem = (0, import_react9.memo)(SourceListItemComponent);

// src/client/components/workspace/SourceSidebar.tsx
var import_jsx_runtime13 = require("react/jsx-runtime");
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
  selection: selection2,
  selectedKey,
  setFilter,
  setSelection,
  setMobilePane,
  onOpenEvidence,
  t
}) {
  const optionRefs = (0, import_react10.useRef)([]);
  const filterBarRef = (0, import_react10.useRef)(null);
  const [filterEdges, setFilterEdges] = (0, import_react10.useState)({ left: false, right: false });
  const evidencePassageTotal = (0, import_react10.useMemo)(
    () => evidencePassageTotalOf(workspace.sources),
    [workspace.sources]
  );
  const updateFilterEdges = (0, import_react10.useCallback)(() => {
    const el = filterBarRef.current;
    if (el === null) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setFilterEdges((prev) => prev.left === left && prev.right === right ? prev : { left, right });
  }, []);
  (0, import_react10.useLayoutEffect)(() => {
    optionRefs.current.length = visible.length;
  }, [visible.length]);
  (0, import_react10.useLayoutEffect)(() => {
    updateFilterEdges();
  }, [counts, filter, updateFilterEdges]);
  (0, import_react10.useEffect)(() => {
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
    if (el) {
      el.scrollBy({ left: direction * Math.max(el.clientWidth - 60, 120) });
    }
  };
  const focusVisible = (index) => {
    optionRefs.current[index]?.focus();
  };
  const moveSelection = (nextIndex) => {
    if (visible.length === 0) return;
    const clamped = Math.max(0, Math.min(visible.length - 1, nextIndex));
    const current = visible[clamped];
    setSelection({ key: current.key, focusIndex: clamped });
    focusVisible(clamped);
  };
  const handleItemSelect = (0, import_react10.useCallback)(
    (key, index) => {
      setSelection({ key, focusIndex: index });
      setMobilePane("detail");
    },
    [setSelection, setMobilePane]
  );
  const setOptionRef = (0, import_react10.useCallback)((index, el) => {
    optionRefs.current[index] = el;
  }, []);
  const onKeyDown = (event) => {
    const currentIndex = Math.max(0, Math.min(selection2.focusIndex, visible.length - 1));
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
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("aside", { className: workspace_default.sidebar, children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
      "div",
      {
        className: workspace_default.filterBar,
        ref: filterBarRef,
        role: "group",
        "aria-label": t("filterBarLabel"),
        children: [
          filterEdges.left && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
            "button",
            {
              type: "button",
              className: clsx_default(workspace_default.filterArrow, workspace_default.filterArrowLeft),
              "aria-label": t("filterScrollLeft"),
              onClick: () => {
                pageFilters(-1);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives12.IconChevronLeftOutlineMedium, {})
            }
          ),
          shownFiltersOf(filter, counts).map((entry) => {
            const count = counts[entry.id];
            return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              import_dsh_client_ui_primitives12.Pill,
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
          filterEdges.right && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
            "button",
            {
              type: "button",
              className: clsx_default(workspace_default.filterArrow, workspace_default.filterArrowRight),
              "aria-label": t("filterScrollRight"),
              onClick: () => {
                pageFilters(1);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives12.IconChevronRightOutlineMedium, {})
            }
          )
        ]
      }
    ),
    counts.evidence >= 2 && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", className: workspace_default.evidenceEntry, onClick: onOpenEvidence, children: t("evidenceEntryLabel", {
      count: evidencePassageTotal
    }) }),
    workspace.omittedRows > 0 && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: workspace_default.emptyNote, children: t("omittedRowsNote", { count: workspace.omittedRows }) }),
    visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: workspace_default.emptyWrap, children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: workspace_default.emptyNote, children: t("filterEmptyNote") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        import_dsh_client_ui_primitives12.Button,
        {
          variant: "outline",
          size: "sm",
          className: quiet_default.quiet,
          onClick: () => {
            setFilter("all");
          },
          children: t("filterClear")
        }
      )
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
      "div",
      {
        className: workspace_default.listbox,
        role: "listbox",
        "aria-label": t("lensSources"),
        onKeyDown,
        children: visible.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
          SourceListItem,
          {
            item,
            index,
            selected: item.key === selectedKey,
            focused: index === selection2.focusIndex,
            setOptionRef,
            onSelect: handleItemSelect,
            t
          },
          item.key
        ))
      }
    )
  ] });
}

// src/client/components/workspace/SourceInspector.tsx
var import_react18 = require("react");

// src/client/components/workspace/SourceOverview.tsx
var import_react14 = require("react");
var import_dsh_client_ui_primitives18 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/actions/source-actions.ts
function askDraftOf(ref, t) {
  return t("askTemplate", { ref });
}
function exportDraftOf(ref, t) {
  return t("citeTemplate", { ref });
}

// src/client/components/open/BlockedReadAction.tsx
var import_react11 = require("react");
var import_dsh_client_ui_primitives13 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/open/open.module.css
var style10 = `.KugbzW_link{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-link);font-weight:500;text-decoration:none}.KugbzW_link:focus-visible{text-underline-offset:3px;outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-link));outline-offset:1px;text-decoration:underline dotted}@media (hover:hover){.KugbzW_link:hover{text-underline-offset:3px;text-decoration:underline dotted}}.KugbzW_linkIcon{vertical-align:-.25em;flex:none;width:1.1em;height:1.1em;margin-right:5px}.KugbzW_blocked{opacity:.5;cursor:default}@media (hover:hover){.KugbzW_blocked:hover{color:var(--dsw-alias-label-secondary);background:0 0}}.KugbzW_resolving{opacity:.7;cursor:wait}.KugbzW_srOnly{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/open/open.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/open/open.module.css");
  tag.textContent = style10;
  document.head.appendChild(tag);
}
var open_default = { "blocked": "KugbzW_blocked", "srOnly": "KugbzW_srOnly", "linkIcon": "KugbzW_linkIcon", "resolving": "KugbzW_resolving", "link": "KugbzW_link" };

// src/client/components/open/BlockedReadAction.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
function BlockedReadAction({ label, t, className }) {
  const reason = t("databaseMismatch");
  const reasonId = (0, import_react11.useId)();
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives13.Tooltip, { label: reason, children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
      "button",
      {
        type: "button",
        className: clsx_default(className ?? quiet_default.quiet, open_default.blocked),
        "aria-disabled": "true",
        "aria-describedby": reasonId,
        onClick: (event) => {
          event.preventDefault();
        },
        children: label
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { id: reasonId, className: open_default.srOnly, children: reason })
  ] });
}

// src/client/components/open/PdfReadButton.tsx
var import_react12 = require("react");
var import_dsh_client_ui_primitives14 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/actions/attachment-resolver.ts
var activeResolver;
function setAttachmentResolver(resolver) {
  activeResolver = resolver;
}
function getAttachmentResolver() {
  return activeResolver;
}

// src/client/components/open/PdfReadButton.tsx
var import_jsx_runtime15 = require("react/jsx-runtime");
function PdfReadButton({
  capability,
  attachmentRef,
  filePath,
  webUrl,
  onOpenFile,
  onOpenUrl,
  resolveAttachment,
  label,
  emphasis = "outline",
  t,
  className,
  title,
  disabledReason,
  requireSessionForResolvedFile = false,
  variant = "button"
}) {
  const [resolving, setResolving] = (0, import_react12.useState)(false);
  const [error, setError] = (0, import_react12.useState)(null);
  const targetRef = attachmentRef ?? (capability?.kind === "file" ? capability.ref : void 0);
  const targetPath = filePath ?? (capability?.kind === "file" ? capability.filePath : void 0);
  const targetWebUrl = webUrl ?? (capability?.kind === "url" ? capability.url : void 0);
  (0, import_react12.useEffect)(() => {
    setError(null);
  }, [attachmentRef, filePath, webUrl, capability]);
  const openExternalUrl = (url) => {
    if (onOpenUrl) onOpenUrl(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  const openWith = (open) => {
    try {
      open();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const handleClick = async (e) => {
    e.stopPropagation();
    if (resolving) return;
    setError(null);
    if (targetWebUrl) {
      openWith(() => openExternalUrl(targetWebUrl));
      return;
    }
    if (targetPath) {
      if (onOpenFile) openWith(() => onOpenFile(targetPath));
      return;
    }
    const resolver = resolveAttachment ?? getAttachmentResolver();
    if (targetRef && resolver) {
      setResolving(true);
      try {
        const res = await resolver(targetRef);
        if (res.ok) {
          if (res.value.kind === "file") {
            const path = res.value.path;
            if (path) {
              if (onOpenFile) openWith(() => onOpenFile(path));
              else if (requireSessionForResolvedFile) setError(t("libraryNoSessionForOpen"));
            } else {
              setError(t("pdfFileNotFound"));
            }
          } else if (res.value.kind === "url" && res.value.url) {
            const url = res.value.url;
            openWith(() => openExternalUrl(url));
          }
        } else {
          setError(res.error.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setResolving(false);
      }
    }
  };
  const displayLabel = resolving ? t("pdfResolving") : error ?? label ?? t("readPdf");
  const tooltip = error ?? title ?? t("readPdfInSidebar");
  const unavailableReason = disabledReason ?? (targetPath && !targetWebUrl && onOpenFile === void 0 ? t("libraryNoSessionForOpen") : void 0);
  const disabled = resolving || unavailableReason !== void 0;
  if (variant === "link") {
    return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
      "button",
      {
        type: "button",
        className: clsx_default(open_default.link, className, resolving && open_default.resolving),
        onClick: handleClick,
        "aria-label": unavailableReason ?? displayLabel,
        title: unavailableReason ?? tooltip,
        disabled,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives14.IconDeliverDocRegular, { className: open_default.linkIcon }),
          displayLabel
        ]
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
    import_dsh_client_ui_primitives14.Button,
    {
      variant: emphasis,
      size: "sm",
      className: clsx_default(className, resolving && open_default.resolving),
      onClick: handleClick,
      "aria-label": unavailableReason ?? displayLabel,
      title: unavailableReason ?? tooltip,
      disabled,
      icon: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives14.IconDeliverDocRegular, { size: 14 }),
      children: displayLabel
    }
  );
}

// src/client/components/open/ZoteroLocateActions.tsx
var import_dsh_client_ui_primitives17 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/CopyButton.tsx
var import_dsh_client_ui_primitives16 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/useCopyFeedback.ts
var import_react13 = require("react");
var import_dsh_client_ui_primitives15 = require("@deepseek-ai/dsh-client-ui-primitives");
var COPY_FEEDBACK_MS = 1500;
function idleState() {
  return { phase: "idle", error: void 0 };
}
function useCopyFeedback(resetKey) {
  const [state, setState] = (0, import_react13.useState)(idleState);
  const epoch = (0, import_react13.useRef)(0);
  const timer = (0, import_react13.useRef)(void 0);
  const clearTimer = (0, import_react13.useCallback)(() => {
    if (timer.current !== void 0) {
      window.clearTimeout(timer.current);
      timer.current = void 0;
    }
  }, []);
  const reset = (0, import_react13.useCallback)(() => {
    epoch.current += 1;
    clearTimer();
    setState(idleState());
  }, [clearTimer]);
  (0, import_react13.useEffect)(() => {
    reset();
  }, [resetKey, reset]);
  (0, import_react13.useEffect)(
    () => () => {
      epoch.current += 1;
      clearTimer();
    },
    [clearTimer]
  );
  const begin = (0, import_react13.useCallback)(() => {
    const mine = epoch.current += 1;
    clearTimer();
    setState({ phase: "pending", error: void 0 });
    return mine;
  }, [clearTimer]);
  const settle = (0, import_react13.useCallback)((mine, write) => {
    void (async () => {
      try {
        const accepted = await write();
        if (epoch.current !== mine) return;
        if (!accepted) {
          setState({ phase: "rejected", error: void 0 });
          return;
        }
        setState({ phase: "done", error: void 0 });
        timer.current = window.setTimeout(() => {
          timer.current = void 0;
          if (epoch.current !== mine) return;
          setState(idleState());
        }, COPY_FEEDBACK_MS);
      } catch (error) {
        if (epoch.current !== mine) return;
        setState({ phase: "error", error });
      }
    })();
  }, []);
  const copyText = (0, import_react13.useCallback)(
    (text) => {
      const mine = begin();
      settle(mine, () => (0, import_dsh_client_ui_primitives15.writeClipboard)(text));
    },
    [begin, settle]
  );
  const copy = (0, import_react13.useCallback)(
    (load) => {
      const mine = begin();
      void (async () => {
        try {
          const text = await load();
          if (epoch.current !== mine) return;
          settle(mine, () => (0, import_dsh_client_ui_primitives15.writeClipboard)(text));
        } catch (error) {
          if (epoch.current !== mine) return;
          setState({ phase: "error", error });
        }
      })();
    },
    [begin, settle]
  );
  return { phase: state.phase, error: state.error, copy, copyText, reset };
}

// src/client/components/CopyButton.tsx
var import_jsx_runtime16 = require("react/jsx-runtime");
function CopyButton({
  value,
  label,
  copiedLabel,
  className,
  title,
  disabled,
  asButton = false,
  icon
}) {
  const { phase, copyText } = useCopyFeedback(value);
  const copied = phase === "done";
  const handleClick = (e) => {
    e.stopPropagation();
    copyText(value);
  };
  if (asButton) {
    return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
      import_dsh_client_ui_primitives16.Button,
      {
        variant: "outline",
        size: "sm",
        className,
        "aria-label": label,
        title: title ?? label,
        disabled,
        icon,
        onClick: handleClick,
        children: copied ? copiedLabel : label
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
    "button",
    {
      type: "button",
      className: className ?? quiet_default.quiet,
      "aria-label": label,
      title: title ?? label,
      disabled,
      onClick: handleClick,
      children: [
        icon,
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: copied ? copiedLabel : label })
      ]
    }
  );
}

// src/client/components/open/ZoteroLocateActions.tsx
var import_jsx_runtime17 = require("react/jsx-runtime");
function ZoteroLocateActions({
  title,
  itemRef,
  selectUrl,
  t,
  className,
  variant = "button"
}) {
  const canonicalUrl = selectUrl !== void 0 ? selectUrl : itemRef ? selectUrlOf(itemRef) : null;
  const baseClass = variant === "link" ? open_default.link : quiet_default.quiet;
  const buttonClass = clsx_default(baseClass, className);
  const handleOpen = () => {
    if (canonicalUrl) {
      launchZoteroProtocol(canonicalUrl);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(import_jsx_runtime17.Fragment, { children: [
    title && /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
      CopyButton,
      {
        value: title,
        label: t("copyTitle"),
        copiedLabel: t("copied"),
        title: t("copyTitleTooltip"),
        className: buttonClass
      }
    ),
    canonicalUrl && /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(import_jsx_runtime17.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(
        "button",
        {
          type: "button",
          className: buttonClass,
          onClick: handleOpen,
          title: t("openInZoteroTooltip"),
          "aria-label": t("openInZotero"),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives17.IconLinkOutlineRegular, { size: 12, className: open_default.linkIcon }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: t("openInZotero") })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(
        CopyButton,
        {
          value: canonicalUrl,
          label: t("copyZoteroLink"),
          copiedLabel: t("copied"),
          title: t("copyZoteroLinkTooltip"),
          className: buttonClass
        }
      )
    ] })
  ] });
}

// src/client/components/workspace/SourceOverview.tsx
var import_jsx_runtime18 = require("react/jsx-runtime");
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
function SourceOverview({
  item,
  t,
  setDraft,
  openFile,
  resolveAttachment
}) {
  const [detailOpen, setDetailOpen] = (0, import_react14.useState)(false);
  const evidenceMatch = item.evidenceMatch;
  const pdfCapability = pdfCapabilityOf(item);
  const searchRows = (0, import_react14.useMemo)(
    () => item.searches.map((search, index) => {
      const scope = scopeLabelOf(search.scope, t);
      const mode = modeLabelOf(search.mode, t);
      const filters = filterLineOf(search.itemTypes, search.tags, t);
      const hits = search.total === void 0 ? t("searchEpisodeHitsNoTotal", { returned: search.returned }) : t("searchEpisodeHitsLine", { returned: search.returned, total: search.total });
      const hitsWithNotes = search.noteMatches === void 0 ? hits : `${hits} \xB7 ${t("searchEpisodeNoteHits", { noteMatches: search.noteMatches })}`;
      const queryLine = search.query !== void 0 ? t("searchEpisodeQueryLine", { query: search.query, scope, mode }) : t("searchEpisodeNoQueryLine", { scope, mode });
      return { key: `${search.callId}-${index}`, queryLine, filters, hitsWithNotes };
    }),
    [item.searches, t]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: workspace_default.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: workspace_default.actionRow, children: [
      pdfCapability !== null && (evidenceMatch === "mismatch" ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(BlockedReadAction, { label: t("readPdf"), t, className: quiet_default.quiet }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        PdfReadButton,
        {
          capability: pdfCapability,
          onOpenFile: openFile,
          resolveAttachment,
          label: t("readPdf"),
          t,
          className: quiet_default.quiet
        }
      )),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ZoteroLocateActions, { title: item.title, itemRef: item.ref, t, className: quiet_default.quiet }),
      setDraft !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        import_dsh_client_ui_primitives18.Button,
        {
          variant: "outline",
          size: "sm",
          className: quiet_default.quiet,
          onClick: () => {
            setDraft(askDraftOf(item.ref, t));
          },
          children: t("askAboutItem")
        }
      ),
      setDraft !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
        import_dsh_client_ui_primitives18.Button,
        {
          variant: "outline",
          size: "sm",
          className: quiet_default.quiet,
          onClick: () => {
            setDraft(exportDraftOf(item.ref, t));
          },
          children: t("exportCitation")
        }
      )
    ] }),
    item.evidenceMatch === "mismatch" && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: workspace_default.warning, children: t("databaseMismatch") }),
    searchRows.length > 0 ? searchRows.map((search) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: workspace_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: workspace_default.line, children: search.queryLine }),
      search.filters !== "" && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: workspace_default.note, children: t("searchEpisodeFilterLine", { filters: search.filters }) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: workspace_default.line, children: search.hitsWithNotes })
    ] }, search.key)) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: workspace_default.note, children: t("overviewNoSearch") }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(
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
    detailOpen && /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: workspace_default.section, children: /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: workspace_default.note, children: `${t("refLine")} ${item.ref}` }) })
  ] });
}

// src/client/components/workspace/SourceEvidence.tsx
var import_dsh_client_ui_primitives19 = require("@deepseek-ai/dsh-client-ui-primitives");

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
var import_jsx_runtime19 = require("react/jsx-runtime");
function retrievalSummaryLineOf(item, t) {
  const summary = item.retrievalSummary;
  if (summary === void 0) return "";
  const parts = [
    t("retrievalRunCount", { count: summary.runCount }),
    t("retrievalKeptCount", { count: item.evidence.length }),
    t("retrievalReportedCount", { count: item.facts.reportedEvidenceCount })
  ];
  if (summary.truncated) parts.push(t("budgetLimitedNote"));
  return parts.join(" \xB7 ");
}
function PassageRow({
  passage,
  t
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("li", { className: workspace_default.passage, "data-source": passage.source, children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("p", { className: workspace_default.passageHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Tag, { tone: "neutral", className: workspace_default.sourceTag, children: t(sourceLabelKeyOf(passage.source)) }),
      passage.pageLabel !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { className: workspace_default.note, children: t("pageLabel", { label: passage.pageLabel }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("p", { className: workspace_default.line, children: [
      passage.text,
      passage.previewTruncated ? ` ${t("truncatedPreview")}` : ""
    ] }),
    passage.callIds.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.note, children: t("retrievedMultiple", { count: passage.callIds.length }) })
  ] });
}
function SourceEvidence({ item, t }) {
  if (item.retrievalFacts === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: workspace_default.panel, children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.note, children: t("evidenceNotRetrieved") }) });
  }
  const summaryLine = retrievalSummaryLineOf(item, t);
  const facts = item.retrievalFacts;
  const coverageLine = facts.coverage === void 0 ? "" : coverageLineOf(facts.coverage, t);
  const availabilityEntries = Object.entries(facts.sourceAvailability);
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: workspace_default.panel, children: [
    summaryLine !== "" && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.summaryLine, children: summaryLine }),
    coverageLine !== "" && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.note, children: coverageLine }),
    item.evidence.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.note, children: emptyEvidenceNoteOf(item.facts.reportedEvidenceCount, t) }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("ul", { className: workspace_default.passages, children: item.evidence.map((passage, index) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(PassageRow, { passage, t }, `${passage.sourceRef}-${index}`)) }),
    availabilityEntries.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: workspace_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: workspace_default.sectionLabel, children: t("availabilityTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("ul", { className: workspace_default.availability, children: availabilityEntries.map(([source, entry]) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("li", { className: workspace_default.note, children: t("availabilityEntry", {
        source: t(sourceLabelKeyOf(source)),
        detail: availabilityLineOf(entry, t)
      }) }, source)) })
    ] })
  ] });
}

// src/client/components/ExportSections.tsx
var import_react17 = require("react");

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

// src/client/export-formats.ts
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
  return formatTime(artifact.settledAt, false);
}

// src/client/components/ExportCard.tsx
var import_react15 = require("react");
var import_dsh_client_ui_primitives20 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/export-items.ts
var BIBTEX_KEY_SOURCE = "@[A-Za-z]+\\{([^,\\s{}]+),";

// src/client/sources/bibtex.ts
var BIBTEX_KEY = new RegExp(BIBTEX_KEY_SOURCE, "g");
function bibTexKeysOf(text) {
  const keys = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(BIBTEX_KEY)) {
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
var import_jsx_runtime20 = require("react/jsx-runtime");
function ExportCard({ artifact, t }) {
  const [open, setOpen] = (0, import_react15.useState)(false);
  const keys = (0, import_react15.useMemo)(
    () => artifact.format === "bibtex" || artifact.format === "biblatex" ? bibTexKeysOf(artifact.text) : [],
    [artifact.format, artifact.text]
  );
  const citeCommand = (0, import_react15.useMemo)(() => citeCommandOf(keys), [keys]);
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
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: cards_default.exportRow, "data-export-card": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: cards_default.exportHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(
        "button",
        {
          type: "button",
          className: cards_default.exportToggle,
          "aria-expanded": open,
          onClick: () => {
            setOpen(!open);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: cards_default.exportTitle, children: formatLabelOf(artifact.format, t) }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: cards_default.exportFacts, children: headFacts }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.IconChevronDownOutlineMedium, { className: clsx_default(cards_default.chevron, open && cards_default.chevronOpen) })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("span", { className: cards_default.lineActions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(CopyButton, { value: artifact.text, label: t("copyExport"), copiedLabel: t("copied") }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("button", { type: "button", className: quiet_default.quiet, onClick: download, children: `${t("downloadArtifact")} ${extensionOf(artifact.format)}` })
      ] })
    ] }),
    open && /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: cards_default.exportBody, children: [
      citeCommand !== "" && /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("p", { className: cards_default.exportKeys, title: citeCommand, children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: cards_default.exportKeysText, children: keys.join(" \xB7 ") }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(CopyButton, { value: citeCommand, label: t("copyCite"), copiedLabel: t("copied") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("pre", { className: cards_default.exportPre, children: artifact.text })
    ] })
  ] });
}

// src/client/components/ExportDocumentRow.tsx
var import_react16 = require("react");
var import_dsh_client_ui_primitives21 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime21 = require("react/jsx-runtime");
function ExportDocumentRow({ doc, t }) {
  const [open, setOpen] = (0, import_react16.useState)(false);
  const citeCommand = (0, import_react16.useMemo)(
    () => doc.key === void 0 ? "" : citeCommandOf([doc.key]),
    [doc.key]
  );
  const download = () => {
    const base = sanitizeFileStem(doc.key ?? shortKeyOf(doc.ref) ?? "export");
    downloadBlob(doc.text, `zotero-${base}${extensionOf(doc.format)}`, mimeOf(doc.format));
  };
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("section", { className: cards_default.exportRow, "data-export-document": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: cards_default.exportHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
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
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: doc.key === void 0 ? cards_default.exportTitle : cards_default.documentKey, children: doc.key ?? doc.title ?? formatLabelOf(doc.format, t) }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.IconChevronDownOutlineMedium, { className: clsx_default(cards_default.chevron, open && cards_default.chevronOpen) })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("span", { className: cards_default.lineActions, children: [
        citeCommand !== "" && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(CopyButton, { value: citeCommand, label: t("copyCite"), copiedLabel: t("copied") }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("button", { type: "button", className: quiet_default.quiet, onClick: download, children: `${t("downloadArtifact")} ${extensionOf(doc.format)}` })
      ] })
    ] }),
    doc.key !== void 0 && doc.title !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: cards_default.documentTitle, children: doc.title }),
    open && /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: cards_default.exportBody, children: /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: cards_default.exportCode, children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: cards_default.exportCodeHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { className: cards_default.exportCodeLabel, children: formatLabelOf(doc.format, t) }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(CopyButton, { value: doc.text, label: t("copyExport"), copiedLabel: t("copied") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("pre", { className: cards_default.exportPre, children: doc.text })
    ] }) })
  ] });
}

// src/client/components/ExportSections.tsx
var import_jsx_runtime22 = require("react/jsx-runtime");
function sectionTextOf(section) {
  return section.documents.map((document2) => document2.text).join("\n\n");
}
function downloadSection(section) {
  downloadBlob(sectionTextOf(section), fileNameForFormat(section.format), mimeOf(section.format));
}
function downloadArtifact(artifact) {
  downloadBlob(artifact.text, fileNameOf(artifact), mimeOf(artifact.format));
}
function ExportSections({ exports, t }) {
  const sections = (0, import_react17.useMemo)(() => exportSectionsOf(exports), [exports]);
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: cards_default.exportStack, children: sections.map((section) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(
    "section",
    {
      className: cards_default.exportSection,
      "data-export-format": section.format,
      children: [
        section.documents.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("header", { className: cards_default.exportSectionHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: cards_default.exportSectionTitle, children: formatLabelOf(section.format, t) }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: cards_default.exportSectionCount, children: section.documents.length }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { className: cards_default.exportSectionActions, children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
              CopyButton,
              {
                value: sectionTextOf(section),
                label: t("copyAll"),
                copiedLabel: t("copied")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
              "button",
              {
                type: "button",
                className: quiet_default.quiet,
                onClick: () => {
                  downloadSection(section);
                },
                children: `${t("downloadAll")} ${extensionOf(section.format)}`
              }
            )
          ] })
        ] }),
        section.documents.map((document2) => /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ExportDocumentRow, { doc: document2, t }, document2.ref)),
        section.unresolvedItems.map((group) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: cards_default.unresolvedItems, children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: cards_default.unresolvedItemsText, children: t("unresolvedItemsNote", { count: group.count }) }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
            "button",
            {
              type: "button",
              className: quiet_default.quiet,
              onClick: () => {
                downloadArtifact(group.artifact);
              },
              children: `${t("downloadFull")} ${formatLabelOf(group.artifact.format, t)}`
            }
          )
        ] }, group.artifact.callId)),
        section.unresolved.map((artifact) => /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ExportCard, { artifact, t }, artifact.callId))
      ]
    },
    section.format
  )) });
}

// src/client/components/workspace/SourceExports.tsx
var import_jsx_runtime23 = require("react/jsx-runtime");
function SourceExports({ item, t }) {
  if (item.exports.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: workspace_default.panel, children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: workspace_default.note, children: t("exportsEmptyNote") }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: workspace_default.panel, children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ExportSections, { exports: item.exports, t }) });
}

// src/client/components/workspace/SourceInspector.tsx
var import_jsx_runtime24 = require("react/jsx-runtime");
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
  t,
  openFile,
  resolveAttachment
}) {
  const [panel, setPanel] = (0, import_react18.useState)("overview");
  const selected = (0, import_react18.useMemo)(
    () => workspace.sources.find((item) => item.key === selectedKey),
    [workspace.sources, selectedKey]
  );
  if (selected === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("main", { className: workspace_default.inspector, children: /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: workspace_default.emptyNote, children: t("inspectorEmptyNote") }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("main", { className: workspace_default.inspector, children: [
    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: workspace_default.inspectorHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: workspace_default.inspectorTitleWrap, children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: workspace_default.inspectorTitle, children: selected.title ?? selected.ref }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: workspace_default.inspectorMeta, children: [selected.creators, selected.year, selected.venue].filter(Boolean).join(" \xB7 ") })
      ] })
    ] }),
    selectionHidden && /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { className: workspace_default.warning, children: t("selectionHiddenNote") }),
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
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
        children: panelEntriesOf(selected).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)(
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
              entry.count !== void 0 && entry.count > 0 && /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { className: workspace_default.detailTabCount, children: entry.count })
            ]
          },
          entry.id
        ))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("div", { className: workspace_default.inspectorBody, children: panel === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
      SourceOverview,
      {
        item: selected,
        t,
        setDraft,
        openFile,
        resolveAttachment
      }
    ) : panel === "evidence" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(SourceEvidence, { item: selected, t }) : /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(SourceExports, { item: selected, t }) })
  ] });
}

// src/client/components/workspace/WorkspaceEmptyState.tsx
var import_dsh_client_ui_primitives22 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime25 = require("react/jsx-runtime");
function WorkspaceEmptyState({ t, setDraft }) {
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: workspace_default.empty, children: [
    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(import_dsh_client_ui_primitives22.IconBrowseOutlineMedium, { size: 16, className: workspace_default.emptyIcon }),
    /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("p", { className: workspace_default.emptyText, children: t("noSources") }),
    setDraft !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)("div", { className: workspace_default.starterRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        import_dsh_client_ui_primitives22.Pill,
        {
          onClick: () => {
            setDraft(t("starterFindTemplate"));
          },
          children: t("starterFind")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        import_dsh_client_ui_primitives22.Pill,
        {
          onClick: () => {
            setDraft(t("starterCompareTemplate"));
          },
          children: t("starterCompare")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        import_dsh_client_ui_primitives22.Pill,
        {
          onClick: () => {
            setDraft(t("starterEvidenceTemplate"));
          },
          children: t("starterEvidence")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
        import_dsh_client_ui_primitives22.Pill,
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
var import_jsx_runtime26 = require("react/jsx-runtime");
function ExportsPage({ workspace, t }) {
  const incomplete = incompleteExportsNoteOf(workspace.exportOperations, t);
  return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)("div", { className: workspace_default.exportsPage, children: [
    workspace.exports.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: workspace_default.note, children: t("exportsEmptyNote") }),
    incomplete !== "" && /* @__PURE__ */ (0, import_jsx_runtime26.jsx)("p", { className: workspace_default.note, children: t("exportsIncompleteNote", { counts: incomplete }) }),
    /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(ExportSections, { exports: workspace.exports, t })
  ] });
}

// src/client/components/EvidenceCard.tsx
var import_dsh_client_ui_primitives23 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime27 = require("react/jsx-runtime");
function PassageRow2({
  passage,
  pdfRef,
  pdfFilePath,
  evidenceMatch,
  onOpenFile,
  resolveAttachment,
  t
}) {
  const targetPdfRef = passage.attachmentRef ?? pdfRef;
  const targetFilePath = targetPdfRef === pdfRef ? pdfFilePath : void 0;
  const annotationKey = passage.source === "annotation" ? shortKeyOf(passage.sourceRef) : null;
  const annotationUrl = annotationKey !== null && targetPdfRef !== null ? pdfUrlOf(targetPdfRef, { annotation: annotationKey }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("li", { className: cards_default.passage, "data-source": passage.source, children: [
    /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("p", { className: cards_default.passageHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(import_dsh_client_ui_primitives23.Tag, { tone: "neutral", className: cards_default.sourceTag, children: t(sourceLabelKeyOf(passage.source)) }),
      passage.pageLabel !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: cards_default.note, children: t("pageLabel", { label: passage.pageLabel }) }),
      targetPdfRef !== null && (evidenceMatch === "mismatch" ? /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(BlockedReadAction, { label: t("readPdf"), t, className: cards_default.link }) : /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
        PdfReadButton,
        {
          attachmentRef: targetPdfRef,
          filePath: targetFilePath,
          onOpenFile,
          resolveAttachment,
          t,
          variant: "link",
          className: cards_default.link
        }
      )),
      annotationUrl !== null && /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)(import_jsx_runtime27.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)(
          "button",
          {
            type: "button",
            className: cards_default.link,
            onClick: () => void launchZoteroProtocol(annotationUrl),
            title: t("openInZoteroTooltip"),
            "aria-label": t("openInZotero"),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(import_dsh_client_ui_primitives23.IconLinkOutlineRegular, { size: 12, className: cards_default.linkIcon }),
              /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { children: t("openInZotero") })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
          CopyButton,
          {
            value: annotationUrl,
            label: t("copyZoteroLink"),
            copiedLabel: t("copied"),
            title: t("copyZoteroLinkTooltip"),
            className: cards_default.link
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("p", { className: cards_default.line, children: [
      passage.text,
      passage.previewTruncated ? ` ${t("truncatedPreview")}` : ""
    ] }),
    passage.callIds.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("p", { className: cards_default.note, children: t("retrievedMultiple", { count: passage.callIds.length }) })
  ] });
}
function pdfRefOf(capability) {
  return capability !== null && capability.kind === "file" ? capability.ref : null;
}
function EvidenceCard({ item, t, openFile, resolveAttachment }) {
  const handleOpenFile = openFile;
  const evidenceMatch = item.evidenceMatch;
  const selectUrl = selectUrlOf(item.ref);
  const pdfCapability = pdfCapabilityOf(item);
  const pdfRef = pdfRefOf(pdfCapability);
  const coverageLine = item.retrievalFacts?.coverage === void 0 ? "" : coverageLineOf(item.retrievalFacts.coverage, t);
  const availabilityEntries = item.retrievalFacts === void 0 ? [] : Object.entries(item.retrievalFacts.sourceAvailability);
  return /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("section", { className: cards_default.card, "data-evidence-match": item.evidenceMatch, children: [
    /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("header", { className: cards_default.cardHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: cards_default.cardTitle, children: item.title ?? item.ref }),
      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: cards_default.note, children: joinNonEmpty(item.creators, item.year) }),
      pdfCapability !== null && (evidenceMatch === "mismatch" ? /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(BlockedReadAction, { label: t("readPdf"), t, className: cards_default.link }) : /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
        PdfReadButton,
        {
          capability: pdfCapability,
          onOpenFile: handleOpenFile,
          resolveAttachment,
          t,
          variant: "link",
          className: cards_default.link
        }
      )),
      selectUrl !== null && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
        ZoteroLocateActions,
        {
          title: item.title,
          itemRef: item.ref,
          selectUrl,
          t,
          variant: "link",
          className: cards_default.link
        }
      ),
      evidenceMatch === "unknown" && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { className: cards_default.badge, title: t("instanceUnverified"), children: t("instanceUnverified") })
    ] }),
    coverageLine !== "" && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("p", { className: cards_default.note, children: coverageLine }),
    item.retrievalFacts?.truncated === true && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("p", { className: cards_default.note, children: t("budgetLimitedNote") }),
    /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("ul", { className: cards_default.passages, children: item.evidence.map((passage, index) => /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(
      PassageRow2,
      {
        passage,
        pdfRef,
        pdfFilePath: pdfCapability?.kind === "file" ? pdfCapability.filePath : void 0,
        evidenceMatch,
        onOpenFile: handleOpenFile,
        resolveAttachment,
        t
      },
      `${passage.sourceRef}-${index}`
    )) }),
    availabilityEntries.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("ul", { className: cards_default.availability, children: availabilityEntries.map(([source, entry]) => /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("li", { className: cards_default.note, children: t("availabilityEntry", {
      source: t(sourceLabelKeyOf(source)),
      detail: availabilityLineOf(entry, t)
    }) }, source)) }),
    item.retrievalFacts !== void 0 && item.evidence.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("p", { className: cards_default.note, children: emptyEvidenceNoteOf(item.facts.reportedEvidenceCount, t) })
  ] });
}

// src/client/components/workspace/EvidenceOverview.tsx
var import_jsx_runtime28 = require("react/jsx-runtime");
function EvidenceOverview({ workspace, onBack, openFile, t }) {
  const sources = filterSources(workspace.sources, "evidence");
  return /* @__PURE__ */ (0, import_jsx_runtime28.jsxs)("div", { className: workspace_default.evidencePage, children: [
    /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("button", { type: "button", className: workspace_default.backAction, onClick: onBack, children: t("backToSources") }),
    sources.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime28.jsx)("p", { className: workspace_default.emptyNote, children: t("evidenceEmptyNote") }) : /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(import_jsx_runtime28.Fragment, { children: sources.map((item) => /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(EvidenceCard, { item, openFile, t }, item.key)) })
  ] });
}

// src/client/components/workspace/ZoteroWorkspaceView.tsx
var import_jsx_runtime29 = require("react/jsx-runtime");
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
function effectiveSelectionOf(selection2, workspace, visible) {
  if (selection2.key !== void 0 && workspace.some((item) => item.key === selection2.key)) {
    return selection2.key;
  }
  return visible[0]?.key;
}
function ZoteroWorkspaceView({
  workspace,
  connection,
  setDraft,
  onRefresh,
  t,
  openFile,
  resolveAttachment
}) {
  const [lens, setLens] = (0, import_react19.useState)("sources");
  const [filter, setFilter] = (0, import_react19.useState)("all");
  const [selection2, setSelection] = (0, import_react19.useState)({ key: void 0, focusIndex: 0 });
  const [mobilePane, setMobilePane] = (0, import_react19.useState)("list");
  const [evidenceOpen, setEvidenceOpen] = (0, import_react19.useState)(false);
  const counts = (0, import_react19.useMemo)(() => filterCountsOf(workspace.sources), [workspace.sources]);
  const visible = (0, import_react19.useMemo)(
    () => filterSources(workspace.sources, filter),
    [workspace.sources, filter]
  );
  const selectedKey = (0, import_react19.useMemo)(
    () => effectiveSelectionOf(selection2, workspace.sources, visible),
    [selection2, workspace.sources, visible]
  );
  const exportedCount = (0, import_react19.useMemo)(() => exportedRefCountOf(workspace.exports), [workspace.exports]);
  if (evidenceOpen) {
    return /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("div", { className: workspace_default.view, "data-conversation-composer-overlay": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(WorkspaceToolbar, { connection, onRefresh, t }),
      /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(
        EvidenceOverview,
        {
          workspace,
          openFile,
          onBack: () => {
            setEvidenceOpen(false);
          },
          t
        }
      )
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(WorkspaceToolbar, { connection, onRefresh, t }),
        /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(
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
            children: LENSES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)(
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
                  entry.id === "exports" && exportedCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime29.jsx)("span", { className: workspace_default.lensTabCount, children: exportedCount })
                ]
              },
              entry.id
            ))
          }
        ),
        lens === "exports" ? /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(ExportsPage, { workspace, t }) : workspace.sources.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(WorkspaceEmptyState, { setDraft, t }) : /* @__PURE__ */ (0, import_jsx_runtime29.jsxs)("div", { className: workspace_default.workspace, "data-pane": mobilePane, children: [
          /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(
            SourceSidebar,
            {
              workspace,
              filter,
              counts,
              visible,
              selection: selection2,
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
          /* @__PURE__ */ (0, import_jsx_runtime29.jsx)(
            SourceInspector,
            {
              workspace,
              selectedKey,
              selectionHidden: selectedKey !== void 0 && !visible.some((item) => item.key === selectedKey),
              setMobilePane,
              setDraft,
              openFile,
              resolveAttachment,
              t
            },
            selectedKey
          )
        ] })
      ]
    }
  );
}

// src/client/components/SourcesTab.tsx
var import_jsx_runtime30 = require("react/jsx-runtime");
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
  return formatTime(/* @__PURE__ */ new Date(), true);
}
var SNAPSHOT_SIGNATURE_CACHE = /* @__PURE__ */ new WeakMap();
function sessionSignatureOf(snapshot) {
  if (snapshot === void 0) return "";
  const cached = SNAPSHOT_SIGNATURE_CACHE.get(snapshot);
  if (cached !== void 0) return cached;
  const running = [];
  const order = [];
  visitVisibleZoteroCalls(snapshot, (block, path) => {
    order.push({ callId: block.callId, path });
    if (!isSettledTool(block)) running.push({ callId: block.callId, phase: block.phase });
  });
  const signature = JSON.stringify({ order, running });
  SNAPSHOT_SIGNATURE_CACHE.set(snapshot, signature);
  return signature;
}
function collectZoteroCalls(snapshot) {
  const out = [];
  visitVisibleZoteroCalls(snapshot, (block) => {
    out.push(block);
  });
  return out;
}
function useZoteroBlocks(chat, sessionId) {
  const signature = (0, import_react20.useMemo)(
    () => `${sessionId ?? ""}:${sessionSignatureOf(chat)}`,
    [chat, sessionId]
  );
  return (0, import_react20.useMemo)(() => collectZoteroCalls(chat), [signature]);
}
function sameZoteroProjection(a, b) {
  return sessionSignatureOf(a) === sessionSignatureOf(b);
}
function SourcesTab(props) {
  const sessionId = props.useSession((snapshot) => snapshot.sessionId);
  return /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(ZoteroSurfaceBoundary, { resetKey: sessionId, t: props.t, surface: "sources", children: /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(SourcesTabBody, { ...props, sessionId }) });
}
function SourcesTabBody({
  status,
  resolveAttachment,
  openResource,
  t,
  sessionId,
  useChat,
  useSessions,
  inputActions
}) {
  const cwd = useSessions((snapshot) => snapshot.byId[sessionId]?.cwd);
  const chat = useChat((snapshot) => snapshot, sameZoteroProjection);
  const { state: probeState, runProbe } = useZoteroProbe(status, { initialAutoRun: true });
  const [checkedAt, setCheckedAt] = (0, import_react20.useState)(() => currentTime());
  const prevDataRef = (0, import_react20.useRef)(probeState.data);
  (0, import_react20.useEffect)(() => {
    if (probeState.data !== void 0 && probeState.data !== prevDataRef.current) {
      prevDataRef.current = probeState.data;
      setCheckedAt(currentTime());
    }
  }, [probeState.data]);
  const statusState = (0, import_react20.useMemo)(() => {
    if (probeState.data !== void 0) {
      return probeState.data.connected ? { kind: "connected", data: probeState.data, checkedAt } : { kind: "unavailable", data: probeState.data, checkedAt };
    }
    if (probeState.error !== void 0) {
      return { kind: "remote-error", message: probeState.error };
    }
    return { kind: "loading" };
  }, [probeState.data, probeState.error, checkedAt]);
  const serverId = probeState.data?.connected ? probeState.data.serverId : void 0;
  const blocks = useZoteroBlocks(chat, sessionId);
  const workspace = (0, import_react20.useMemo)(
    () => buildSourceWorkspace(blocks, { currentServerId: serverId }),
    [blocks, serverId]
  );
  const setDraft = (0, import_react20.useMemo)(
    () => inputActions === void 0 ? void 0 : inputActions.setDraft.bind(inputActions),
    [inputActions]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime30.jsx)(
    ZoteroWorkspaceView,
    {
      workspace,
      connection: statusState,
      setDraft,
      onRefresh: runProbe,
      openFile: openResource === void 0 ? void 0 : (path) => {
        openResource(fileAddressFor(sessionId, cwd, path));
      },
      resolveAttachment,
      t
    },
    sessionId ?? "none"
  );
}

// src/settings-namespace.ts
var ZOTERO_SETTINGS_NAMESPACE = "zotero";
var SCHOLARLY_SETTINGS_NAMESPACE = "scholarly";

// src/contract.ts
var ZOTERO_REMOTE_PACKAGE = "dsh-zotero";
var ZOTERO_STATUS_TYPE_SYMBOL = "dsh-zotero#ZoteroStatusView";
var ZOTERO_REF_PARAM_TYPE_SYMBOL = "dsh-zotero#AttachmentRef";
var ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL = "dsh-zotero#ZoteroAttachmentLocationView";
var ZOTERO_DIAGNOSTICS_TYPE_SYMBOL = "dsh-zotero#ZoteroDiagnosticsView";
var ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL = "dsh-zotero#ZoteroClientErrorReport";
var ZOTERO_REPORT_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroReportResultView";
var ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL = "dsh-zotero#ProtocolUrl";
var ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroOpenProtocolResultView";
var ZOTERO_STATUS_INVOCATION_ID = "dsh-zotero#zotero/status";
var ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID = "dsh-zotero#zotero/resolveAttachment";
var ZOTERO_DIAGNOSTICS_INVOCATION_ID = "dsh-zotero#zotero/diagnostics";
var ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID = "dsh-zotero#zotero/reportClientError";
var ZOTERO_OPEN_PROTOCOL_INVOCATION_ID = "dsh-zotero#zotero/openProtocol";
var ZOTERO_STATUS_SERVICE_KEY = "zoteroRemote";
var ZOTERO_STATUS_METHOD = "status";
var ZOTERO_RESOLVE_ATTACHMENT_METHOD = "resolveAttachment";
var ZOTERO_DIAGNOSTICS_METHOD = "diagnostics";
var ZOTERO_REPORT_CLIENT_ERROR_METHOD = "reportClientError";
var ZOTERO_OPEN_PROTOCOL_METHOD = "openProtocol";
var ZOTERO_STATUS_INVOCATION_KIND = "direct";
function zoteroStatusInvocation(result) {
  return {
    id: ZOTERO_STATUS_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_STATUS_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: "signal" },
    parameters: [],
    result
  };
}
function zoteroResolveAttachmentInvocation(param, result) {
  return {
    id: ZOTERO_RESOLVE_ATTACHMENT_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_RESOLVE_ATTACHMENT_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: "signal" },
    parameters: [
      {
        name: "ref",
        wire: "ref",
        source: "json",
        codec: param
      }
    ],
    result
  };
}
function zoteroDiagnosticsInvocation(result) {
  return {
    id: ZOTERO_DIAGNOSTICS_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_DIAGNOSTICS_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: "signal" },
    parameters: [],
    result
  };
}
function zoteroReportClientErrorInvocation(param, result) {
  return {
    id: ZOTERO_REPORT_CLIENT_ERROR_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_REPORT_CLIENT_ERROR_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: "signal" },
    parameters: [
      {
        name: "report",
        wire: "report",
        source: "json",
        codec: param
      }
    ],
    result
  };
}
function zoteroOpenProtocolInvocation(param, result) {
  return {
    id: ZOTERO_OPEN_PROTOCOL_INVOCATION_ID,
    service: ZOTERO_STATUS_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method: ZOTERO_OPEN_PROTOCOL_METHOD,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: "signal" },
    parameters: [
      {
        name: "url",
        wire: "url",
        source: "json",
        codec: param
      }
    ],
    result
  };
}
var ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryBrowseRequestView";
var ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryBrowseResultView";
var ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL = "dsh-zotero#ZoteroLibrarySearchRequestView";
var ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroSearchResultView";
var ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryItemRequestView";
var ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroItemDetailView";
var ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryChildPageRequestView";
var ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroChildPageView";
var ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryExportRequestView";
var ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryExportResultView";
var ZOTERO_LIBRARY_BROWSE_INVOCATION_ID = "dsh-zotero#zotero/browse";
var ZOTERO_LIBRARY_SEARCH_INVOCATION_ID = "dsh-zotero#zotero/search";
var ZOTERO_LIBRARY_ITEM_INVOCATION_ID = "dsh-zotero#zotero/item";
var ZOTERO_LIBRARY_CHILD_PAGE_INVOCATION_ID = "dsh-zotero#zotero/childPage";
var ZOTERO_LIBRARY_EXPORT_INVOCATION_ID = "dsh-zotero#zotero/export";
var ZOTERO_LIBRARY_BROWSE_METHOD = "browse";
var ZOTERO_LIBRARY_SEARCH_METHOD = "search";
var ZOTERO_LIBRARY_ITEM_METHOD = "item";
var ZOTERO_LIBRARY_CHILD_PAGE_METHOD = "childPage";
var ZOTERO_LIBRARY_EXPORT_METHOD = "export";
var ZOTERO_LIBRARY_SETTINGS_NAMESPACE = "library";
var ZOTERO_LIBRARY_SERVICE_KEY = "zoteroLibrary";
var ZOTERO_LIBRARY_WRITE_METHOD = "write";
var ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryWriteRequestView";
var ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroLibraryWriteResultView";
function libraryInvocation(id, method, param, result) {
  return {
    id,
    service: ZOTERO_LIBRARY_SERVICE_KEY,
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    method,
    invocation: { kind: ZOTERO_STATUS_INVOCATION_KIND },
    cancellation: { parameter: "signal" },
    parameters: [{ name: "request", wire: "request", source: "json", codec: param }],
    result
  };
}
function zoteroLibraryWriteInvocation(param, result) {
  return libraryInvocation("dsh-zotero#zotero/write", ZOTERO_LIBRARY_WRITE_METHOD, param, result);
}
function zoteroLibraryBrowseInvocation(param, result) {
  return libraryInvocation(
    ZOTERO_LIBRARY_BROWSE_INVOCATION_ID,
    ZOTERO_LIBRARY_BROWSE_METHOD,
    param,
    result
  );
}
function zoteroLibrarySearchInvocation(param, result) {
  return libraryInvocation(
    ZOTERO_LIBRARY_SEARCH_INVOCATION_ID,
    ZOTERO_LIBRARY_SEARCH_METHOD,
    param,
    result
  );
}
function zoteroLibraryItemInvocation(param, result) {
  return libraryInvocation(
    ZOTERO_LIBRARY_ITEM_INVOCATION_ID,
    ZOTERO_LIBRARY_ITEM_METHOD,
    param,
    result
  );
}
function zoteroLibraryChildPageInvocation(param, result) {
  return libraryInvocation(
    ZOTERO_LIBRARY_CHILD_PAGE_INVOCATION_ID,
    ZOTERO_LIBRARY_CHILD_PAGE_METHOD,
    param,
    result
  );
}
function zoteroLibraryExportInvocation(param, result) {
  return libraryInvocation(
    ZOTERO_LIBRARY_EXPORT_INVOCATION_ID,
    ZOTERO_LIBRARY_EXPORT_METHOD,
    param,
    result
  );
}
var ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL = "dsh-zotero#ZoteroCollectionPathRequestView";
var ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL = "dsh-zotero#ZoteroCollectionPathResultView";
function zoteroCollectionPathInvocation(param, result) {
  return libraryInvocation("dsh-zotero#zotero/collectionPath", "collectionPath", param, result);
}

// src/wire-schemas.ts
var import_zod = require("zod");

// src/constants.ts
var ZOTERO_SORT_FIELDS = [
  "dateModified",
  "dateAdded",
  "date",
  "title",
  "creator"
];
var ZOTERO_EXPORT_FORMATS = [
  "citation",
  "bibliography",
  "bibtex",
  "biblatex",
  "ris",
  "csljson"
];
var ZOTERO_TRANSLATOR_EXPORT_FORMATS = [
  "bibtex",
  "biblatex",
  "ris",
  "csljson"
];
var ZOTERO_ITEMKEY_BATCH = 50;
var ZOTERO_CHILD_PAGE_ROWS = 50;
var ZOTERO_CHILD_PAGE_MAX_ROWS = 100;
var ZOTERO_YEAR_MIN = 0;
var ZOTERO_YEAR_MAX = 9999;
var ZOTERO_WRITE_TOOL_NAMES = [
  "zotero_create_note",
  "zotero_update_note",
  "zotero_update_item_tags",
  "zotero_update_item_collections",
  "zotero_batch_items",
  "zotero_create_collection",
  "zotero_update_collection",
  "zotero_delete_collection",
  "zotero_create_item",
  "zotero_update_item",
  "zotero_restore_items",
  "zotero_create_saved_search",
  "zotero_update_saved_search",
  "zotero_delete_saved_search",
  "zotero_delete_library_tags"
];
var ZOTERO_READ_TOOL_NAMES = [
  "zotero_search",
  "zotero_get",
  "zotero_children",
  "zotero_attachment",
  "zotero_retrieve",
  "zotero_browse",
  "zotero_export",
  "zotero_changes"
];
var ZOTERO_TOOL_NAMES = [...ZOTERO_READ_TOOL_NAMES, ...ZOTERO_WRITE_TOOL_NAMES];
var DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

// src/wire-schemas.ts
var zoteroLibrarySortSchema = import_zod.z.enum(
  ZOTERO_SORT_FIELDS
);
function strictCodec(typeSymbol, schema) {
  return { mode: "strict", typeSymbol, create: () => schema };
}
var zoteroStatusSchema = import_zod.z.object({
  providerId: import_zod.z.string(),
  // Optional on the wire because a service that is not composed dialled
  // nothing; required of every answer that reached a provider, which is what
  // `ZoteroStatus` (the provider's own record) carries.
  endpoint: import_zod.z.string().optional(),
  connected: import_zod.z.boolean(),
  apiVersion: import_zod.z.string().optional(),
  serverId: import_zod.z.string().optional(),
  schemaVersion: import_zod.z.string().optional(),
  zoteroVersion: import_zod.z.string().optional(),
  write: import_zod.z.object({ enabled: import_zod.z.boolean(), authorized: import_zod.z.boolean() }).strict().optional(),
  // Optional on the wire because a connected probe has nothing to diagnose;
  // the host-internal `ZoteroStatus` keeps the total field with the
  // `ZOTERO_DIAGNOSIS_OK` sentinel, which the wire producer strips.
  diagnosis: import_zod.z.string().optional()
}).strict().readonly();
var zoteroRefSchema = import_zod.z.string().min(1);
var zoteroAttachmentLocationSchema = import_zod.z.object({
  ref: import_zod.z.string(),
  kind: import_zod.z.enum(["file", "url"]),
  title: import_zod.z.string(),
  contentType: import_zod.z.string(),
  path: import_zod.z.string().optional(),
  url: import_zod.z.string().optional()
}).strict().readonly();
var zoteroDiagnosticsSchema = import_zod.z.object({
  entries: import_zod.z.array(
    import_zod.z.object({
      seq: import_zod.z.number(),
      ts: import_zod.z.number(),
      level: import_zod.z.enum(["debug", "info", "warn", "error"]),
      event: import_zod.z.string(),
      message: import_zod.z.string(),
      count: import_zod.z.number(),
      detail: import_zod.z.record(import_zod.z.string(), import_zod.z.union([import_zod.z.string(), import_zod.z.number(), import_zod.z.boolean()])).optional()
    }).strict().readonly()
  ).readonly(),
  total: import_zod.z.number(),
  truncated: import_zod.z.boolean(),
  debug: import_zod.z.boolean()
}).strict().readonly();
var zoteroClientErrorReportSchema = import_zod.z.object({
  surface: import_zod.z.string().min(1),
  message: import_zod.z.string().min(1),
  stack: import_zod.z.string().optional(),
  componentStack: import_zod.z.string().optional()
}).strict().readonly();
var zoteroReportResultSchema = import_zod.z.object({ seq: import_zod.z.number() }).strict().readonly();
var zoteroProtocolUrlSchema = import_zod.z.string().startsWith("zotero://");
var zoteroOpenProtocolResultSchema = import_zod.z.object({
  ok: import_zod.z.boolean(),
  error: import_zod.z.string().optional()
}).strict().readonly();
var zoteroPersonalLibrarySchema = import_zod.z.object({ type: import_zod.z.literal("user"), id: import_zod.z.literal(0) }).strict().readonly();
var zoteroLibrarySchema = import_zod.z.union([
  zoteroPersonalLibrarySchema,
  import_zod.z.object({ type: import_zod.z.literal("group"), id: import_zod.z.number().int().positive() }).strict().readonly()
]);
var zoteroResolvedScopeSchema = import_zod.z.discriminatedUnion("kind", [
  import_zod.z.object({ kind: import_zod.z.literal("library"), library: zoteroLibrarySchema }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("publications"), library: zoteroPersonalLibrarySchema }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("collection"), ref: import_zod.z.string(), name: import_zod.z.string() }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("savedSearch"), ref: import_zod.z.string(), name: import_zod.z.string() }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("trash"), library: zoteroLibrarySchema }).strict().readonly()
]);
var zoteroLibraryBrowseRequestSchema = import_zod.z.object({
  kind: import_zod.z.enum(["libraries", "collections", "savedSearches", "tags", "itemTypes"]),
  library: zoteroLibrarySchema.optional(),
  parentRef: import_zod.z.string().min(1).optional(),
  q: import_zod.z.string().min(1).optional(),
  match: import_zod.z.enum(["contains", "startsWith"]).optional(),
  offset: import_zod.z.number().int().nonnegative(),
  limit: import_zod.z.number().int().positive()
}).strict().readonly();
var zoteroSavedSearchConditionSchema = import_zod.z.object({
  condition: import_zod.z.string(),
  operator: import_zod.z.string(),
  value: import_zod.z.string()
}).strict().readonly();
var zoteroCollectionRowSchema = import_zod.z.object({
  kind: import_zod.z.literal("collection"),
  ref: import_zod.z.string(),
  name: import_zod.z.string(),
  parentRef: import_zod.z.string().optional(),
  path: import_zod.z.array(import_zod.z.string()).readonly(),
  depth: import_zod.z.number().int().nonnegative(),
  childCount: import_zod.z.number().int().nonnegative().optional(),
  itemCount: import_zod.z.number().int().nonnegative().optional()
}).strict().readonly();
var zoteroLibraryBrowseItemSchema = import_zod.z.discriminatedUnion("kind", [
  import_zod.z.object({ kind: import_zod.z.literal("tag"), tag: import_zod.z.string() }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("itemType"), itemType: import_zod.z.string(), localized: import_zod.z.string().optional() }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("library"), library: zoteroLibrarySchema, name: import_zod.z.string() }).strict().readonly(),
  zoteroCollectionRowSchema,
  import_zod.z.object({
    kind: import_zod.z.literal("savedSearch"),
    ref: import_zod.z.string(),
    name: import_zod.z.string(),
    conditions: import_zod.z.array(zoteroSavedSearchConditionSchema).readonly()
  }).strict().readonly()
]);
var zoteroLibraryBrowseResultSchema = import_zod.z.object({
  libraryVersion: import_zod.z.number().int().nonnegative().optional(),
  kind: import_zod.z.enum(["libraries", "collections", "savedSearches", "tags", "itemTypes"]),
  items: import_zod.z.array(zoteroLibraryBrowseItemSchema).readonly(),
  total: import_zod.z.number().int().nonnegative(),
  offset: import_zod.z.number().int().nonnegative(),
  returned: import_zod.z.number().int().nonnegative(),
  limit: import_zod.z.number().int().positive(),
  nextOffset: import_zod.z.number().int().nonnegative().optional()
}).strict().refine(
  (value) => !["collections", "savedSearches"].includes(value.kind) || value.libraryVersion !== void 0,
  { message: "Navigation results require a library version." }
).readonly();
var zoteroLibrarySearchScopeSchema = import_zod.z.discriminatedUnion("kind", [
  import_zod.z.object({ kind: import_zod.z.literal("library") }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("publications") }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("collection"), refOrName: import_zod.z.string().min(1) }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("savedSearch"), refOrName: import_zod.z.string().min(1) }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("trash") }).strict().readonly()
]);
var zoteroLibraryFiltersSchema = import_zod.z.object({
  itemTypes: import_zod.z.array(import_zod.z.string().min(1)).readonly().optional(),
  tags: import_zod.z.array(import_zod.z.string().min(1)).readonly().optional(),
  tagMatch: import_zod.z.enum(["all", "any"]).optional(),
  yearFrom: import_zod.z.number().int().min(ZOTERO_YEAR_MIN).max(ZOTERO_YEAR_MAX).optional(),
  yearTo: import_zod.z.number().int().min(ZOTERO_YEAR_MIN).max(ZOTERO_YEAR_MAX).optional(),
  hasAttachment: import_zod.z.boolean().optional()
}).strict();
var zoteroLibrarySearchRequestSchema = import_zod.z.object({
  scope: zoteroLibrarySearchScopeSchema,
  library: zoteroLibrarySchema.optional(),
  q: import_zod.z.string().optional(),
  mode: import_zod.z.enum(["metadata", "everything"]).optional(),
  sort: zoteroLibrarySortSchema,
  direction: import_zod.z.enum(["asc", "desc"]),
  offset: import_zod.z.number().int().nonnegative(),
  limit: import_zod.z.number().int().positive(),
  itemLevel: import_zod.z.enum(["top", "all"]).optional(),
  ...zoteroLibraryFiltersSchema.shape,
  cacheGeneration: import_zod.z.number().int().nonnegative().optional()
}).strict().readonly();
var zoteroSearchItemSchema = import_zod.z.object({
  ref: import_zod.z.string(),
  title: import_zod.z.string(),
  creatorSummary: import_zod.z.string(),
  year: import_zod.z.number().optional(),
  itemType: import_zod.z.string(),
  parentRef: import_zod.z.string().optional(),
  bestAttachmentRef: import_zod.z.string().optional(),
  bestAttachmentType: import_zod.z.string().optional(),
  attachmentSize: import_zod.z.number().optional(),
  extra: import_zod.z.string().optional(),
  doi: import_zod.z.string().optional()
}).strict().readonly();
var zoteroSearchResultSchema = import_zod.z.object({
  scope: zoteroResolvedScopeSchema,
  items: import_zod.z.array(zoteroSearchItemSchema).readonly(),
  total: import_zod.z.number().int().nonnegative(),
  offset: import_zod.z.number().int().nonnegative(),
  returned: import_zod.z.number().int().nonnegative(),
  limit: import_zod.z.number().int().positive(),
  nextOffset: import_zod.z.number().int().nonnegative().optional()
}).strict().readonly();
var childPageSchema = import_zod.z.object({
  offset: import_zod.z.number().int().nonnegative(),
  limit: import_zod.z.number().int().positive().max(ZOTERO_CHILD_PAGE_MAX_ROWS)
}).strict().readonly();
var zoteroLibraryItemRequestSchema = import_zod.z.object({
  ref: import_zod.z.string().min(1),
  include: import_zod.z.array(import_zod.z.enum(["notes", "attachments", "annotations"])).readonly(),
  childPages: import_zod.z.object({
    notes: childPageSchema.optional(),
    attachments: childPageSchema.optional(),
    annotations: childPageSchema.optional()
  }).strict().readonly().optional()
}).strict().readonly();
function childRowsSchema(item) {
  return import_zod.z.object({
    total: import_zod.z.number().int().nonnegative(),
    returned: import_zod.z.number().int().nonnegative(),
    offset: import_zod.z.number().int().nonnegative(),
    limit: import_zod.z.number().int().positive(),
    nextOffset: import_zod.z.number().int().nonnegative().optional(),
    items: import_zod.z.array(item).readonly()
  }).strict().readonly();
}
var zoteroNoteRowSchema = import_zod.z.object({
  ref: import_zod.z.string(),
  text: import_zod.z.string(),
  truncated: import_zod.z.boolean(),
  parentRef: import_zod.z.string().optional()
}).strict().readonly();
var zoteroAnnotationRowSchema = import_zod.z.object({
  ref: import_zod.z.string(),
  type: import_zod.z.string(),
  text: import_zod.z.string(),
  comment: import_zod.z.string().optional(),
  color: import_zod.z.string().optional(),
  pageLabel: import_zod.z.string().optional(),
  parentRef: import_zod.z.string().optional()
}).strict().readonly();
var zoteroAttachmentRowSchema = import_zod.z.object({
  ref: import_zod.z.string(),
  title: import_zod.z.string(),
  contentType: import_zod.z.string()
}).strict().readonly();
var zoteroLibraryChildPageRequestSchema = import_zod.z.object({
  ref: import_zod.z.string().min(1),
  kind: import_zod.z.enum(["notes", "attachments", "annotations"]),
  offset: import_zod.z.number().int().nonnegative(),
  limit: import_zod.z.number().int().positive().max(ZOTERO_CHILD_PAGE_MAX_ROWS)
}).strict().readonly();
var zoteroChildPageSchema = import_zod.z.discriminatedUnion("kind", [
  import_zod.z.object({ kind: import_zod.z.literal("notes"), page: childRowsSchema(zoteroNoteRowSchema) }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("attachments"), page: childRowsSchema(zoteroAttachmentRowSchema) }).strict().readonly(),
  import_zod.z.object({ kind: import_zod.z.literal("annotations"), page: childRowsSchema(zoteroAnnotationRowSchema) }).strict().readonly()
]);
var zoteroItemDetailSchema = import_zod.z.object({
  ref: import_zod.z.string(),
  itemType: import_zod.z.string(),
  title: import_zod.z.string(),
  creators: import_zod.z.array(
    import_zod.z.object({
      creatorType: import_zod.z.string(),
      name: import_zod.z.string().optional(),
      firstName: import_zod.z.string().optional(),
      lastName: import_zod.z.string().optional()
    }).strict().readonly()
  ).readonly(),
  extra: import_zod.z.string().optional(),
  date: import_zod.z.string().optional(),
  year: import_zod.z.number().optional(),
  venue: import_zod.z.string().optional(),
  doi: import_zod.z.string().optional(),
  url: import_zod.z.string().optional(),
  abstract: import_zod.z.string().optional(),
  abstractTruncated: import_zod.z.boolean(),
  noteBody: import_zod.z.object({ text: import_zod.z.string(), truncated: import_zod.z.boolean() }).strict().readonly().optional(),
  tags: import_zod.z.array(import_zod.z.string()).readonly(),
  collections: import_zod.z.array(import_zod.z.object({ ref: import_zod.z.string(), name: import_zod.z.string().optional() }).strict().readonly()).readonly(),
  children: import_zod.z.object({ total: import_zod.z.number().int().nonnegative() }).strict().readonly(),
  bestAttachment: zoteroAttachmentRowSchema.optional(),
  notes: childRowsSchema(zoteroNoteRowSchema).optional(),
  annotations: childRowsSchema(zoteroAnnotationRowSchema).optional(),
  attachments: childRowsSchema(zoteroAttachmentRowSchema).optional()
}).strict().readonly();
var zoteroLibraryExportFormatSchema = import_zod.z.enum(
  ZOTERO_EXPORT_FORMATS
);
var zoteroLibraryTranslatorExportFormatSchema = import_zod.z.enum(
  ZOTERO_TRANSLATOR_EXPORT_FORMATS
);
var zoteroLibraryExportRequestSchema = import_zod.z.object({
  refs: import_zod.z.array(import_zod.z.string().min(1)).min(1).max(ZOTERO_ITEMKEY_BATCH).readonly(),
  format: zoteroLibraryExportFormatSchema,
  style: import_zod.z.string().min(1).optional(),
  locale: import_zod.z.string().min(1).optional()
}).strict().readonly();
var zoteroLibraryExportResultSchema = import_zod.z.discriminatedUnion("format", [
  import_zod.z.object({
    format: import_zod.z.literal("citation"),
    style: import_zod.z.string().optional(),
    locale: import_zod.z.string().optional(),
    citations: import_zod.z.array(import_zod.z.object({ ref: import_zod.z.string(), text: import_zod.z.string() }).strict().readonly()).readonly()
  }).strict().readonly(),
  import_zod.z.object({
    format: import_zod.z.literal("bibliography"),
    style: import_zod.z.string().optional(),
    locale: import_zod.z.string().optional(),
    text: import_zod.z.string()
  }).strict().readonly(),
  import_zod.z.object({
    format: zoteroLibraryTranslatorExportFormatSchema,
    style: import_zod.z.string().optional(),
    locale: import_zod.z.string().optional(),
    text: import_zod.z.string()
  }).strict().readonly()
]).readonly();
var writeText = import_zod.z.string().min(1);
var writeList = import_zod.z.array(writeText);
var writeFields = import_zod.z.object({
  title: writeText.optional(),
  date: writeText.optional(),
  url: writeText.optional(),
  doi: writeText.optional(),
  abstractNote: writeText.optional(),
  publicationTitle: writeText.optional(),
  extra: writeText.optional()
}).strict();
var writeCreateItem = import_zod.z.object({
  itemType: writeText,
  title: writeText.optional(),
  url: writeText.optional(),
  date: writeText.optional(),
  doi: writeText.optional(),
  abstractNote: writeText.optional(),
  publicationTitle: writeText.optional(),
  tags: writeList.optional(),
  collections: writeList.optional(),
  creators: import_zod.z.array(
    import_zod.z.object({
      creatorType: writeText,
      name: import_zod.z.string().optional(),
      firstName: import_zod.z.string().optional(),
      lastName: import_zod.z.string().optional()
    }).strict()
  ).optional()
}).strict();
var writeBatchUpdate = import_zod.z.object({
  ref: writeText,
  addTags: writeList.optional(),
  removeTags: writeList.optional(),
  addCollections: writeList.optional(),
  removeCollections: writeList.optional()
}).strict();
var writeConditions = import_zod.z.array(
  import_zod.z.object({ condition: writeText, operator: import_zod.z.string(), value: import_zod.z.string() }).strict()
);
var writeBase = { sessionId: writeText };
var writeArm = (operation, shape) => import_zod.z.object({ ...writeBase, operation: import_zod.z.literal(operation), args: import_zod.z.object(shape).strict() }).strict();
var zoteroLibraryWriteRequestSchema = import_zod.z.discriminatedUnion("operation", [
  writeArm("updateItem", { ref: writeText, set: writeFields }),
  writeArm("updateTags", {
    ref: writeText,
    add: writeList.optional(),
    remove: writeList.optional()
  }),
  writeArm("updateMembership", {
    ref: writeText,
    add: writeList.optional(),
    remove: writeList.optional()
  }),
  writeArm("createItem", writeCreateItem.shape),
  writeArm("createNote", {
    markdown: writeText,
    parentItem: writeText.optional(),
    collections: writeList.optional(),
    tags: writeList.optional(),
    sourceRefs: writeList.optional()
  }),
  writeArm("updateNote", { ref: writeText, markdown: writeText }),
  writeArm("createCollection", { name: writeText, parent: writeText.optional() }),
  writeArm("updateCollection", {
    collection: writeText,
    name: writeText.optional(),
    parent: writeText.optional()
  }),
  writeArm("deleteCollection", { collection: writeText }),
  writeArm("createSavedSearch", { name: writeText, conditions: writeConditions }),
  writeArm("updateSavedSearch", {
    search: writeText,
    name: writeText.optional(),
    conditions: writeConditions.optional()
  }),
  writeArm("deleteSavedSearch", { search: writeText }),
  writeArm("trash", { refs: writeList }),
  writeArm("restore", { refs: writeList }),
  writeArm("batch", {
    create: import_zod.z.array(writeCreateItem).optional(),
    update: import_zod.z.array(writeBatchUpdate).optional(),
    delete: writeList.optional()
  })
]);
var zoteroLibraryWriteResultSchema = import_zod.z.object({
  kind: import_zod.z.enum(["applied", "declined", "committed-unverified", "failed"]),
  message: import_zod.z.string(),
  code: import_zod.z.string().optional()
}).strict().readonly();
var zoteroCollectionPathRequestSchema = import_zod.z.object({
  library: zoteroLibrarySchema,
  ref: import_zod.z.string().min(1),
  libraryVersion: import_zod.z.number().int().nonnegative()
}).strict().readonly();
var zoteroCollectionPathResultSchema = import_zod.z.object({
  library: zoteroLibrarySchema,
  libraryVersion: import_zod.z.number().int().nonnegative(),
  path: import_zod.z.array(zoteroCollectionRowSchema).readonly()
}).strict().readonly();

// src/client/status-codec.ts
var ZOTERO_STATUS_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_STATUS_TYPE_SYMBOL,
  zoteroStatusSchema
);
var ZOTERO_REF_CLIENT_PARAM_CODEC = strictCodec(ZOTERO_REF_PARAM_TYPE_SYMBOL, zoteroRefSchema);
var ZOTERO_RESOLVE_ATTACHMENT_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_RESOLVE_ATTACHMENT_TYPE_SYMBOL,
  zoteroAttachmentLocationSchema
);
var ZOTERO_DIAGNOSTICS_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_DIAGNOSTICS_TYPE_SYMBOL,
  zoteroDiagnosticsSchema
);
var ZOTERO_CLIENT_ERROR_REPORT_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_CLIENT_ERROR_REPORT_TYPE_SYMBOL,
  zoteroClientErrorReportSchema
);
var ZOTERO_REPORT_RESULT_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_REPORT_RESULT_TYPE_SYMBOL,
  zoteroReportResultSchema
);
var ZOTERO_OPEN_PROTOCOL_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_OPEN_PROTOCOL_PARAM_TYPE_SYMBOL,
  zoteroProtocolUrlSchema
);
var ZOTERO_OPEN_PROTOCOL_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_OPEN_PROTOCOL_RESULT_TYPE_SYMBOL,
  zoteroOpenProtocolResultSchema
);
var ZOTERO_LIBRARY_BROWSE_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_BROWSE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryBrowseRequestSchema
);
var ZOTERO_LIBRARY_BROWSE_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_BROWSE_RESULT_TYPE_SYMBOL,
  zoteroLibraryBrowseResultSchema
);
var ZOTERO_LIBRARY_SEARCH_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_SEARCH_REQUEST_TYPE_SYMBOL,
  zoteroLibrarySearchRequestSchema
);
var ZOTERO_LIBRARY_SEARCH_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_SEARCH_RESULT_TYPE_SYMBOL,
  zoteroSearchResultSchema
);
var ZOTERO_LIBRARY_ITEM_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_ITEM_REQUEST_TYPE_SYMBOL,
  zoteroLibraryItemRequestSchema
);
var ZOTERO_LIBRARY_ITEM_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_ITEM_RESULT_TYPE_SYMBOL,
  zoteroItemDetailSchema
);
var ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_CHILD_PAGE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryChildPageRequestSchema
);
var ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_CHILD_PAGE_RESULT_TYPE_SYMBOL,
  zoteroChildPageSchema
);
var ZOTERO_LIBRARY_EXPORT_CLIENT_PARAM_CODEC = strictCodec(
  ZOTERO_LIBRARY_EXPORT_REQUEST_TYPE_SYMBOL,
  zoteroLibraryExportRequestSchema
);
var ZOTERO_LIBRARY_EXPORT_CLIENT_RESULT_CODEC = strictCodec(
  ZOTERO_LIBRARY_EXPORT_RESULT_TYPE_SYMBOL,
  zoteroLibraryExportResultSchema
);
var zoteroLibraryWriteRequestCodec = strictCodec(
  ZOTERO_LIBRARY_WRITE_REQUEST_TYPE_SYMBOL,
  zoteroLibraryWriteRequestSchema
);
var zoteroLibraryWriteResultCodec = strictCodec(
  ZOTERO_LIBRARY_WRITE_RESULT_TYPE_SYMBOL,
  zoteroLibraryWriteResultSchema
);
var ZOTERO_CLIENT_INVOCATIONS = Object.freeze([
  zoteroStatusInvocation(ZOTERO_STATUS_CLIENT_RESULT_CODEC),
  zoteroResolveAttachmentInvocation(
    ZOTERO_REF_CLIENT_PARAM_CODEC,
    ZOTERO_RESOLVE_ATTACHMENT_CLIENT_RESULT_CODEC
  ),
  zoteroDiagnosticsInvocation(ZOTERO_DIAGNOSTICS_CLIENT_RESULT_CODEC),
  zoteroReportClientErrorInvocation(
    ZOTERO_CLIENT_ERROR_REPORT_CLIENT_PARAM_CODEC,
    ZOTERO_REPORT_RESULT_CLIENT_RESULT_CODEC
  ),
  zoteroOpenProtocolInvocation(
    ZOTERO_OPEN_PROTOCOL_CLIENT_PARAM_CODEC,
    ZOTERO_OPEN_PROTOCOL_CLIENT_RESULT_CODEC
  ),
  zoteroCollectionPathInvocation(
    strictCodec(ZOTERO_COLLECTION_PATH_REQUEST_TYPE_SYMBOL, zoteroCollectionPathRequestSchema),
    strictCodec(ZOTERO_COLLECTION_PATH_RESULT_TYPE_SYMBOL, zoteroCollectionPathResultSchema)
  ),
  zoteroLibraryBrowseInvocation(
    ZOTERO_LIBRARY_BROWSE_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_BROWSE_CLIENT_RESULT_CODEC
  ),
  zoteroLibrarySearchInvocation(
    ZOTERO_LIBRARY_SEARCH_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_SEARCH_CLIENT_RESULT_CODEC
  ),
  zoteroLibraryItemInvocation(
    ZOTERO_LIBRARY_ITEM_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_ITEM_CLIENT_RESULT_CODEC
  ),
  zoteroLibraryChildPageInvocation(
    ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_CHILD_PAGE_CLIENT_RESULT_CODEC
  ),
  zoteroLibraryExportInvocation(
    ZOTERO_LIBRARY_EXPORT_CLIENT_PARAM_CODEC,
    ZOTERO_LIBRARY_EXPORT_CLIENT_RESULT_CODEC
  ),
  zoteroLibraryWriteInvocation(zoteroLibraryWriteRequestCodec, zoteroLibraryWriteResultCodec)
]);

// src/client/remote.ts
var ZOTERO_REMOTE = {
  package: ZOTERO_REMOTE_PACKAGE,
  descriptors: ZOTERO_CLIENT_INVOCATIONS
};

// src/client/library-form-controller.ts
var import_dsh_client_ui_primitives24 = require("@deepseek-ai/dsh-client-ui-primitives");
function fieldSpecs3() {
  return [booleanFieldSpec("rightSidebarEnabled")];
}
var LibraryFormController = class {
  model;
  store;
  constructor(form) {
    const scope = asFormScope(form);
    this.model = new import_dsh_client_ui_primitives24.SettingsFormModel(scope, fieldSpecs3());
    this.store = this.model.bind(() => this.project());
  }
  project() {
    const shell = this.model.shell();
    return {
      ...shell,
      rightSidebarEnabled: this.model.field("rightSidebarEnabled")
    };
  }
  inject() {
    const actions = this.model.actions();
    return {
      hooks: {
        libraryCard: this.store
      },
      edit: actions.edit,
      resetField: actions.resetField,
      save: actions.save,
      discard: actions.discard
    };
  }
  dispose() {
    this.model.dispose();
  }
};

// src/client/components/plugin/ZoteroActivationGuide.tsx
var import_dsh_client_ui_primitives25 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/plugin/plugin-cards.module.css
var style11 = `.fUMSYG_section{flex-direction:column;gap:10px;display:flex}.fUMSYG_sectionHead{justify-content:space-between;align-items:center;display:flex}.fUMSYG_sectionTitle{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);margin:0;font-weight:500}.fUMSYG_sectionGrid{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;display:grid}.fUMSYG_card{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);flex-direction:column;gap:8px;padding:12px 14px;display:flex}.fUMSYG_cardHead{justify-content:space-between;align-items:center;gap:8px;display:flex}.fUMSYG_cardTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);margin:0;font-weight:600}.fUMSYG_refreshButton{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;padding:2px 6px}@media (hover:hover){.fUMSYG_refreshButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}}.fUMSYG_statusRow{font:var(--dsw-font-xxs-12);align-items:center;gap:8px;font-weight:500;display:flex}.fUMSYG_statusRow[data-state=connected]{color:var(--dsw-alias-state-success-secondary)}.fUMSYG_statusRow[data-state=disconnected]{color:var(--dsw-alias-state-warn-label)}.fUMSYG_statusDetail{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);margin:0}.fUMSYG_tipList{flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;display:flex}.fUMSYG_tipItem{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);align-items:baseline;gap:6px;display:flex}.fUMSYG_tipBullet{color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxs-12);flex:none}.fUMSYG_activationModal{width:min(520px,100%)}.fUMSYG_activationContent{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.fUMSYG_activationSteps{flex-direction:column;gap:10px;margin:0;padding:0;list-style:none;display:flex}.fUMSYG_activationStep{align-items:flex-start;gap:10px;display:flex}.fUMSYG_activationStepIndex{corner-shape:round;background:var(--dsw-alias-bg-layer-3);width:20px;height:20px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-11);border-radius:50%;flex:none;justify-content:center;align-items:center;font-weight:600;display:flex}.fUMSYG_activationStepBody{flex-direction:column;gap:2px;min-width:0;display:flex}.fUMSYG_activationStepText{color:var(--dsw-alias-label-primary);font-weight:500}.fUMSYG_activationStepNote{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-warn-label);margin:0}.fUMSYG_activationFooter{justify-content:space-between;align-items:center;gap:12px;width:100%;display:flex}.fUMSYG_activationFooterActions{align-items:center;gap:8px;display:flex}.fUMSYG_diagToolbar{justify-content:space-between;align-items:center;gap:8px;padding:8px 0;display:flex}.fUMSYG_diagList{border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:2px;max-height:320px;padding-top:8px;display:flex;overflow-y:auto}.fUMSYG_diagRow{align-items:baseline;gap:8px;padding:2px 0;display:flex}.fUMSYG_diagTime{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none}.fUMSYG_diagBody{flex-wrap:wrap;align-items:baseline;gap:6px;min-width:0;display:flex}.fUMSYG_diagEvent{font:var(--dsw-font-markdown-code-block-small);color:var(--dsw-alias-label-secondary)}.fUMSYG_diagCount{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:0 4px}.fUMSYG_diagMessage{width:100%;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;margin:0}.fUMSYG_diagDetail summary{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);cursor:pointer}.fUMSYG_diagDetail pre{font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);margin:4px 0 0}.fUMSYG_diagEmpty{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0}.fUMSYG_diagFetchError{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);margin:0}.fUMSYG_diagFooter{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary);margin:0}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/plugin/plugin-cards.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/plugin/plugin-cards.module.css");
  tag.textContent = style11;
  document.head.appendChild(tag);
}
var plugin_cards_default = { "statusDetail": "fUMSYG_statusDetail", "statusRow": "fUMSYG_statusRow", "activationStep": "fUMSYG_activationStep", "cardHead": "fUMSYG_cardHead", "tipBullet": "fUMSYG_tipBullet", "activationFooterActions": "fUMSYG_activationFooterActions", "card": "fUMSYG_card", "diagFetchError": "fUMSYG_diagFetchError", "sectionHead": "fUMSYG_sectionHead", "diagFooter": "fUMSYG_diagFooter", "activationStepIndex": "fUMSYG_activationStepIndex", "refreshButton": "fUMSYG_refreshButton", "diagDetail": "fUMSYG_diagDetail", "activationStepBody": "fUMSYG_activationStepBody", "diagRow": "fUMSYG_diagRow", "activationContent": "fUMSYG_activationContent", "activationStepNote": "fUMSYG_activationStepNote", "sectionTitle": "fUMSYG_sectionTitle", "activationFooter": "fUMSYG_activationFooter", "diagMessage": "fUMSYG_diagMessage", "diagTime": "fUMSYG_diagTime", "diagCount": "fUMSYG_diagCount", "sectionGrid": "fUMSYG_sectionGrid", "activationModal": "fUMSYG_activationModal", "cardTitle": "fUMSYG_cardTitle", "section": "fUMSYG_section", "diagList": "fUMSYG_diagList", "diagEvent": "fUMSYG_diagEvent", "tipItem": "fUMSYG_tipItem", "activationSteps": "fUMSYG_activationSteps", "diagToolbar": "fUMSYG_diagToolbar", "tipList": "fUMSYG_tipList", "diagEmpty": "fUMSYG_diagEmpty", "diagBody": "fUMSYG_diagBody", "activationStepText": "fUMSYG_activationStepText" };

// src/client/components/plugin/ZoteroActivationGuide.tsx
var import_jsx_runtime31 = require("react/jsx-runtime");
function ZoteroActivationGuide({
  packageName,
  onDismiss,
  onOpenDetails,
  t,
  probe
}) {
  if (packageName !== ZOTERO_REMOTE_PACKAGE) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
    import_dsh_client_ui_primitives25.Modal,
    {
      open: true,
      className: plugin_cards_default.activationModal,
      title: t("activationTitle"),
      description: t("activationDescription"),
      closeLabel: t("activationClose"),
      onClose: onDismiss,
      footer: /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: plugin_cards_default.activationFooter, children: [
        /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(
          import_dsh_client_ui_primitives25.Button,
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
        /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: plugin_cards_default.activationFooterActions, children: [
          /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(import_dsh_client_ui_primitives25.Button, { variant: "ghost", size: "sm", onClick: onDismiss, children: connected ? t("activationDone") : t("activationLater") }),
          /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(import_dsh_client_ui_primitives25.Button, { variant: "primary", size: "sm", onClick: onOpenDetails, "data-modal-autofocus": true, children: t("activationDetails") })
        ] })
      ] }),
      children: /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: plugin_cards_default.activationContent, "data-zotero-activation-guide": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("ol", { className: plugin_cards_default.activationSteps, children: [
          /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("li", { className: plugin_cards_default.activationStep, children: [
            /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: plugin_cards_default.activationStepIndex, children: "1" }),
            /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: plugin_cards_default.activationStepBody, children: /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: plugin_cards_default.activationStepText, children: t("activationStep1") }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("li", { className: plugin_cards_default.activationStep, children: [
            /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: plugin_cards_default.activationStepIndex, children: "2" }),
            /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: plugin_cards_default.activationStepBody, children: [
              /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: plugin_cards_default.activationStepText, children: t("activationStep2") }),
              /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("p", { className: plugin_cards_default.activationStepNote, children: t("activationStep2Note") })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: plugin_cards_default.card, children: [
          /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("div", { className: plugin_cards_default.cardHead, children: /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { className: plugin_cards_default.cardTitle, children: t("activationStatusLabel") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime31.jsxs)("div", { className: plugin_cards_default.statusRow, "data-state": connected ? "connected" : "disconnected", children: [
            /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(import_dsh_client_ui_primitives25.StateDot, { state: statusState }),
            /* @__PURE__ */ (0, import_jsx_runtime31.jsx)("span", { children: statusText })
          ] }),
          diagnosis !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime31.jsx)(DiagnosisBox, { diagnosis, t }) : null
        ] })
      ] })
    }
  );
}

// src/client/components/plugin/ZoteroPluginDetailSection.tsx
var import_dsh_client_ui_primitives26 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime32 = require("react/jsx-runtime");
function ZoteroPluginDetailSection({
  subject,
  t,
  probe
}) {
  const pkgName = subject.kind === "bundle" || subject.kind === "row" ? subject.pkg.name : void 0;
  if (pkgName !== ZOTERO_REMOTE_PACKAGE) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(ZoteroSurfaceBoundary, { t, surface: "detail", resetKey: pkgName, children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(ZoteroPluginDetailSectionBody, { t, probe }) });
}
function ZoteroPluginDetailSectionBody({ t, probe }) {
  const { state, runProbe } = useZoteroProbe(probe, {
    initialAutoRun: true
  });
  const connected = state.data?.connected ?? false;
  const version = state.data?.zoteroVersion;
  const diagnosis = state.error ?? state.data?.diagnosis;
  const tips = ["tipWebTab", "tipSettingsNav", "tipWriteGate"];
  return /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("section", { className: plugin_cards_default.section, "data-zotero-plugin-section": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: plugin_cards_default.sectionHead, children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("h4", { className: plugin_cards_default.sectionTitle, children: t("detailSectionTitle") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: plugin_cards_default.sectionGrid, children: [
      /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: plugin_cards_default.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: plugin_cards_default.cardHead, children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: plugin_cards_default.cardTitle, children: t("detailsLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(
            import_dsh_client_ui_primitives26.Button,
            {
              variant: "ghost",
              size: "sm",
              className: plugin_cards_default.refreshButton,
              disabled: state.loading,
              onClick: () => {
                void runProbe();
              },
              children: state.loading ? t("checking") : t("refresh")
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: plugin_cards_default.statusRow, "data-state": connected ? "connected" : "disconnected", children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { children: state.loading ? `\u25CF ${t("checking")}` : connected ? `\u25CF ${t("statusConnectedNote")}` : `\u25CB ${t("statusUnavailable")}` }) }),
        version ? /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("p", { className: plugin_cards_default.statusDetail, children: [
          t("zoteroVersionLabel"),
          ": ",
          version
        ] }) : null,
        diagnosis ? /* @__PURE__ */ (0, import_jsx_runtime32.jsx)(DiagnosisBox, { diagnosis, t }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("div", { className: plugin_cards_default.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("div", { className: plugin_cards_default.cardHead, children: /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: plugin_cards_default.cardTitle, children: t("tipsLabel") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("ul", { className: plugin_cards_default.tipList, children: tips.map((key) => /* @__PURE__ */ (0, import_jsx_runtime32.jsxs)("li", { className: plugin_cards_default.tipItem, children: [
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { className: plugin_cards_default.tipBullet, children: "\u{1F4A1}" }),
          /* @__PURE__ */ (0, import_jsx_runtime32.jsx)("span", { children: t(key) })
        ] }, key)) })
      ] })
    ] })
  ] });
}

// src/client/components/DiagnosticsCard.tsx
var import_react22 = require("react");
var import_dsh_client_ui_primitives27 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/useDiagnosticsFeed.ts
var import_react21 = require("react");
var DEFAULT_POLL_MS = 2e3;
function useDiagnosticsFeed(diagnostics, options) {
  const [state, setState] = (0, import_react21.useState)({
    loading: diagnostics !== void 0
  });
  const inFlightRef = (0, import_react21.useRef)(false);
  const unmountedRef = (0, import_react21.useRef)(false);
  (0, import_react21.useEffect)(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);
  const refresh = (0, import_react21.useCallback)(async () => {
    if (!diagnostics || inFlightRef.current) return;
    inFlightRef.current = true;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await diagnostics();
      if (unmountedRef.current) return;
      setState(
        res.ok ? { loading: false, data: res.value } : { loading: false, error: res.error.message }
      );
    } catch (err) {
      if (unmountedRef.current) return;
      setState({ loading: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      inFlightRef.current = false;
    }
  }, [diagnostics]);
  (0, import_react21.useEffect)(() => {
    if (!diagnostics) return;
    void refresh();
    const pollMs = options?.pollMs ?? DEFAULT_POLL_MS;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [diagnostics, options?.pollMs, refresh]);
  return { state, refresh };
}

// src/client/components/DiagnosticsCard.tsx
var import_jsx_runtime33 = require("react/jsx-runtime");
var RENDER_LIMIT = 100;
function timeOf(ts) {
  return formatTime(ts, true);
}
function bundleOf(data, status, t) {
  const facts = [
    "dsh-zotero diagnostics",
    `plugin: ${buildInfoOf()}`,
    status === void 0 ? void 0 : `zotero: ${status.zoteroVersion ?? "-"} \xB7 ${status.endpoint ?? "-"} \xB7 ${status.connected ? "connected" : "disconnected"}`,
    t(data.debug ? "diagnosticsDebugOn" : "diagnosticsDebugOff"),
    `${data.total} retained \xB7 ${data.entries.length} served`
  ].filter((line) => line !== void 0).join("\n");
  const body = data.entries.map((entry) => entryText(entry)).join("\n");
  return `${facts}

${body}`;
}
function entryText(entry) {
  const head = `#${entry.seq} ${timeOf(entry.ts)} ${entry.level.toUpperCase()} ${entry.event}${entry.count > 1 ? ` (\xD7${entry.count})` : ""}`;
  const detail = entry.detail === void 0 ? void 0 : `  ${JSON.stringify(entry.detail)}`;
  return detail === void 0 ? `${head}
${entry.message}` : `${head}
${entry.message}
${detail}`;
}
function DiagnosticsCard({
  subject,
  t,
  probe,
  diagnostics
}) {
  const pkgName = subject.kind === "bundle" || subject.kind === "row" ? subject.pkg.name : void 0;
  if (pkgName !== ZOTERO_REMOTE_PACKAGE) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(ZoteroSurfaceBoundary, { t, surface: "diagnostics", resetKey: pkgName, children: /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(DiagnosticsCardBody, { t, probe, diagnostics }) });
}
function DiagnosticsCardBody({ t, probe, diagnostics }) {
  const { state: feed, refresh } = useDiagnosticsFeed(diagnostics);
  const { state: probeState } = useZoteroProbe(probe, { initialAutoRun: true });
  const [problemsOnly, setProblemsOnly] = (0, import_react22.useState)(false);
  const filterOptions = (0, import_react22.useMemo)(
    () => [
      { value: "all", label: t("diagnosticsLevelAll") },
      { value: "problems", label: t("diagnosticsLevelProblems") }
    ],
    [t]
  );
  const jsonLabels = (0, import_react22.useMemo)(
    () => ({
      copyValue: t("jsonCopyValue"),
      copyJson: t("jsonCopyJson"),
      copyPath: t("jsonCopyPath"),
      copyPrettyJson: t("jsonCopyPrettyJson"),
      copyCompactJson: t("jsonCopyCompactJson"),
      copied: t("copied"),
      copyFailed: t("jsonCopyFailed"),
      collapseNode: t("jsonCollapseNode"),
      expandNode: t("jsonExpandNode"),
      copyButtonTitle: (action) => action
    }),
    [t]
  );
  const data = feed.data;
  if (data !== void 0 && !data.debug) {
    return null;
  }
  const filtered = data?.entries.filter(
    (entry) => !problemsOnly || entry.level === "warn" || entry.level === "error"
  ) ?? [];
  const shown = filtered.slice(0, RENDER_LIMIT);
  return /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("section", { className: plugin_cards_default.section, "data-zotero-diagnostics": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("div", { className: plugin_cards_default.sectionHead, children: /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("h4", { className: plugin_cards_default.sectionTitle, children: t("diagnosticsTitle") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: plugin_cards_default.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: plugin_cards_default.cardHead, children: [
        /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: plugin_cards_default.cardTitle, children: t("diagnosticsLogLabel") }),
        /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
          import_dsh_client_ui_primitives27.Button,
          {
            variant: "outline",
            size: "sm",
            disabled: feed.loading,
            onClick: () => {
              void refresh();
            },
            children: feed.loading ? t("checking") : t("refresh")
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: plugin_cards_default.diagToolbar, children: [
        /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
          import_dsh_client_ui_primitives27.SegmentedControl,
          {
            id: "diagnostics-level-filter",
            value: problemsOnly ? "problems" : "all",
            options: filterOptions,
            onChange: (next) => setProblemsOnly(next === "problems"),
            label: t("diagnosticsFilterLabel")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
          CopyButton,
          {
            value: data !== void 0 ? bundleOf(data, probeState.data, t) : "",
            label: t("diagnosticsCopyBundle"),
            copiedLabel: t("copied"),
            asButton: true,
            disabled: data === void 0
          }
        )
      ] }),
      feed.error !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", { className: plugin_cards_default.diagFetchError, children: feed.error }) : data === void 0 ? null : filtered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", { className: plugin_cards_default.diagEmpty, children: problemsOnly && data.entries.length > 0 ? t("diagnosticsNoProblems") : t("diagnosticsEmpty") }) : /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("div", { className: plugin_cards_default.diagList, children: shown.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: plugin_cards_default.diagRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: plugin_cards_default.diagTime, children: timeOf(entry.ts) }),
        /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
          import_dsh_client_ui_primitives27.StateDot,
          {
            size: 6,
            state: entry.level === "error" ? "error" : entry.level === "warn" ? "warning" : "done"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("div", { className: plugin_cards_default.diagBody, children: [
          /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("span", { className: plugin_cards_default.diagEvent, children: entry.event }),
          entry.count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("span", { className: plugin_cards_default.diagCount, children: [
            "\xD7",
            entry.count
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", { className: plugin_cards_default.diagMessage, children: entry.message }),
          entry.detail === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime33.jsxs)("details", { className: plugin_cards_default.diagDetail, children: [
            /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("summary", { children: t("diagnosticsDetail") }),
            /* @__PURE__ */ (0, import_jsx_runtime33.jsx)(
              import_dsh_client_ui_primitives27.JsonTree,
              {
                data: typeof entry.detail === "object" && entry.detail !== null ? entry.detail : { value: entry.detail },
                label: t("diagnosticsDetail"),
                labels: jsonLabels,
                collapsedStringLines: 3
              }
            )
          ] })
        ] })
      ] }, entry.seq)) }),
      data !== void 0 && filtered.length > RENDER_LIMIT ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", { className: plugin_cards_default.diagFooter, children: t("diagnosticsShowLatest", { shown: RENDER_LIMIT, total: filtered.length }) }) : null,
      data !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime33.jsx)("p", { className: plugin_cards_default.diagFooter, children: data.debug ? t("diagnosticsDebugOn") : t("diagnosticsDebugOff") }) : null
    ] })
  ] });
}

// src/client/LibrarySettingsSection.tsx
var import_react23 = require("react");
var import_dsh_client_ui_primitives28 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime34 = require("react/jsx-runtime");
function LibrarySettingsSection(props) {
  const { t, view } = props;
  const state = props.useLibraryCard((snapshot) => snapshot);
  const labels = (0, import_react23.useMemo)(() => formLabels(t), [t]);
  if (view === "summary") {
    return t("tabLibraryDesc");
  }
  return /* @__PURE__ */ (0, import_jsx_runtime34.jsx)("div", { className: ZoteroSettingsSection_default.page, "data-library-config-page": true, children: /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(import_dsh_client_ui_primitives28.SettingsForm, { labels, state, onSave: props.save, onDiscard: props.discard, children: /* @__PURE__ */ (0, import_jsx_runtime34.jsx)(LibrarySettingsForm, { t, state, actions: props }) }) });
}

// src/client/components/library/ZoteroLibraryPanel.tsx
var import_react33 = require("react");
var import_dsh_client_ui_primitives39 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/library/useLibraryFeed.ts
var import_react26 = require("react");

// src/client/components/library/library-model.ts
var LIBRARY_PAGE_SIZE = 50;
var PERSONAL_LIBRARY = { type: "user", id: 0 };
function pageOffsetOf(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
function previousPageOffsetOf(offset, limit) {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, Math.floor(offset) - Math.floor(limit));
}
function libraryKeyOf(library) {
  return `${library.type}:${library.id}`;
}
function sameLibrary(a, b) {
  return a.type === b.type && a.id === b.id;
}
function pdfAttachmentOf(detail) {
  if (detail.bestAttachment !== void 0 && isPdfContentType(detail.bestAttachment.contentType)) {
    return detail.bestAttachment;
  }
  return detail.attachments?.items.find((attachment) => isPdfContentType(attachment.contentType));
}
var LIBRARY_SORTS = ZOTERO_SORT_FIELDS;
function scopeViewOf(selection2) {
  switch (selection2.kind) {
    case "library":
    case "publications":
    case "trash":
      return { kind: selection2.kind };
    case "collection":
      return { kind: "collection", refOrName: selection2.ref };
    case "savedSearch":
      return { kind: "savedSearch", refOrName: selection2.ref };
  }
}
function listRequestOf(query) {
  return {
    ...query.filters,
    scope: scopeViewOf(query.selection),
    library: query.library,
    ...query.q !== "" ? { q: query.q } : {},
    mode: query.mode,
    sort: query.sort,
    direction: query.direction,
    offset: query.offset,
    limit: LIBRARY_PAGE_SIZE
  };
}
function treeRequestOf(library, parentRef, offset = 0) {
  return {
    kind: "collections",
    library,
    ...parentRef !== void 0 ? { parentRef } : {},
    offset: pageOffsetOf(offset),
    limit: LIBRARY_PAGE_SIZE
  };
}
function savedSearchesRequestOf(library, offset = 0) {
  return {
    kind: "savedSearches",
    library,
    offset: pageOffsetOf(offset),
    limit: LIBRARY_PAGE_SIZE
  };
}
function librariesRequestOf(offset = 0) {
  return { kind: "libraries", offset, limit: LIBRARY_PAGE_SIZE };
}
function libraryOptionsOf(rows) {
  const options = rows.filter(
    (row) => row.kind === "library"
  ).map((row) => ({ library: row.library, name: row.name }));
  return options.sort(
    (a, b) => a.library.type === b.library.type ? a.library.id - b.library.id : a.library.type === "user" ? -1 : 1
  );
}
function isContainerOnly(row) {
  return row.childCount !== void 0 && row.childCount > 0 && row.itemCount === 0;
}
function collectionRowsOf(rows) {
  return rows.filter((row) => row.kind === "collection");
}
function savedSearchRowsOf(rows) {
  return rows.filter((row) => row.kind === "savedSearch");
}
function flattenTree(roots, laneOf, expanded, rootLane) {
  const flat = [];
  const seen = /* @__PURE__ */ new Set();
  const walk = (rows, depth, lane) => {
    rows.forEach((row, index) => {
      if (seen.has(row.ref)) return;
      seen.add(row.ref);
      const childLane = expanded.has(row.ref) ? laneOf(row.ref) : void 0;
      flat.push({
        row,
        depth,
        setSize: lane?.total,
        posInSet: lane === void 0 ? void 0 : lane.offset + index + 1
      });
      if (childLane !== void 0) walk(childLane.rows, depth + 1, childLane);
    });
  };
  walk(roots, 0, rootLane);
  return flat;
}
function listStateOf(result) {
  if (!result.ok) return { phase: "error", message: result.error.message };
  return {
    phase: "ready",
    items: result.value.items,
    total: result.value.total,
    offset: result.value.offset,
    limit: result.value.limit,
    nextOffset: result.value.nextOffset
  };
}
function itemStateOf(result) {
  if (!result.ok) return { phase: "error", message: result.error.message };
  return { phase: "ready", detail: result.value };
}
function lanePageOf(lane) {
  return lane?.phase === "ready" ? lane : lane?.previous;
}
function pageRangeOf(page, count) {
  if (count === 0) return void 0;
  return { start: page.offset + 1, end: page.offset + count, total: page.total };
}

// src/client/components/library/navigation-identity.ts
function objectIdentity(ref, serverId) {
  const fields = refFieldsOf(ref);
  if (fields === void 0) return ref;
  return JSON.stringify([
    fields.serverId ?? serverId,
    fields.libraryType,
    fields.libraryId,
    fields.kind,
    fields.key
  ]);
}
function scopeIdentity(scope, serverId) {
  return "ref" in scope ? objectIdentity(scope.ref, serverId) : scope.kind;
}
function scopeKeyOf(library, scope, serverId) {
  return JSON.stringify([serverId, library, scopeIdentity(scope, serverId)]);
}

// src/client/components/library/useLibraryChildFeed.ts
var import_react24 = require("react");
function useLibraryChildFeed(face, selectedRef, inspectorTicketOf, setInspector) {
  const [childStates, setChildStates] = (0, import_react24.useState)({});
  const childOffsets = (0, import_react24.useRef)({});
  const childSeq = (0, import_react24.useRef)({});
  const reset = (0, import_react24.useCallback)(() => {
    childOffsets.current = {};
    for (const kind of ["notes", "attachments", "annotations"]) {
      childSeq.current[kind] = (childSeq.current[kind] ?? 0) + 1;
    }
    setChildStates({});
  }, []);
  const pageChild = (0, import_react24.useCallback)(
    (kind, nextOffset) => {
      if (selectedRef === void 0) return;
      const parentTicket = inspectorTicketOf();
      const ticket = (childSeq.current[kind] ?? 0) + 1;
      childSeq.current[kind] = ticket;
      const offset = pageOffsetOf(nextOffset);
      childOffsets.current[kind] = offset;
      setChildStates((states) => ({ ...states, [kind]: { phase: "loading" } }));
      const current = () => parentTicket === inspectorTicketOf() && childSeq.current[kind] === ticket;
      void face.childPage({ ref: selectedRef, kind, offset, limit: ZOTERO_CHILD_PAGE_ROWS }).then((result) => {
        if (!current()) return;
        if (!result.ok) {
          setChildStates((states) => ({
            ...states,
            [kind]: { phase: "error", message: result.error.message }
          }));
          return;
        }
        if (result.value.kind !== kind) {
          setChildStates((states) => ({
            ...states,
            [kind]: { phase: "error", message: "The child page answered a different kind." }
          }));
          return;
        }
        setInspector(
          (state) => state?.phase === "ready" ? { phase: "ready", detail: { ...state.detail, [kind]: result.value.page } } : state
        );
        setChildStates((states) => ({ ...states, [kind]: void 0 }));
      }).catch((error) => {
        if (current())
          setChildStates((states) => ({
            ...states,
            [kind]: { phase: "error", message: messageOf(error) }
          }));
      });
    },
    [face, inspectorTicketOf, selectedRef, setInspector]
  );
  return {
    childStates,
    childOffsetOf: (kind) => childOffsets.current[kind] ?? 0,
    pageChild,
    reset
  };
}

// src/client/components/library/useLibraryNavigation.ts
var import_react25 = require("react");
var SAVED = "@saved";
function samePath(a, b) {
  if (a === void 0 || b === void 0) return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function useLibraryNavigation(face, serverId, library, active, expanded, setExpanded, prefixes, selection2, updateSelection) {
  const [lanes, setLanes] = (0, import_react25.useState)(/* @__PURE__ */ new Map());
  const [locateError, setLocateError] = (0, import_react25.useState)();
  const [locatedRef, setLocatedRef] = (0, import_react25.useState)();
  const state = (0, import_react25.useRef)(/* @__PURE__ */ new Map());
  const generation = (0, import_react25.useRef)(0);
  const locationGeneration = (0, import_react25.useRef)(0);
  const recheckLeaves = (0, import_react25.useRef)(/* @__PURE__ */ new Set());
  const pending = (0, import_react25.useRef)(/* @__PURE__ */ new Map());
  const open = (0, import_react25.useRef)(expanded);
  open.current = expanded;
  const live = (0, import_react25.useRef)(active);
  live.current = active;
  const restoreCounts = (0, import_react25.useRef)({});
  const slots = (0, import_react25.useRef)(0);
  const queue = (0, import_react25.useRef)([]);
  const keyOf = (0, import_react25.useCallback)(
    (ref) => ref === void 0 ? "" : objectIdentity(ref, serverId),
    [serverId]
  );
  const publish = (key, lane2) => {
    state.current.set(key, lane2);
    setLanes(new Map(state.current));
  };
  const pageOf = (key) => {
    const lane2 = state.current.get(key);
    return lane2?.phase === "ready" ? lane2 : lane2?.previous;
  };
  const load = (0, import_react25.useCallback)(
    (ref, goal = 0, rebuild2 = false) => {
      const key = ref === SAVED ? SAVED : keyOf(ref);
      const running = pending.current.get(key);
      if (running) return running;
      const epoch = generation.current;
      const valid = () => live.current && generation.current === epoch;
      const task = (async () => {
        await new Promise((resolve) => {
          if (slots.current < 4) {
            slots.current++;
            resolve();
          } else
            queue.current.push(() => {
              slots.current++;
              resolve();
            });
        });
        try {
          if (!valid()) return;
          let previous = pageOf(key);
          const target = Math.max(goal, rebuild2 ? previous?.rows.length ?? 0 : 0);
          let page = rebuild2 ? void 0 : previous;
          let restarted = false;
          publish(key, { phase: "loading", previous });
          for (; ; ) {
            const offset = page?.nextOffset ?? 0;
            if (page && page.nextOffset === void 0) break;
            const response = await face.browse(
              ref === SAVED ? savedSearchesRequestOf(library, offset) : treeRequestOf(library, ref, offset)
            );
            if (!valid()) return;
            if (!response.ok) throw new Error(response.error.message);
            const value = response.value;
            const version = value.libraryVersion;
            if (!Number.isSafeInteger(version) || version < 0)
              throw new Error("Navigation response lacks a valid library version.");
            if (page !== void 0 && page.libraryVersion !== version) {
              if (restarted) throw new Error("Library keeps changing. Reload this branch.");
              restarted = true;
              face.invalidate?.();
              page = void 0;
              continue;
            }
            const rows = ref === SAVED ? savedSearchRowsOf(value.items) : collectionRowsOf(value.items);
            const all = [...page?.rows ?? [], ...rows];
            if (value.offset !== offset || new Set(all.map((row) => keyOf(row.ref))).size !== all.length || value.nextOffset !== void 0 && (value.nextOffset !== offset + rows.length || value.nextOffset <= offset) || all.length > value.total || value.nextOffset === void 0 && all.length !== value.total)
              throw new Error("Navigation pagination is inconsistent. Reload this branch.");
            page = {
              phase: "ready",
              rows: all,
              total: value.total,
              offset: 0,
              limit: value.limit,
              nextOffset: value.nextOffset,
              libraryVersion: version
            };
            previous = page;
            publish(key, { phase: "loading", previous: page });
            if (page.rows.length >= target || page.nextOffset === void 0) break;
          }
          publish(key, page);
          if (ref !== void 0 && ref !== SAVED && page.total === 0)
            setExpanded((prev) => new Set([...prev].filter((item) => keyOf(item) !== key)));
        } catch (error) {
          if (valid())
            publish(key, {
              phase: "error",
              message: messageOf(error),
              previous: pageOf(key)
            });
        } finally {
          slots.current--;
          queue.current.shift()?.();
        }
      })().finally(() => {
        if (pending.current.get(key) === task) pending.current.delete(key);
      });
      pending.current.set(key, task);
      return task;
    },
    [face, library, keyOf, setExpanded]
  );
  (0, import_react25.useEffect)(() => {
    live.current = active;
    generation.current++;
    pending.current.clear();
    state.current.clear();
    setLanes(/* @__PURE__ */ new Map());
    if (active) {
      void load(void 0, prefixes[""] ?? 0);
      void load(SAVED, prefixes[SAVED] ?? 0);
    }
    return () => {
      generation.current++;
      live.current = false;
    };
  }, [active, serverId, library, load]);
  const lane = (ref) => lanes.get(ref === SAVED ? SAVED : keyOf(ref));
  const root = lanePageOf(lane());
  const rowRefsByIdentity = (0, import_react25.useMemo)(() => {
    const index = /* @__PURE__ */ new Map();
    for (const value of lanes.values())
      for (const row of lanePageOf(value)?.rows ?? []) {
        const key = keyOf(row.ref);
        const spellings = index.get(key) ?? /* @__PURE__ */ new Set();
        spellings.add(row.ref);
        index.set(key, spellings);
      }
    return index;
  }, [lanes, keyOf]);
  const expandedRefs = (0, import_react25.useMemo)(() => {
    const refs = new Set(expanded);
    for (const ref of expanded)
      for (const spelling of rowRefsByIdentity.get(keyOf(ref)) ?? []) refs.add(spelling);
    return refs;
  }, [expanded, rowRefsByIdentity, keyOf]);
  const flatTree = (0, import_react25.useMemo)(
    () => flattenTree(
      root?.rows ?? [],
      (ref) => lanePageOf(lanes.get(keyOf(ref))),
      expandedRefs,
      root
    ),
    [lanes, expandedRefs, keyOf, root]
  );
  (0, import_react25.useEffect)(() => {
    if (!active) return;
    for (const { row } of flatTree) {
      if (![...open.current].some((ref) => keyOf(ref) === keyOf(row.ref)) && !recheckLeaves.current.has(keyOf(row.ref)))
        continue;
      if (!state.current.has(keyOf(row.ref)))
        void load(row.ref, restoreCounts.current[keyOf(row.ref)] ?? prefixes[keyOf(row.ref)] ?? 0);
    }
  }, [active, flatTree, keyOf, load, prefixes]);
  const locate = (0, import_react25.useCallback)(async () => {
    if (!active || !("ref" in selection2)) return;
    const epoch = generation.current;
    const location = ++locationGeneration.current;
    const valid = () => live.current && epoch === generation.current && location === locationGeneration.current;
    setLocateError(void 0);
    setLocatedRef(void 0);
    try {
      await load();
      const root2 = pageOf("");
      if (!valid()) return;
      if (!root2) throw new Error("Load navigation before locating the current scope.");
      if (selection2.kind === "savedSearch") {
        await load(SAVED);
        while (valid()) {
          const page = pageOf(SAVED);
          const savedLane = state.current.get(SAVED);
          if (savedLane?.phase === "error") throw new Error(savedLane.message);
          const found = page?.rows.find((row) => keyOf(row.ref) === keyOf(selection2.ref));
          if (found) {
            if (found.name !== selection2.name) updateSelection({ ...selection2, name: found.name });
            setLocatedRef(found.ref);
            return;
          }
          if (page?.nextOffset === void 0)
            throw new Error("Saved search no longer exists. Return to all items.");
          await load(SAVED, page.rows.length + 1);
        }
        return;
      }
      const response = await face.collectionPath({
        library,
        ref: selection2.ref,
        libraryVersion: root2.libraryVersion
      });
      if (!valid()) return;
      if (!response.ok) throw new Error(response.error.message);
      let parent;
      for (const row of response.value.path) {
        while (valid()) {
          const page = pageOf(keyOf(parent));
          if (page?.rows.some((item) => keyOf(item.ref) === keyOf(row.ref))) break;
          if (page && page.nextOffset === void 0)
            throw new Error("Collection path changed. Reload navigation.");
          await load(parent, (page?.rows.length ?? 0) + 1);
          if (state.current.get(keyOf(parent))?.phase === "error")
            throw new Error("Cannot load the current collection path.");
        }
        if (!valid()) return;
        if (parent !== void 0) {
          const ancestor = parent;
          setExpanded((prev) => /* @__PURE__ */ new Set([...prev, ancestor]));
        }
        parent = row.ref;
      }
      const target = response.value.path.at(-1);
      if (target) {
        const currentPath = "path" in selection2 ? selection2.path : void 0;
        if (keyOf(target.ref) !== keyOf(selection2.ref) || target.name !== selection2.name || !samePath(target.path, currentPath))
          updateSelection({ ...selection2, ref: target.ref, name: target.name, path: target.path });
        setLocatedRef(target.ref);
      }
    } catch (error) {
      if (valid()) setLocateError(messageOf(error));
    }
  }, [active, selection2, face, library, load, keyOf, setExpanded, updateSelection]);
  const locateRef = (0, import_react25.useRef)(locate);
  locateRef.current = locate;
  (0, import_react25.useEffect)(() => {
    if (active) void locateRef.current();
  }, [active, serverId, library]);
  const rebuild = (0, import_react25.useCallback)(() => {
    generation.current++;
    pending.current.clear();
    const counts = new Map(
      [...state.current].map(([key, value]) => [
        key,
        Math.max(lanePageOf(value)?.rows.length ?? 0, restoreCounts.current[key] ?? 0)
      ])
    );
    recheckLeaves.current = new Set(
      [...state.current].filter(([, value]) => lanePageOf(value)?.total === 0).map(([key]) => key)
    );
    restoreCounts.current = Object.fromEntries(counts);
    state.current.clear();
    setLanes(/* @__PURE__ */ new Map());
    void (async () => {
      await load(void 0, counts.get("") ?? 0, true);
      await load(SAVED, counts.get(SAVED) ?? 0, true);
      await locateRef.current();
    })();
  }, [load]);
  const refreshSaved = (0, import_react25.useCallback)(() => {
    const lane2 = state.current.get(SAVED);
    const loadedRows = (lane2?.phase === "ready" ? lane2 : lane2?.previous)?.rows.length ?? 0;
    void load(SAVED, Math.max(loadedRows, prefixes[SAVED] ?? 0), true);
  }, [load, prefixes]);
  const persistedPrefixes = (0, import_react25.useMemo)(
    () => Object.fromEntries(
      [...lanes].map(([key, value]) => [key, lanePageOf(value)?.rows.length ?? 0])
    ),
    [lanes]
  );
  return {
    flatTree,
    expanded: expandedRefs,
    locatedRef,
    locateError,
    locate,
    refresh: rebuild,
    refreshSaved,
    cancelLocate: () => {
      locationGeneration.current++;
    },
    treeLane: (ref) => lane(ref),
    savedSearches: lane(SAVED) ?? { phase: "loading" },
    loadMore: (ref) => load(ref, (lanePageOf(lane(ref))?.rows.length ?? 0) + 1),
    retryTree: (ref) => load(ref, prefixes[keyOf(ref)] ?? 0, state.current.get(keyOf(ref))?.phase === "ready"),
    loadMoreSaved: () => load(SAVED, (lanePageOf(lane(SAVED))?.rows.length ?? 0) + 1),
    retrySaved: () => load(SAVED, prefixes[SAVED] ?? 0),
    prefixes: persistedPrefixes
  };
}

// src/client/components/library/library-storage.ts
var import_zod2 = require("zod");
var PANES = ["tree", "list", "inspector"];
var selection = import_zod2.z.discriminatedUnion("kind", [
  import_zod2.z.object({ kind: import_zod2.z.literal("library") }).strict(),
  import_zod2.z.object({ kind: import_zod2.z.literal("publications") }).strict(),
  import_zod2.z.object({ kind: import_zod2.z.literal("trash") }).strict(),
  import_zod2.z.object({
    kind: import_zod2.z.literal("collection"),
    ref: import_zod2.z.string().min(1),
    name: import_zod2.z.string(),
    path: import_zod2.z.array(import_zod2.z.string()).readonly().optional()
  }).strict(),
  import_zod2.z.object({ kind: import_zod2.z.literal("savedSearch"), ref: import_zod2.z.string().min(1), name: import_zod2.z.string() }).strict()
]);
var libraryStoredStateSchema = import_zod2.z.object({
  version: import_zod2.z.literal(2),
  library: zoteroLibrarySchema,
  selection,
  q: import_zod2.z.string(),
  mode: import_zod2.z.enum(["metadata", "everything"]),
  sort: zoteroLibrarySortSchema,
  direction: import_zod2.z.enum(["asc", "desc"]),
  offset: import_zod2.z.number().int().nonnegative(),
  prefixes: import_zod2.z.record(import_zod2.z.string(), import_zod2.z.number().int().nonnegative()).default({}),
  expanded: import_zod2.z.array(import_zod2.z.string().min(1)),
  filters: zoteroLibraryFiltersSchema,
  selectedRef: import_zod2.z.string().optional(),
  narrowPane: import_zod2.z.enum(PANES).optional()
}).strict();
var MAX_SESSION_VIEW_ENTRIES = 8;
var sessionViews = /* @__PURE__ */ new Map();
function readLibrarySessionMemory(sessionId) {
  return sessionViews.get(sessionId);
}
function writeLibrarySessionView(sessionId, view) {
  sessionViews.delete(sessionId);
  sessionViews.set(sessionId, view);
  const overflow = Math.max(0, sessionViews.size - MAX_SESSION_VIEW_ENTRIES);
  for (const oldest of [...sessionViews.keys()].slice(0, overflow)) {
    sessionViews.delete(oldest);
  }
}
function clearLibrarySessionMemory(sessionId) {
  if (sessionId !== void 0) {
    sessionViews.delete(sessionId);
  } else {
    sessionViews.clear();
  }
}
var libraryStorageKey = (serverId) => `dsh-zotero:library:2:${encodeURIComponent(serverId)}`;
function isRefScope(selection2) {
  return selection2.kind === "collection" || selection2.kind === "savedSearch";
}
function publicationsAllowed(library) {
  return library.type === "user";
}
function sameInstanceRef(ref, kind, saved, serverId) {
  const fields = refFieldsOf(ref);
  return fields !== void 0 && fields.kind === kind && fields.libraryType === saved.library.type && Number(fields.libraryId) === saved.library.id && (fields.serverId === void 0 || fields.serverId === serverId);
}
function readLibraryState(serverId) {
  try {
    const raw = localStorage.getItem(libraryStorageKey(serverId));
    if (raw === null) return void 0;
    const saved = libraryStoredStateSchema.parse(JSON.parse(raw));
    const validSelection = isRefScope(saved.selection) ? sameInstanceRef(
      saved.selection.ref,
      saved.selection.kind === "savedSearch" ? "search" : "collection",
      saved,
      serverId
    ) : saved.selection.kind !== "publications" || publicationsAllowed(saved.library);
    const validSelectedRef = saved.selectedRef !== void 0 && sameInstanceRef(saved.selectedRef, "item", saved, serverId) ? saved.selectedRef : void 0;
    return {
      ...saved,
      selection: validSelection ? saved.selection : { kind: "library" },
      offset: validSelection ? saved.offset : 0,
      expanded: saved.expanded.filter((ref) => sameInstanceRef(ref, "collection", saved, serverId)),
      selectedRef: validSelectedRef
    };
  } catch (error) {
    console.warn("dsh-zotero: library.storage.read", messageOf(error));
    return void 0;
  }
}
function writeLibraryState(serverId, value) {
  try {
    localStorage.setItem(libraryStorageKey(serverId), JSON.stringify(value));
  } catch (error) {
    console.warn("dsh-zotero: library.storage.write", messageOf(error));
  }
}

// src/client/components/library/useLibraryFeed.ts
var SEARCH_DEBOUNCE_MS = 300;
var INSPECTOR_INCLUDE = ["notes", "attachments", "annotations"];
function useLibraryFeed(face, serverId, enabled, sessionId) {
  const initialView = readLibrarySessionMemory(sessionId);
  const [libraries, setLibraries] = (0, import_react26.useState)({ phase: "loading" });
  const [currentLibrary, setCurrentLibrary] = (0, import_react26.useState)(PERSONAL_LIBRARY);
  const [prefixes, setPrefixes] = (0, import_react26.useState)({});
  const [expanded, setExpanded] = (0, import_react26.useState)(/* @__PURE__ */ new Set());
  const [selection2, setSelection] = (0, import_react26.useState)({ kind: "library" });
  const scopeKey = scopeKeyOf(currentLibrary, selection2, serverId);
  const liveScope = (0, import_react26.useRef)(scopeKey);
  liveScope.current = scopeKey;
  const [q, setQRaw] = (0, import_react26.useState)("");
  const [filters, setFiltersRaw] = (0, import_react26.useState)({});
  const [debouncedQ, setDebouncedQ] = (0, import_react26.useState)("");
  const [mode, setModeRaw] = (0, import_react26.useState)("metadata");
  const [sort, setSortRaw] = (0, import_react26.useState)("dateModified");
  const [direction, setDirectionRaw] = (0, import_react26.useState)("desc");
  const [offset, setOffset] = (0, import_react26.useState)(0);
  const [listOwner, setListOwner] = (0, import_react26.useState)("");
  const [list, setList] = (0, import_react26.useState)({ phase: "loading" });
  const [selectedRef, setSelectedRef] = (0, import_react26.useState)(void 0);
  const [inspector, setInspector] = (0, import_react26.useState)(
    () => initialView?.inspector
  );
  const [narrowPane, setNarrowPaneState] = (0, import_react26.useState)("list");
  const setNarrowPane = (0, import_react26.useCallback)((pane) => {
    setNarrowPaneState(pane);
  }, []);
  const [refreshToken, setRefreshToken] = (0, import_react26.useState)(0);
  const [libraryRetry, setLibraryRetry] = (0, import_react26.useState)(0);
  const [listRetry, setListRetry] = (0, import_react26.useState)(0);
  const [inspectorRetry, setInspectorRetry] = (0, import_react26.useState)(0);
  const requestIdentity = JSON.stringify([
    serverId,
    currentLibrary,
    scopeIdentity(selection2, serverId),
    q,
    debouncedQ,
    mode,
    sort,
    direction,
    offset,
    filters,
    refreshToken,
    listRetry
  ]);
  const seq = (0, import_react26.useRef)({
    libraries: 0,
    list: 0,
    inspector: 0
  });
  const inspectorTicketOf = (0, import_react26.useCallback)(() => seq.current.inspector, []);
  const childFeed = useLibraryChildFeed(face, selectedRef, inspectorTicketOf, setInspector);
  const { childStates, pageChild, reset: resetChildren } = childFeed;
  const selectedRefRef = (0, import_react26.useRef)(selectedRef);
  selectedRefRef.current = selectedRef;
  const restoredServer = (0, import_react26.useRef)();
  const [hydratedServer, setHydratedServer] = (0, import_react26.useState)();
  const active = enabled && serverId !== void 0 && hydratedServer === serverId;
  const navigation = useLibraryNavigation(
    face,
    serverId,
    currentLibrary,
    active,
    expanded,
    setExpanded,
    prefixes,
    selection2,
    setSelection
  );
  const { flatTree, savedSearches } = navigation;
  const reloadCachedTree = navigation.refresh;
  const refreshSavedLane = navigation.refreshSaved;
  const identityOf = (0, import_react26.useCallback)((ref) => objectIdentity(ref, serverId), [serverId]);
  const resetLibraryState = (0, import_react26.useCallback)(
    (library, restored, keep) => {
      seq.current.list += 1;
      setPrefixes(restored?.prefixes ?? {});
      setCurrentLibrary(library);
      setSelection(restored?.selection ?? { kind: "library" });
      setQRaw(restored?.q ?? "");
      setDebouncedQ(restored?.q ?? "");
      setModeRaw(restored?.mode ?? keep?.mode ?? "metadata");
      setSortRaw(restored?.sort ?? keep?.sort ?? "dateModified");
      setDirectionRaw(restored?.direction ?? keep?.direction ?? "desc");
      setFiltersRaw(restored?.filters ?? {});
      setOffset(restored?.offset ?? 0);
      setExpanded(new Set(restored?.expanded ?? []));
      seq.current.inspector += 1;
      setSelectedRef(restored?.selectedRef);
      setInspector(
        (previous) => previous?.phase === "ready" && previous.detail.ref === restored?.selectedRef ? previous : void 0
      );
      setNarrowPaneState(
        restored?.narrowPane ?? (restored?.selectedRef !== void 0 ? "inspector" : "list")
      );
    },
    []
  );
  (0, import_react26.useEffect)(() => {
    if (serverId === void 0 || restoredServer.current === serverId) return;
    const saved = readLibraryState(serverId);
    const changedInstance = restoredServer.current !== void 0;
    restoredServer.current = serverId;
    if (face.setInstance !== void 0) face.setInstance(serverId);
    else if (changedInstance) face.invalidate?.();
    resetLibraryState(saved?.library ?? { type: "user", id: 0 }, saved);
    setHydratedServer(serverId);
    if (changedInstance) setRefreshToken((value) => value + 1);
  }, [serverId, resetLibraryState, face]);
  (0, import_react26.useEffect)(() => {
    if (!active || serverId === void 0 || hydratedServer !== serverId) return;
    writeLibraryState(serverId, {
      version: 2,
      prefixes: navigation.prefixes,
      library: currentLibrary,
      selection: selection2,
      q: debouncedQ,
      mode,
      sort,
      direction,
      offset,
      expanded: [...expanded],
      filters,
      selectedRef,
      narrowPane
    });
  }, [
    serverId,
    active,
    hydratedServer,
    currentLibrary,
    selection2,
    debouncedQ,
    mode,
    sort,
    direction,
    offset,
    expanded,
    filters,
    selectedRef,
    narrowPane,
    navigation.prefixes
  ]);
  (0, import_react26.useEffect)(() => {
    const timer = setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  (0, import_react26.useEffect)(() => {
    if (!active) return;
    const ticket = ++seq.current.libraries;
    setLibraries({ phase: "loading" });
    void (async () => {
      const rows = [];
      let cursor = 0;
      for (; ; ) {
        const result = await face.browse(librariesRequestOf(cursor));
        if (ticket !== seq.current.libraries) return;
        if (!result.ok) {
          setLibraries({ phase: "error", message: result.error.message });
          return;
        }
        rows.push(...result.value.items);
        const next = result.value.nextOffset;
        if (next === void 0) break;
        if (next <= cursor) {
          setLibraries({ phase: "error", message: "The library listing stalled mid-page." });
          return;
        }
        cursor = next;
      }
      setLibraries({ phase: "ready", options: libraryOptionsOf(rows) });
    })().catch((error) => {
      if (ticket !== seq.current.libraries) return;
      setLibraries({ phase: "error", message: messageOf(error) });
    });
  }, [active, face, refreshToken, libraryRetry]);
  (0, import_react26.useEffect)(
    () => () => {
      seq.current.list++;
      seq.current.inspector++;
      seq.current.libraries++;
      resetChildren();
    },
    [active, serverId, resetChildren]
  );
  (0, import_react26.useEffect)(() => {
    if (!active) return;
    const ticket = ++seq.current.list;
    if (q !== debouncedQ) {
      setList({ phase: "loading" });
      return;
    }
    const query = {
      selection: selection2,
      library: currentLibrary,
      q: debouncedQ,
      mode,
      sort,
      direction,
      offset,
      filters
    };
    setListOwner(requestIdentity);
    setList({ phase: "loading" });
    void face.search(listRequestOf(query)).then((result) => {
      if (ticket !== seq.current.list) return;
      setList(listStateOf(result));
    }).catch((error) => {
      if (ticket !== seq.current.list) return;
      setList({ phase: "error", message: messageOf(error) });
    });
  }, [
    active,
    face,
    selection2,
    currentLibrary,
    q,
    debouncedQ,
    mode,
    sort,
    direction,
    offset,
    filters,
    refreshToken,
    listRetry
  ]);
  (0, import_react26.useEffect)(() => {
    if (!active) return;
    if (selectedRef === void 0) {
      seq.current.inspector += 1;
      resetChildren();
      return;
    }
    resetChildren();
    const ticket = ++seq.current.inspector;
    setInspector(
      (previous) => previous?.phase === "ready" && previous.detail.ref === selectedRef ? previous : { phase: "loading" }
    );
    void face.item({ ref: selectedRef, include: INSPECTOR_INCLUDE, childPages: {} }).then((result) => {
      if (ticket !== seq.current.inspector) return;
      setInspector(itemStateOf(result));
    }).catch((error) => {
      if (ticket !== seq.current.inspector) return;
      setInspector({ phase: "error", message: messageOf(error) });
    });
  }, [active, face, selectedRef, inspectorRetry, refreshToken, resetChildren]);
  const setBranchOpen = (0, import_react26.useCallback)(
    (ref, open) => {
      setExpanded((prev) => {
        const key = objectIdentity(ref, serverId);
        const matching = [...prev].filter((item) => objectIdentity(item, serverId) === key);
        if (open) return matching.length > 0 ? prev : /* @__PURE__ */ new Set([...prev, ref]);
        if (matching.length === 0) return prev;
        const next = new Set(prev);
        matching.forEach((item) => next.delete(item));
        return next;
      });
    },
    [serverId]
  );
  const toggleCollection = (0, import_react26.useCallback)(
    (ref) => {
      navigation.cancelLocate();
      const lane = navigation.treeLane(ref);
      if (lane?.phase === "ready" && lane.total === 0) return;
      const key = objectIdentity(ref, serverId);
      setBranchOpen(ref, ![...expanded].some((item) => objectIdentity(item, serverId) === key));
    },
    [expanded, navigation, serverId, setBranchOpen]
  );
  const rewindList = (0, import_react26.useCallback)((nextOffset = 0) => {
    seq.current.list += 1;
    seq.current.inspector += 1;
    setOffset(nextOffset);
    setSelectedRef(void 0);
    setInspector(void 0);
  }, []);
  const selectLibrary = (0, import_react26.useCallback)(
    (library) => {
      if (sameLibrary(library, currentLibrary)) return;
      resetLibraryState(library, void 0, { mode, sort, direction });
    },
    [resetLibraryState, currentLibrary, mode, sort, direction]
  );
  const selectScope = (0, import_react26.useCallback)(
    (next) => {
      const nextId = scopeIdentity(next, serverId);
      const row = next.kind === "collection" ? flatTree.find(({ row: row2 }) => objectIdentity(row2.ref, serverId) === nextId)?.row : void 0;
      const containerRef = next.kind === "collection" && row !== void 0 && isContainerOnly(row) ? next.ref : void 0;
      const pane = containerRef === void 0 ? "list" : "tree";
      if (nextId === scopeIdentity(selection2, serverId)) {
        if (containerRef !== void 0) setBranchOpen(containerRef, true);
        setNarrowPaneState(pane);
        return;
      }
      navigation.cancelLocate();
      setSelection(next.kind === "collection" && row ? { ...next, path: row.path } : next);
      setQRaw("");
      setDebouncedQ("");
      setFiltersRaw({});
      rewindList();
      if (containerRef !== void 0) setBranchOpen(containerRef, true);
      setNarrowPaneState(pane);
    },
    [rewindList, selection2, serverId, flatTree, setBranchOpen]
  );
  const setMode = (0, import_react26.useCallback)(
    (next) => {
      setModeRaw(next);
      rewindList();
    },
    [rewindList]
  );
  const setSort = (0, import_react26.useCallback)(
    (next, nextDirection) => {
      setSortRaw(next);
      setDirectionRaw(nextDirection);
      rewindList();
    },
    [rewindList]
  );
  const gotoOffset = (0, import_react26.useCallback)(
    (next) => {
      rewindList(pageOffsetOf(next));
    },
    [rewindList]
  );
  const setQ = (0, import_react26.useCallback)(
    (next) => {
      setQRaw(next);
      rewindList();
    },
    [rewindList]
  );
  const setFilters = (0, import_react26.useCallback)(
    (next) => {
      if (liveScope.current !== scopeKey) return;
      setFiltersRaw(next);
      rewindList();
    },
    [rewindList, scopeKey]
  );
  const refresh = (0, import_react26.useCallback)(() => {
    face.invalidate?.();
    setRefreshToken((token) => token + 1);
    reloadCachedTree();
  }, [face, reloadCachedTree]);
  const refreshAffected = (0, import_react26.useCallback)(
    (kind) => {
      face.invalidate?.();
      if (kind === "collections") reloadCachedTree();
      if (kind === "savedSearches") refreshSavedLane();
      setListRetry((value) => value + 1);
      if (selectedRefRef.current !== void 0) setInspectorRetry((value) => value + 1);
    },
    [face, reloadCachedTree, refreshSavedLane]
  );
  (0, import_react26.useEffect)(() => {
    if (libraries.phase !== "ready" || libraries.options.length === 0) return;
    if (!libraries.options.some(({ library }) => sameLibrary(library, currentLibrary))) {
      selectLibrary(PERSONAL_LIBRARY);
    }
  }, [libraries, currentLibrary, selectLibrary]);
  return {
    libraries,
    currentLibrary,
    selectLibrary,
    flatTree,
    expanded: navigation.expanded,
    identityOf,
    toggleCollection,
    loadMoreTree: (ref) => {
      void navigation.loadMore(ref);
    },
    retryTree: (ref) => {
      void navigation.retryTree(ref);
    },
    treeLane: navigation.treeLane,
    savedSearches,
    loadMoreSavedSearches: () => {
      void navigation.loadMoreSaved();
    },
    retrySavedSearches: () => {
      void navigation.retrySaved();
    },
    locate: () => {
      setNarrowPaneState("tree");
      void navigation.locate();
    },
    locatedRef: navigation.locatedRef,
    locateError: navigation.locateError,
    selection: selection2,
    scopeKey,
    selectScope,
    q,
    setQ,
    filters,
    setFilters,
    mode,
    setMode,
    sort,
    direction,
    setSort,
    list: listOwner === requestIdentity ? list : { phase: "loading" },
    offset,
    gotoOffset,
    narrowPane,
    setNarrowPane,
    selectedRef,
    selectItem: (ref) => {
      seq.current.inspector += 1;
      setSelectedRef(ref);
      resetChildren();
      if (ref !== void 0) {
        setNarrowPaneState("inspector");
      } else {
        setInspector(void 0);
      }
    },
    inspector,
    refreshToken,
    refresh,
    refreshAffected,
    retryLibraries: () => setLibraryRetry((value) => value + 1),
    retryList: () => setListRetry((value) => value + 1),
    retryInspector: () => setInspectorRetry((value) => value + 1),
    pageChild,
    childStates,
    retryChild: (kind) => pageChild(kind, childFeed.childOffsetOf(kind))
  };
}

// src/client/components/library/LibraryTree.tsx
var import_react27 = require("react");
var import_dsh_client_ui_primitives32 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/library/library.module.css
var style12 = `.oIRwyG_panel{background:var(--dsw-alias-bg-layer-1);height:100%;min-height:0;color:var(--dsw-alias-label-primary);box-sizing:border-box;flex-direction:column;display:flex;overflow:hidden;container-type:inline-size}.oIRwyG_caption{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption)}.oIRwyG_toolbar{border-bottom:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box;flex-wrap:wrap;flex:none;align-items:center;gap:4px 6px;min-height:38px;padding:4px 8px 4px 12px;display:flex}.oIRwyG_librarySelectWrap{flex:0 auto;min-width:0}.oIRwyG_searchModeWrap,.oIRwyG_sortSelectWrap,.oIRwyG_diagnosticsWrap,.oIRwyG_refreshWrap{flex:none}.oIRwyG_toolbarBreak{display:none}.oIRwyG_selectorButton{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:220px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;font:var(--dsw-font-xxs-12);transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;border:0;flex:0 auto;align-items:center;gap:4px;padding:0 6px 0 8px;display:inline-flex}.oIRwyG_selectorButton[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.oIRwyG_selectorLabel{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}.oIRwyG_dropdownChevron,.oIRwyG_sortIcon{color:var(--dsw-alias-label-tertiary);flex:none;display:block}.oIRwyG_sortLabel{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}.oIRwyG_searchInputWrap{box-sizing:border-box;flex:140px;min-width:80px;max-width:320px;height:28px!important}.oIRwyG_searchInputWrap input{font:var(--dsw-font-xxs-12)}.oIRwyG_searchIcon{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);pointer-events:none}.oIRwyG_statusGroup{flex:none;align-items:center;gap:6px;padding:0 2px;display:inline-flex}.oIRwyG_statusText{font:var(--dsw-font-xs-13);white-space:nowrap;color:var(--dsw-alias-label-secondary);font-weight:500}.oIRwyG_spacer{flex:auto}.oIRwyG_toolButton{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;box-sizing:border-box;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:6px;line-height:1;display:inline-flex}.oIRwyG_toolButton:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.oIRwyG_actionIcon{width:15px;height:15px}.oIRwyG_everywhereHint{flex:none;align-items:center;gap:6px;padding:6px 12px 0;display:flex}.oIRwyG_hintIcon{width:12px;height:12px;color:var(--dsw-alias-label-tertiary);flex:none}.oIRwyG_offline{text-align:center;flex-direction:column;flex:auto;justify-content:center;align-items:center;gap:6px;min-height:0;padding:48px 24px;display:flex}.oIRwyG_offlineText{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:0}.oIRwyG_offlineDetail{max-width:480px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0}.oIRwyG_filterRail{border-bottom:.5px solid var(--dsw-alias-border-l2);box-sizing:border-box;flex-wrap:wrap;flex:none;align-items:center;gap:4px;padding:6px 12px;display:flex;overflow-x:visible}.oIRwyG_filterRail>*{flex:none}.oIRwyG_filterTagWrap{align-items:center;gap:4px;display:inline-flex}.oIRwyG_tagRemoveButton{border-radius:var(--dsw-radius-xs);width:14px;height:14px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;padding:0;display:inline-flex}.oIRwyG_tagRemoveButton:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.oIRwyG_tagPickerWrap{flex:none;display:inline-flex}.oIRwyG_tagPanel{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:240px;max-width:calc(100vw - 24px);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;gap:6px;padding:6px;display:flex}.oIRwyG_tagSearchInput{flex:none;height:28px!important}.oIRwyG_tagSearchInput input{font:var(--dsw-font-xxs-12)}.oIRwyG_tagOptions{box-sizing:border-box;flex-direction:column;gap:1px;max-height:220px;margin:0;padding:0;list-style:none;display:flex;overflow:hidden auto}.oIRwyG_tagOptions li{margin:0;padding:0;list-style:none}.oIRwyG_tagOption{border-radius:var(--dsw-radius-sm);width:100%;min-height:28px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);cursor:pointer;box-sizing:border-box;text-align:left;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;border:0;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;display:flex}.oIRwyG_tagOption:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}@media (hover:hover){.oIRwyG_tagOption:hover{background:var(--dsw-alias-interactive-bg-hover)}}.oIRwyG_tagOptionSelected{color:var(--dsw-alias-state-business-primary);font-weight:500}.oIRwyG_tagOptionLabel{text-overflow:ellipsis;white-space:nowrap;flex:auto;min-width:0;overflow:hidden}.oIRwyG_tagCheckIcon{color:var(--dsw-alias-state-business-primary);flex:none}.oIRwyG_tagPanelNote{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);text-align:center;margin:0;padding:12px 8px;list-style:none}.oIRwyG_tagPanelFoot{border-top:.5px solid var(--dsw-alias-border-l1);flex:none;justify-content:center;align-items:center;padding-top:4px;display:flex}.oIRwyG_chevronIcon{width:12px;height:12px;color:var(--dsw-alias-label-tertiary)}.oIRwyG_filterYearRow{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);align-items:center;gap:4px;display:inline-flex}.oIRwyG_filterNumberInput{width:60px;height:24px;font:var(--dsw-font-xxs-12);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);box-sizing:border-box;background:0 0;padding:0 6px}.oIRwyG_filterNumberInput:focus{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}.oIRwyG_filterClear{margin-left:auto}.oIRwyG_filterError{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);align-items:center;gap:6px;display:inline-flex}.oIRwyG_filterYearInvalid{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);flex-basis:100%}.oIRwyG_narrowNavWrap{border-bottom:.5px solid var(--dsw-alias-border-l2);scrollbar-width:none;flex:none;padding:6px 12px;display:flex;overflow-x:auto}.oIRwyG_narrowNavWrap>*{width:100%}.oIRwyG_narrowNavWrap::-webkit-scrollbar{display:none}.oIRwyG_columns{flex-direction:column;flex:1 1 0;width:100%;max-width:1440px;min-height:0;margin-inline:auto;display:flex;overflow:hidden}.oIRwyG_columnPane{box-sizing:border-box;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:1 1 0;min-width:0;min-height:0;display:flex}.oIRwyG_columnPaneHidden{display:none}.oIRwyG_treePane{border-right:none;padding:8px;overflow:hidden auto}.oIRwyG_listPane{border-right:none;padding:0;overflow:hidden}.oIRwyG_inspectorPane{padding:8px 16px 16px;overflow:hidden auto}@container (width>=720px){.oIRwyG_narrowNavWrap{display:none}.oIRwyG_columns{grid-template-rows:minmax(0,1fr);grid-template-columns:clamp(180px,20cqi,260px) minmax(240px,1.2fr) minmax(240px,1fr);display:grid}.oIRwyG_columns .oIRwyG_treePane,.oIRwyG_columns .oIRwyG_listPane,.oIRwyG_columns .oIRwyG_inspectorPane{display:flex}.oIRwyG_treePane,.oIRwyG_listPane{border-right:.5px solid var(--dsw-alias-border-l2)}}.oIRwyG_tree{flex-direction:column;gap:12px;display:flex}.oIRwyG_treeList{flex-direction:column;gap:1px;margin:0;padding:0;list-style:none;display:flex}.oIRwyG_treeSectionHeader{align-items:center;padding:4px 8px 2px;display:flex}.oIRwyG_treeSection{margin:0}.oIRwyG_treeRowWrap{padding-left:calc(var(--tree-depth,0) * 14px + 4px);border-radius:var(--dsw-radius-sm);box-sizing:border-box;transition:background .12s var(--ds-ease-in-out);border-left:2px solid #0000;align-items:center;display:flex}.oIRwyG_treeRowWrapActive{background:var(--dsw-alias-interactive-bg-hover);border-left-color:var(--dsw-alias-state-business-primary)}.oIRwyG_treeExpander{border-radius:var(--dsw-radius-xs);width:18px;height:18px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;margin-right:2px;padding:0;transition:transform .15s cubic-bezier(.2,0,0,1),color .12s;display:inline-flex}.oIRwyG_treeExpander:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.oIRwyG_treeExpanderOpen{transform:rotate(90deg)}.oIRwyG_chevronSvg{flex:none;width:12px;height:12px;display:block}.oIRwyG_treeExpanderPlaceholder{flex:none;width:20px;height:18px}.oIRwyG_treeRow{text-align:left;border-radius:var(--dsw-radius-sm);min-width:0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer;transition:color .12s var(--ds-ease-in-out);background:0 0;border:0;flex:1;align-items:center;gap:6px;padding:4px 6px;display:flex}.oIRwyG_treeRow:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}.oIRwyG_treeRowActive{color:var(--dsw-alias-label-primary);font-weight:500}.oIRwyG_treeRowIcon{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none}.oIRwyG_treeRowActive .oIRwyG_treeRowIcon{color:var(--dsw-alias-state-business-primary)}.oIRwyG_treeRowLabel{text-overflow:ellipsis;white-space:nowrap;flex:1;overflow:hidden}.oIRwyG_treeNote{margin:0;padding:2px 8px}.oIRwyG_treeError{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0}.oIRwyG_searchConditions{padding-left:22px}.oIRwyG_searchConditions summary{cursor:pointer;color:var(--dsw-alias-label-tertiary)}.oIRwyG_searchConditions ol{margin:2px 0;padding-left:16px}.oIRwyG_laneControls{flex-direction:column;align-items:flex-start;gap:2px;display:flex}.oIRwyG_laneCount{padding:0 8px}.oIRwyG_laneError{flex-direction:column;align-items:flex-start;gap:2px;padding:0 8px;display:flex}.oIRwyG_lanePager{align-items:center;gap:4px;padding:0 8px;display:inline-flex}.oIRwyG_list{box-sizing:border-box;flex-direction:column;flex:1 1 0;min-height:0;display:flex;overflow:hidden}.oIRwyG_listHeader{flex:none;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px 6px;display:flex}.oIRwyG_listTitle{min-width:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;margin:0;font-weight:600;overflow:hidden}.oIRwyG_listCount{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-caption);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);flex:none;padding:2px 6px}.oIRwyG_listHeaderMeta{flex:none;align-items:center;gap:4px;display:inline-flex}.oIRwyG_listLocate{width:24px;height:24px;padding:4px}.oIRwyG_listLocateError{padding:0 12px 6px}.oIRwyG_listScrollArea{box-sizing:border-box;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;flex:1 1 0;min-height:0;padding:4px 12px 8px;display:flex;overflow:hidden auto}.oIRwyG_listRows{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.oIRwyG_itemRow{text-align:left;border-radius:var(--dsw-radius-sm);cursor:pointer;box-sizing:border-box;width:100%;transition:background .12s var(--ds-ease-in-out), border-color .12s var(--ds-ease-in-out);background:0 0;border:0;border-left:2px solid #0000;flex-direction:column;gap:1px;padding:6px 8px 6px 10px;font-family:inherit;display:flex;position:relative}.oIRwyG_itemRowHasPdf .oIRwyG_itemTitle,.oIRwyG_itemRowHasPdf .oIRwyG_itemMeta{padding-right:44px}.oIRwyG_pdfBadge{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, transparent);border-radius:var(--dsw-radius-xs);height:16px;color:var(--dsw-alias-state-business-primary);font:var(--dsw-font-xxxs-11);letter-spacing:.04em;user-select:none;align-items:center;padding:0 4px;font-weight:600;display:inline-flex;position:absolute;top:50%;right:8px;transform:translateY(-50%)}.oIRwyG_itemRow:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}.oIRwyG_itemRowActive{background:var(--dsw-alias-interactive-bg-hover);border-left-color:var(--dsw-alias-state-business-primary)}.oIRwyG_itemTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-weight:500;overflow:hidden}.oIRwyG_itemYear{color:var(--dsw-alias-label-tertiary);font-weight:400}.oIRwyG_itemMeta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;align-items:center;gap:6px;display:flex;overflow:hidden}.oIRwyG_itemType{border-radius:var(--dsw-radius-xs);height:18px;font:var(--dsw-font-xxxs-11);letter-spacing:.035em;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;padding:0 6px;font-weight:600;display:inline-flex}.oIRwyG_itemCreator{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.oIRwyG_paginator{border-top:.5px solid var(--dsw-alias-border-l2);box-sizing:border-box;flex:none;justify-content:space-between;align-items:center;gap:8px;padding:6px 12px;display:flex}.oIRwyG_listNote{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);text-align:center;margin:0;padding:12px 4px}.oIRwyG_listErrorWrap{flex-direction:column;align-items:flex-start;gap:4px;padding:8px 4px;display:flex}.oIRwyG_listError{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:0}.oIRwyG_inspector{box-sizing:border-box;flex-direction:column;gap:12px;width:100%;min-width:0;display:flex}.oIRwyG_inspectorEmpty{flex:1;justify-content:center;align-items:center;min-height:160px;display:flex}.oIRwyG_emptyStateWrapper{text-align:center;flex-direction:column;align-items:center;gap:8px;max-width:280px;padding:24px 16px;display:flex}.oIRwyG_emptyStateIcon{width:16px;height:16px;color:var(--dsw-alias-label-caption)}.oIRwyG_emptyStateTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:0}.oIRwyG_inspectorHead{flex-direction:column;gap:2px;width:100%;min-width:0;display:flex}.oIRwyG_inspectorEyebrow{margin:0}.oIRwyG_inspectorCreators{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);margin:0;font-weight:500}.oIRwyG_inspectorOrigin{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);margin:0;font-weight:600}.oIRwyG_inspectorActions{flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;display:flex}.oIRwyG_inspectorActions>*{flex-shrink:0}.oIRwyG_inspectorActions button{white-space:nowrap}.oIRwyG_abstractToggle{height:22px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;align-self:flex-start;align-items:center;gap:4px;padding:0 2px;display:inline-flex}@media (hover:hover){.oIRwyG_abstractToggle:hover{color:var(--dsw-alias-label-primary)}}.oIRwyG_abstractToggle:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.oIRwyG_toggleChevron{color:var(--dsw-alias-label-tertiary);transition:transform .14s var(--ds-ease-in-out);flex:none;display:block}.oIRwyG_toggleChevronOpen{transform:rotate(180deg)}.oIRwyG_abstractClamped{max-height:160px;overflow-y:hidden;-webkit-mask-image:linear-gradient(#000 65%,#0000 100%);mask-image:linear-gradient(#000 65%,#0000 100%)}.oIRwyG_chipRow{flex-wrap:wrap;align-items:center;gap:4px;display:flex}.oIRwyG_chip{align-items:center;gap:4px;max-width:100%;display:inline-flex}.oIRwyG_chipIcon{flex:none;width:11px;height:11px}.oIRwyG_childKind{font:var(--dsw-font-xxxs-11);letter-spacing:.035em;color:var(--dsw-alias-label-tertiary);flex:none;font-weight:600}.oIRwyG_inspectorTitle{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);white-space:normal;word-break:break-word;overflow-wrap:break-word;flex:1;min-width:0;margin:0;font-weight:600}.oIRwyG_metaTable{grid-template-columns:max-content minmax(0,1fr);align-items:baseline;gap:4px 12px;min-width:0;margin:0;display:grid}.oIRwyG_metaRow{display:contents}.oIRwyG_metaLabel{text-align:left;user-select:none}.oIRwyG_metaValue{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);white-space:normal;word-break:break-word;overflow-wrap:break-word;min-width:0;margin:0}.oIRwyG_copyInline{color:var(--dsw-alias-link);font:var(--dsw-font-xxs-12);cursor:pointer;text-align:left;white-space:normal;word-break:break-word;background:0 0;border:0;padding:0}.oIRwyG_copyInline:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-link));outline-offset:1px}.oIRwyG_section{flex-direction:column;gap:6px;display:flex}.oIRwyG_sectionTitle{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-caption);letter-spacing:.02em;margin:0 0 6px}.oIRwyG_abstract{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;margin:0}.oIRwyG_childList{flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;display:flex}.oIRwyG_childRow{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font:var(--dsw-font-xxs-12);box-sizing:border-box;justify-content:space-between;align-items:center;gap:8px;min-width:0;padding:4px 8px;display:flex}.oIRwyG_childRowClickable{text-align:left;width:100%;font:inherit;color:inherit;cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);border:0}.oIRwyG_childRowClickable:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}@media (hover:hover){.oIRwyG_childRowClickable:hover{background:var(--dsw-alias-interactive-bg-hover)}.oIRwyG_childRowClickable:hover .oIRwyG_childTitle{color:var(--dsw-alias-link)}}.oIRwyG_childInfo{flex:1;align-items:center;gap:8px;min-width:0;display:flex}.oIRwyG_childFileIcon{flex:none}.oIRwyG_childTitle{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font:var(--dsw-font-xxs-12);min-width:0;overflow:hidden}.oIRwyG_sectionHeaderBtn{cursor:pointer;text-align:left;background:0 0;border:none;justify-content:space-between;align-items:center;width:100%;margin:0 0 6px;padding:2px 0;display:flex}.oIRwyG_sectionHeaderBtn .oIRwyG_sectionTitle{margin:0}@media (hover:hover){.oIRwyG_sectionHeaderBtn:hover .oIRwyG_sectionTitle{color:var(--dsw-alias-label-primary)}}.oIRwyG_sectionHeaderBtn:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px;border-radius:var(--dsw-radius-xs)}.oIRwyG_cardClamped{-webkit-line-clamp:4;-webkit-box-orient:vertical;display:-webkit-box;position:relative;overflow:hidden;-webkit-mask-image:linear-gradient(#000 65%,#0000 100%);mask-image:linear-gradient(#000 65%,#0000 100%)}.oIRwyG_truncatedHint{font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-caption);font-style:italic}.oIRwyG_noteCard{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);box-sizing:border-box;min-width:0;transition:border-color .12s var(--ds-ease-in-out);flex-direction:column;gap:6px;padding:8px 10px;display:flex}@media (hover:hover){.oIRwyG_noteCard:hover{border-color:var(--dsw-alias-border-l1)}}.oIRwyG_noteText{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;margin:0}.oIRwyG_annotationCard{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-left:2px solid var(--dsw-alias-state-business-primary);box-sizing:border-box;min-width:0;transition:border-color .12s var(--ds-ease-in-out);flex-direction:column;gap:6px;padding:8px 10px;display:flex}@media (hover:hover){.oIRwyG_annotationCard:hover{border-top-color:var(--dsw-alias-border-l1);border-right-color:var(--dsw-alias-border-l1);border-bottom-color:var(--dsw-alias-border-l1)}}.oIRwyG_annotationHeader{justify-content:space-between;align-items:center;gap:8px;min-width:0;display:flex}.oIRwyG_pageBadge{border-radius:var(--dsw-radius-xs);font:var(--dsw-font-xxxs-11);font-variant-numeric:tabular-nums;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-caption);border:.5px solid var(--dsw-alias-border-l2);flex:none;align-items:center;padding:1px 6px;font-weight:500;display:inline-flex}.oIRwyG_tabMenuItem{width:100%;min-height:34px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);text-align:left;border-radius:var(--dsw-radius-md);cursor:pointer;box-sizing:border-box;background:0 0;border:none;align-items:center;gap:6px;padding:6px 8px;display:flex}@media (hover:hover){.oIRwyG_tabMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}}.oIRwyG_annotationQuote{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;margin:0;font-style:normal}.oIRwyG_annotationComment{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l1);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-secondary);word-break:break-word;overflow-wrap:break-word;align-items:flex-start;gap:6px;margin-top:2px;padding:6px 8px;display:flex}.oIRwyG_commentIcon{font:var(--dsw-font-xxs-12);user-select:none;opacity:.8;flex:none}.oIRwyG_commentText{white-space:pre-wrap;flex:1;min-width:0;margin:0}.oIRwyG_cardFooter{justify-content:space-between;align-items:center;gap:8px;min-width:0;margin-top:2px;display:flex}.oIRwyG_cardToggle{height:20px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:none;align-self:flex-start;align-items:center;gap:4px;padding:0 2px;display:inline-flex}@media (hover:hover){.oIRwyG_cardToggle:hover{color:var(--dsw-alias-label-primary)}}.oIRwyG_cardToggle:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.oIRwyG_cardActions{flex:none;align-items:center;gap:6px;margin-left:auto;display:flex}.oIRwyG_cardActionBtn{border-radius:var(--dsw-radius-xs);font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-caption);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);background:0 0;border:none;align-items:center;gap:3px;padding:2px 5px;display:inline-flex}@media (hover:hover){.oIRwyG_cardActionBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3)}}.oIRwyG_cardActionBtn:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.oIRwyG_childPager{flex-wrap:wrap;align-items:center;gap:4px;display:flex}.oIRwyG_writeCard{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);box-sizing:border-box;flex-direction:column;flex:none;gap:8px;margin-bottom:12px;padding:8px 10px;display:flex}.oIRwyG_writeCard>summary{cursor:pointer;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);font-weight:500}.oIRwyG_writeForm{border:0;flex-direction:column;gap:8px;min-width:0;margin:0;padding:0;display:flex}.oIRwyG_writeField{border:0;flex-direction:column;gap:2px;min-width:0;margin:0;padding:0;display:flex}.oIRwyG_writeInput,.oIRwyG_writeSelect,.oIRwyG_writeTextarea{font:var(--dsw-font-xxs-12);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);box-sizing:border-box;background:0 0;padding:4px 8px}.oIRwyG_writeTextarea{resize:vertical}.oIRwyG_writeInput:focus,.oIRwyG_writeSelect:focus,.oIRwyG_writeTextarea:focus{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}.oIRwyG_writeConditionRow{align-items:flex-end;gap:6px;display:flex}.oIRwyG_writeConditionField{flex:1}.oIRwyG_writeSubmitButton{align-self:flex-start;height:24px;font-weight:500}.oIRwyG_writeResult{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;display:flex}.oIRwyG_writeResult strong{color:var(--dsw-alias-label-primary);font-weight:500}.oIRwyG_writeResult pre{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;margin:0;padding:6px 8px}.oIRwyG_writeResultFailed,.oIRwyG_writeResultFailed strong{color:var(--dsw-alias-state-error-primary)}@media (hover:hover){.oIRwyG_selectorButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.oIRwyG_toolButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.oIRwyG_tagRemoveButton:hover{color:var(--dsw-alias-label-primary)}.oIRwyG_treeRowWrap:hover{background:var(--dsw-alias-interactive-bg-hover)}.oIRwyG_treeExpander:hover,.oIRwyG_treeRow:hover{color:var(--dsw-alias-label-primary)}.oIRwyG_itemRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.oIRwyG_writeCard>summary:hover{color:var(--dsw-alias-label-primary)}.oIRwyG_copyInline:hover{text-underline-offset:3px;text-decoration:underline dotted}}@media (pointer:coarse){.oIRwyG_searchInputWrap input,.oIRwyG_filterNumberInput,.oIRwyG_tagSearchInput input,.oIRwyG_writeInput,.oIRwyG_writeSelect,.oIRwyG_writeTextarea{font-size:16px}}@container (width<=640px){.oIRwyG_statusText,.oIRwyG_sortLabel{display:none}.oIRwyG_searchInputWrap{flex-basis:100px;max-width:none}.oIRwyG_searchModeWrap [role=tab]{font-size:var(--dsw-font-xxxs-11-font-size);height:24px;padding:0 8px}}@container (width<=520px){.oIRwyG_librarySelectWrap{order:1;max-width:140px}.oIRwyG_spacer{flex:auto;order:2}.oIRwyG_statusGroup{order:3}.oIRwyG_diagnosticsWrap{order:4}.oIRwyG_refreshWrap{order:5}.oIRwyG_toolbarBreak{flex-basis:100%;order:6;width:100%;height:0;margin:0;display:block}.oIRwyG_searchInputWrap{flex:80px;order:7;min-width:80px}.oIRwyG_searchModeWrap{order:8}.oIRwyG_sortSelectWrap{order:9}.oIRwyG_toolbar{gap:4px 6px;padding:4px 8px}.oIRwyG_filterRail{padding-inline:8px}.oIRwyG_inspectorPane{padding-inline:12px}}@container (width<=460px){.oIRwyG_toolbar{gap:4px;padding:4px 6px}.oIRwyG_narrowNavWrap{padding:4px 8px}.oIRwyG_narrowNavWrap [role=tab]{font-size:var(--dsw-font-xxs-12-font-size);padding-inline:8px}.oIRwyG_listHeader,.oIRwyG_listScrollArea,.oIRwyG_paginator{padding-inline:8px}.oIRwyG_metaTable{grid-template-columns:minmax(0,1fr);row-gap:2px}.oIRwyG_writeConditionRow{flex-wrap:wrap}}@container (width<=360px){.oIRwyG_librarySelectWrap{max-width:110px}.oIRwyG_searchModeWrap [role=tab]{font-size:var(--dsw-font-xxxs-11-font-size);padding:0 4px}.oIRwyG_paginator{flex-wrap:wrap;gap:4px}}@media (prefers-reduced-motion:reduce){.oIRwyG_selectorButton,.oIRwyG_toolButton,.oIRwyG_treeRowWrap,.oIRwyG_treeExpander,.oIRwyG_treeRow,.oIRwyG_itemRow,.oIRwyG_tagOption,.oIRwyG_toggleChevron,.oIRwyG_childRowClickable,.oIRwyG_noteCard,.oIRwyG_annotationCard,.oIRwyG_cardActionBtn{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/library/library.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/library/library.module.css");
  tag.textContent = style12;
  document.head.appendChild(tag);
}
var library_default = { "librarySelectWrap": "oIRwyG_librarySelectWrap", "treeRowIcon": "oIRwyG_treeRowIcon", "itemCreator": "oIRwyG_itemCreator", "childList": "oIRwyG_childList", "writeConditionRow": "oIRwyG_writeConditionRow", "tagOption": "oIRwyG_tagOption", "toolbarBreak": "oIRwyG_toolbarBreak", "tagOptions": "oIRwyG_tagOptions", "pdfBadge": "oIRwyG_pdfBadge", "inspectorActions": "oIRwyG_inspectorActions", "columns": "oIRwyG_columns", "filterNumberInput": "oIRwyG_filterNumberInput", "searchModeWrap": "oIRwyG_searchModeWrap", "listHeaderMeta": "oIRwyG_listHeaderMeta", "chipIcon": "oIRwyG_chipIcon", "sectionTitle": "oIRwyG_sectionTitle", "noteCard": "oIRwyG_noteCard", "offline": "oIRwyG_offline", "inspectorCreators": "oIRwyG_inspectorCreators", "cardClamped": "oIRwyG_cardClamped", "treeNote": "oIRwyG_treeNote", "writeForm": "oIRwyG_writeForm", "narrowNavWrap": "oIRwyG_narrowNavWrap", "chip": "oIRwyG_chip", "filterClear": "oIRwyG_filterClear", "diagnosticsWrap": "oIRwyG_diagnosticsWrap", "tagOptionLabel": "oIRwyG_tagOptionLabel", "everywhereHint": "oIRwyG_everywhereHint", "sortIcon": "oIRwyG_sortIcon", "selectorLabel": "oIRwyG_selectorLabel", "writeSubmitButton": "oIRwyG_writeSubmitButton", "sortSelectWrap": "oIRwyG_sortSelectWrap", "lanePager": "oIRwyG_lanePager", "listNote": "oIRwyG_listNote", "section": "oIRwyG_section", "itemTitle": "oIRwyG_itemTitle", "dropdownChevron": "oIRwyG_dropdownChevron", "searchInputWrap": "oIRwyG_searchInputWrap", "childTitle": "oIRwyG_childTitle", "filterError": "oIRwyG_filterError", "listError": "oIRwyG_listError", "treeRowLabel": "oIRwyG_treeRowLabel", "inspectorOrigin": "oIRwyG_inspectorOrigin", "sectionHeaderBtn": "oIRwyG_sectionHeaderBtn", "annotationHeader": "oIRwyG_annotationHeader", "searchConditions": "oIRwyG_searchConditions", "tree": "oIRwyG_tree", "inspectorEmpty": "oIRwyG_inspectorEmpty", "commentIcon": "oIRwyG_commentIcon", "tagPanel": "oIRwyG_tagPanel", "sortLabel": "oIRwyG_sortLabel", "annotationQuote": "oIRwyG_annotationQuote", "copyInline": "oIRwyG_copyInline", "statusText": "oIRwyG_statusText", "itemMeta": "oIRwyG_itemMeta", "cardToggle": "oIRwyG_cardToggle", "inspectorHead": "oIRwyG_inspectorHead", "writeField": "oIRwyG_writeField", "treePane": "oIRwyG_treePane", "emptyStateTitle": "oIRwyG_emptyStateTitle", "tagRemoveButton": "oIRwyG_tagRemoveButton", "toggleChevron": "oIRwyG_toggleChevron", "metaTable": "oIRwyG_metaTable", "abstract": "oIRwyG_abstract", "cardActions": "oIRwyG_cardActions", "tagSearchInput": "oIRwyG_tagSearchInput", "writeConditionField": "oIRwyG_writeConditionField", "writeSelect": "oIRwyG_writeSelect", "listLocateError": "oIRwyG_listLocateError", "laneCount": "oIRwyG_laneCount", "hintIcon": "oIRwyG_hintIcon", "childPager": "oIRwyG_childPager", "childFileIcon": "oIRwyG_childFileIcon", "writeCard": "oIRwyG_writeCard", "tagPickerWrap": "oIRwyG_tagPickerWrap", "emptyStateIcon": "oIRwyG_emptyStateIcon", "listScrollArea": "oIRwyG_listScrollArea", "filterRail": "oIRwyG_filterRail", "itemType": "oIRwyG_itemType", "selectorButton": "oIRwyG_selectorButton", "cardFooter": "oIRwyG_cardFooter", "panel": "oIRwyG_panel", "listErrorWrap": "oIRwyG_listErrorWrap", "tagOptionSelected": "oIRwyG_tagOptionSelected", "treeList": "oIRwyG_treeList", "treeExpanderPlaceholder": "oIRwyG_treeExpanderPlaceholder", "list": "oIRwyG_list", "filterYearRow": "oIRwyG_filterYearRow", "childKind": "oIRwyG_childKind", "laneControls": "oIRwyG_laneControls", "toggleChevronOpen": "oIRwyG_toggleChevronOpen", "commentText": "oIRwyG_commentText", "treeRowWrap": "oIRwyG_treeRowWrap", "itemRowHasPdf": "oIRwyG_itemRowHasPdf", "pageBadge": "oIRwyG_pageBadge", "laneError": "oIRwyG_laneError", "listHeader": "oIRwyG_listHeader", "listRows": "oIRwyG_listRows", "tagCheckIcon": "oIRwyG_tagCheckIcon", "treeSection": "oIRwyG_treeSection", "emptyStateWrapper": "oIRwyG_emptyStateWrapper", "listTitle": "oIRwyG_listTitle", "chipRow": "oIRwyG_chipRow", "inspectorTitle": "oIRwyG_inspectorTitle", "statusGroup": "oIRwyG_statusGroup", "chevronIcon": "oIRwyG_chevronIcon", "childRow": "oIRwyG_childRow", "writeResult": "oIRwyG_writeResult", "itemRowActive": "oIRwyG_itemRowActive", "treeError": "oIRwyG_treeError", "searchIcon": "oIRwyG_searchIcon", "treeRowWrapActive": "oIRwyG_treeRowWrapActive", "itemRow": "oIRwyG_itemRow", "toolbar": "oIRwyG_toolbar", "offlineDetail": "oIRwyG_offlineDetail", "abstractClamped": "oIRwyG_abstractClamped", "treeExpander": "oIRwyG_treeExpander", "paginator": "oIRwyG_paginator", "tagPanelNote": "oIRwyG_tagPanelNote", "columnPane": "oIRwyG_columnPane", "listPane": "oIRwyG_listPane", "abstractToggle": "oIRwyG_abstractToggle", "childRowClickable": "oIRwyG_childRowClickable", "filterYearInvalid": "oIRwyG_filterYearInvalid", "inspectorPane": "oIRwyG_inspectorPane", "treeRowActive": "oIRwyG_treeRowActive", "listCount": "oIRwyG_listCount", "metaLabel": "oIRwyG_metaLabel", "annotationCard": "oIRwyG_annotationCard", "tabMenuItem": "oIRwyG_tabMenuItem", "annotationComment": "oIRwyG_annotationComment", "writeTextarea": "oIRwyG_writeTextarea", "inspector": "oIRwyG_inspector", "listLocate": "oIRwyG_listLocate", "caption": "oIRwyG_caption", "treeRow": "oIRwyG_treeRow", "toolButton": "oIRwyG_toolButton", "actionIcon": "oIRwyG_actionIcon", "refreshWrap": "oIRwyG_refreshWrap", "offlineText": "oIRwyG_offlineText", "tagPanelFoot": "oIRwyG_tagPanelFoot", "chevronSvg": "oIRwyG_chevronSvg", "writeResultFailed": "oIRwyG_writeResultFailed", "cardActionBtn": "oIRwyG_cardActionBtn", "childInfo": "oIRwyG_childInfo", "spacer": "oIRwyG_spacer", "noteText": "oIRwyG_noteText", "filterTagWrap": "oIRwyG_filterTagWrap", "itemYear": "oIRwyG_itemYear", "treeSectionHeader": "oIRwyG_treeSectionHeader", "treeExpanderOpen": "oIRwyG_treeExpanderOpen", "metaRow": "oIRwyG_metaRow", "metaValue": "oIRwyG_metaValue", "inspectorEyebrow": "oIRwyG_inspectorEyebrow", "columnPaneHidden": "oIRwyG_columnPaneHidden", "writeInput": "oIRwyG_writeInput", "truncatedHint": "oIRwyG_truncatedHint" };

// src/client/components/library/LibraryLaneControls.tsx
var import_dsh_client_ui_primitives31 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/library/ListingPager.tsx
var import_dsh_client_ui_primitives30 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/library/LibraryPager.tsx
var import_dsh_client_ui_primitives29 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime35 = require("react/jsx-runtime");
function LibraryPager({
  t,
  label,
  offset,
  limit,
  total,
  returned,
  nextOffset,
  busy = false,
  onPage,
  showRange = true
}) {
  const range = returned > 0 ? { start: offset + 1, end: offset + returned, total } : { start: 0, end: 0, total };
  return /* @__PURE__ */ (0, import_jsx_runtime35.jsxs)("div", { className: library_default.paginator, role: "group", "aria-label": label, children: [
    /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(
      import_dsh_client_ui_primitives29.Button,
      {
        variant: "outline",
        size: "sm",
        disabled: busy || offset === 0,
        onClick: () => onPage(previousPageOffsetOf(offset, limit)),
        children: t("libraryPagePrev")
      }
    ),
    showRange && /* @__PURE__ */ (0, import_jsx_runtime35.jsx)("span", { className: library_default.caption, "aria-live": "polite", children: t("libraryRangeOfTotal", {
      start: range.start,
      end: range.end,
      total: range.total
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime35.jsx)(
      import_dsh_client_ui_primitives29.Button,
      {
        variant: "outline",
        size: "sm",
        disabled: busy || nextOffset === void 0,
        onClick: () => {
          if (nextOffset !== void 0) onPage(nextOffset);
        },
        children: t("libraryPageNext")
      }
    )
  ] });
}

// src/client/components/library/ListingPager.tsx
var import_jsx_runtime36 = require("react/jsx-runtime");
function ListingPager({
  t,
  status,
  retry,
  retryAriaLabel,
  errorVariant = "inline",
  pager
}) {
  const page = pager?.page;
  const paging = page !== void 0 && (page.offset > 0 || page.nextOffset !== void 0);
  const retryButton = /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
    import_dsh_client_ui_primitives30.Button,
    {
      variant: "outline",
      size: "sm",
      "aria-label": retryAriaLabel ?? t("libraryRetry"),
      onClick: retry,
      children: t("libraryRetry")
    }
  );
  return /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(import_jsx_runtime36.Fragment, { children: [
    status?.phase === "loading" && /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("span", { role: "status", className: clsx_default(library_default.caption, library_default.treeNote), children: t("libraryLoading") }),
    status?.phase === "error" && (errorVariant === "lane" ? /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)("div", { role: "alert", className: library_default.laneError, children: [
      /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("p", { className: library_default.treeError, children: status.message }),
      retryButton
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime36.jsxs)(import_jsx_runtime36.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime36.jsx)("p", { role: "alert", className: library_default.treeError, children: status.message }),
      retryButton
    ] })),
    paging && pager !== void 0 && page !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime36.jsx)(
      LibraryPager,
      {
        t,
        label: page.label,
        offset: page.offset,
        limit: page.limit,
        total: page.total,
        returned: page.returned,
        nextOffset: page.nextOffset,
        busy: status?.phase === "loading",
        onPage: pager.onPage
      }
    )
  ] });
}

// src/client/components/library/LibraryLaneControls.tsx
var import_jsx_runtime37 = require("react/jsx-runtime");
function LibraryLaneControls({
  t,
  label,
  lane,
  page,
  retry
}) {
  const current = lanePageOf(lane);
  const status = lane?.phase === "loading" ? { phase: "loading" } : lane?.phase === "error" ? { phase: "error", message: lane.message } : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime37.jsxs)(
    "div",
    {
      role: "group",
      "aria-label": label,
      "aria-busy": lane?.phase === "loading",
      className: library_default.laneControls,
      children: [
        current !== void 0 && current.nextOffset !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("span", { className: clsx_default(library_default.caption, library_default.laneCount), children: t("libraryLoadedCount", { loaded: current.rows.length, total: current.total }) }),
        /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(
          ListingPager,
          {
            t,
            status,
            retry,
            retryAriaLabel: `${label}: ${t("libraryRetry")}`,
            errorVariant: "lane"
          }
        ),
        current?.nextOffset !== void 0 && lane?.phase === "ready" && /* @__PURE__ */ (0, import_jsx_runtime37.jsx)("div", { className: library_default.lanePager, children: /* @__PURE__ */ (0, import_jsx_runtime37.jsx)(import_dsh_client_ui_primitives31.Button, { variant: "outline", size: "sm", onClick: page, children: t("libraryLoadMore") }) })
      ]
    }
  );
}

// src/client/components/library/LibraryTree.tsx
var import_jsx_runtime38 = require("react/jsx-runtime");
var FIXED_SCOPES = [
  {
    selection: { kind: "library" },
    labelKey: "libraryAllItems",
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(import_dsh_client_ui_primitives32.IconDeliverDocMedium, { className: library_default.treeRowIcon })
  },
  {
    selection: { kind: "publications" },
    labelKey: "libraryPublications",
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(import_dsh_client_ui_primitives32.IconUserOutlineMedium, { className: library_default.treeRowIcon })
  },
  {
    selection: { kind: "trash" },
    labelKey: "libraryTrash",
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(import_dsh_client_ui_primitives32.IconTrashOutlineMedium, { className: library_default.treeRowIcon })
  }
];
function sameFixedScope(selection2, fixed) {
  return selection2.kind === fixed.kind;
}
function closingBranchesOf(flatTree, expanded) {
  const closing = /* @__PURE__ */ new Map();
  const open = [];
  flatTree.forEach((entry, index) => {
    if (expanded.has(entry.row.ref)) open.push(entry);
    const nextDepth = flatTree[index + 1]?.depth ?? -1;
    const closed = [];
    while (open.length > 0 && open.at(-1).depth >= nextDepth) closed.push(open.pop());
    if (closed.length > 0) closing.set(entry.row.ref, closed);
  });
  return closing;
}
function LibraryTree({
  t,
  locatedRef,
  flatTree,
  expanded,
  identityOf,
  toggleCollection,
  selection: selection2,
  selectScope,
  savedSearches,
  rootLane,
  treeLane,
  loadMoreTree,
  retryTree,
  loadMoreSavedSearches,
  retrySavedSearches
}) {
  const savedPage = lanePageOf(savedSearches);
  const selectionKey = "ref" in selection2 ? identityOf(selection2.ref) : void 0;
  const [focused, setFocused] = (0, import_react27.useState)();
  const buttons = (0, import_react27.useRef)(/* @__PURE__ */ new Map());
  const focus = (ref) => {
    if (ref === void 0) return;
    setFocused(ref);
    buttons.current.get(ref)?.focus();
  };
  const focusRef = flatTree.some(({ row }) => row.ref === focused) ? focused : flatTree[0]?.row.ref;
  (0, import_react27.useEffect)(() => {
    if (focused !== void 0 && focusRef !== focused) setFocused(focusRef);
  }, [focusRef, focused]);
  (0, import_react27.useEffect)(() => {
    if (locatedRef === void 0) return;
    const button = buttons.current.get(locatedRef);
    button?.scrollIntoView?.({ block: "nearest" });
    focus(locatedRef);
  }, [locatedRef]);
  const hasNoChildren = (row, lane) => {
    const page = lanePageOf(lane);
    return page !== void 0 ? page.total === 0 : row.childCount === 0;
  };
  const closingBranches = (0, import_react27.useMemo)(() => closingBranchesOf(flatTree, expanded), [flatTree, expanded]);
  const keyDown = (event, index) => {
    const { row, depth } = flatTree[index];
    switch (event.key) {
      case "ArrowDown":
        focus(flatTree[index + 1]?.row.ref);
        break;
      case "ArrowUp":
        focus(flatTree[index - 1]?.row.ref);
        break;
      case "Home":
        focus(flatTree[0]?.row.ref);
        break;
      case "End":
        focus(flatTree.at(-1)?.row.ref);
        break;
      case "ArrowRight":
        if (hasNoChildren(row, treeLane(row.ref))) break;
        if (!expanded.has(row.ref)) toggleCollection(row.ref);
        else if (flatTree[index + 1]?.depth === depth + 1) focus(flatTree[index + 1]?.row.ref);
        break;
      case "ArrowLeft":
        if (expanded.has(row.ref)) toggleCollection(row.ref);
        else
          focus(
            flatTree.slice(0, index).reverse().find((entry) => entry.depth < depth)?.row.ref
          );
        break;
      case "Enter":
        selectScope({ kind: "collection", ref: row.ref, name: row.name });
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("nav", { className: library_default.tree, "aria-label": t("libraryPanel"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("ul", { className: library_default.treeList, children: FIXED_SCOPES.map(({ selection: fixed, labelKey, icon: Icon }) => /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
      "div",
      {
        className: clsx_default(
          library_default.treeRowWrap,
          sameFixedScope(selection2, fixed) && library_default.treeRowWrapActive
        ),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", { className: library_default.treeExpanderPlaceholder }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
            "button",
            {
              type: "button",
              className: clsx_default(library_default.treeRow, sameFixedScope(selection2, fixed) && library_default.treeRowActive),
              "aria-current": sameFixedScope(selection2, fixed) ? "page" : void 0,
              onClick: () => selectScope(fixed),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(Icon, {}),
                /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", { className: library_default.treeRowLabel, children: t(labelKey) })
              ]
            }
          )
        ]
      }
    ) }, fixed.kind)) }),
    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("div", { className: library_default.treeSectionHeader, children: /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", { className: clsx_default(library_default.caption, library_default.treeSection), children: t("libraryCollections") }) }),
    rootLane?.phase === "ready" && flatTree.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", { className: clsx_default(library_default.caption, library_default.treeNote), children: t("libraryNoCollections") }),
    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(
      "ul",
      {
        className: library_default.treeList,
        role: "tree",
        "aria-label": t("libraryCollections"),
        onKeyDownCapture: (event) => {
          if (event.target instanceof HTMLElement && event.target.closest("[role=treeitem]") === null && flatTree.length > 0) {
            if (event.key === "ArrowDown" || event.key === "Home") {
              focus(flatTree[0]?.row.ref);
              event.preventDefault();
            } else if (event.key === "End") {
              focus(flatTree.at(-1)?.row.ref);
              event.preventDefault();
            }
          }
        },
        children: flatTree.map(({ row, depth, setSize, posInSet }, index) => {
          const lane = treeLane(row.ref);
          const childless = hasNoChildren(row, lane);
          const isExpanded = !childless && expanded.has(row.ref);
          const isSelected = selection2.kind === "collection" && identityOf(row.ref) === selectionKey;
          return /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("li", { role: "none", children: [
            /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
              "div",
              {
                className: clsx_default(library_default.treeRowWrap, isSelected && library_default.treeRowWrapActive),
                style: { "--tree-depth": depth },
                children: [
                  childless ? /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", { className: library_default.treeExpanderPlaceholder }) : /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(
                    "button",
                    {
                      type: "button",
                      tabIndex: -1,
                      className: clsx_default(library_default.treeExpander, isExpanded && library_default.treeExpanderOpen),
                      "aria-expanded": isExpanded,
                      "aria-label": row.name,
                      onClick: () => {
                        buttons.current.get(row.ref)?.focus();
                        toggleCollection(row.ref);
                      },
                      children: /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(import_dsh_client_ui_primitives32.IconChevronRightOutlineMedium, { className: library_default.chevronSvg })
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
                    "button",
                    {
                      type: "button",
                      role: "treeitem",
                      ref: (element) => {
                        if (element) buttons.current.set(row.ref, element);
                        else buttons.current.delete(row.ref);
                      },
                      tabIndex: focusRef === row.ref ? 0 : -1,
                      "aria-level": depth + 1,
                      "aria-expanded": childless ? void 0 : isExpanded,
                      "aria-busy": lane?.phase === "loading" || void 0,
                      "aria-selected": isSelected,
                      "aria-setsize": setSize,
                      "aria-posinset": posInSet,
                      onFocus: () => setFocused(row.ref),
                      onKeyDown: (event) => keyDown(event, index),
                      className: clsx_default(library_default.treeRow, isSelected && library_default.treeRowActive),
                      title: row.path.length > 0 ? row.path.join(" / ") : row.name,
                      onClick: () => selectScope({ kind: "collection", ref: row.ref, name: row.name }),
                      children: [
                        isExpanded ? /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(import_dsh_client_ui_primitives32.IconFolderOpenMedium, { className: library_default.treeRowIcon }) : /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(import_dsh_client_ui_primitives32.IconFolderCloseMedium, { className: library_default.treeRowIcon }),
                        /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", { className: library_default.treeRowLabel, children: row.name })
                      ]
                    }
                  )
                ]
              }
            ),
            closingBranches.get(row.ref)?.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(
              LibraryLaneControls,
              {
                t,
                label: entry.row.name,
                lane: treeLane(entry.row.ref),
                page: () => loadMoreTree(entry.row.ref),
                retry: () => retryTree(entry.row.ref)
              },
              entry.row.ref
            ))
          ] }, row.ref);
        })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(
      LibraryLaneControls,
      {
        t,
        label: t("libraryCollections"),
        lane: rootLane,
        page: () => loadMoreTree(void 0),
        retry: () => retryTree(void 0)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("div", { className: library_default.treeSectionHeader, children: /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", { className: clsx_default(library_default.caption, library_default.treeSection), children: t("librarySavedSearches") }) }),
    savedPage?.rows.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("p", { className: clsx_default(library_default.caption, library_default.treeNote), children: t("libraryNoSavedSearches") }),
    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("ul", { className: library_default.treeList, children: savedPage?.rows.map((row) => {
      const isSelected = selection2.kind === "savedSearch" && identityOf(row.ref) === selectionKey;
      return /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("li", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("div", { className: clsx_default(library_default.treeRowWrap, isSelected && library_default.treeRowWrapActive), children: [
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", { className: library_default.treeExpanderPlaceholder }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)(
            "button",
            {
              type: "button",
              className: clsx_default(library_default.treeRow, isSelected && library_default.treeRowActive),
              "aria-current": isSelected ? "page" : void 0,
              onClick: () => selectScope({ kind: "savedSearch", ref: row.ref, name: row.name }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(import_dsh_client_ui_primitives32.IconSearchOutlineMedium, { className: library_default.treeRowIcon }),
                /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("span", { className: library_default.treeRowLabel, children: row.name })
              ]
            }
          )
        ] }),
        row.conditions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("details", { className: clsx_default(library_default.caption, library_default.searchConditions), children: [
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("summary", { children: t("librarySearchConditions") }),
          /* @__PURE__ */ (0, import_jsx_runtime38.jsx)("ol", { children: row.conditions.map((condition, index) => /* @__PURE__ */ (0, import_jsx_runtime38.jsxs)("li", { children: [
            condition.condition,
            " \xB7 ",
            condition.operator,
            " \xB7 ",
            condition.value
          ] }, index)) })
        ] })
      ] }, row.ref);
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime38.jsx)(
      LibraryLaneControls,
      {
        t,
        label: t("librarySavedSearches"),
        lane: savedSearches,
        page: loadMoreSavedSearches,
        retry: retrySavedSearches
      }
    )
  ] });
}

// src/client/components/library/LibraryItemList.tsx
var import_dsh_client_ui_primitives33 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime39 = require("react/jsx-runtime");
function selectionLabelOf(selection2, t) {
  switch (selection2.kind) {
    case "library":
      return t("libraryAllItems");
    case "publications":
      return t("libraryPublications");
    case "trash":
      return t("libraryTrash");
    case "collection":
      return selection2.path?.join(" / ") || selection2.name;
    case "savedSearch":
      return selection2.name;
  }
}
function LibraryItemList({
  t,
  filtered,
  returnToLibrary,
  locate,
  locateError,
  list,
  selection: selection2,
  offset,
  gotoOffset,
  selectedRef,
  selectItem,
  retry
}) {
  const range = list.phase === "ready" ? pageRangeOf(list, list.items.length) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)(
    "section",
    {
      className: library_default.list,
      "aria-busy": list.phase === "loading",
      "aria-label": t("libraryItemList"),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("header", { className: library_default.listHeader, children: [
          /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("h2", { className: library_default.listTitle, children: selectionLabelOf(selection2, t) }),
          /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("div", { className: library_default.listHeaderMeta, children: [
            list.phase === "ready" && range !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("span", { className: library_default.listCount, children: t("libraryRangeOfTotal", { start: range.start, end: range.end, total: range.total }) }),
            locate !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(
              "button",
              {
                type: "button",
                className: clsx_default(library_default.toolButton, library_default.listLocate),
                "aria-label": t("libraryLocate"),
                title: t("libraryLocate"),
                onClick: locate,
                children: /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(import_dsh_client_ui_primitives33.IconWorkspaceTreeOutlineMedium, { className: library_default.actionIcon })
              }
            )
          ] })
        ] }),
        locate !== void 0 && locateError !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("p", { role: "alert", className: clsx_default(library_default.treeError, library_default.listLocateError), children: locateError }),
        /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("div", { className: library_default.listScrollArea, children: [
          list.phase === "loading" && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("p", { className: library_default.listNote, role: "status", children: t("libraryLoading") }),
          list.phase === "error" && /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("div", { role: "alert", className: library_default.listErrorWrap, children: [
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("p", { className: library_default.listError, children: list.message }),
            /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(import_dsh_client_ui_primitives33.Button, { variant: "outline", size: "sm", onClick: retry, children: t("libraryRetry") }),
            "ref" in selection2 && returnToLibrary && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(import_dsh_client_ui_primitives33.Button, { variant: "outline", size: "sm", onClick: returnToLibrary, children: t("libraryAllItems") })
          ] }),
          list.phase === "ready" && list.items.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("p", { className: library_default.listNote, children: t(filtered ? "libraryNoMatches" : "libraryEmptyList") }),
          list.phase === "ready" && list.items.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("ul", { className: library_default.listRows, children: list.items.map((item) => {
            const isSelected = selectedRef === item.ref;
            const hasPdf2 = isPdfContentType(item.bestAttachmentType);
            return /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)(
              "button",
              {
                type: "button",
                className: clsx_default(
                  library_default.itemRow,
                  isSelected && library_default.itemRowActive,
                  hasPdf2 && library_default.itemRowHasPdf
                ),
                onClick: () => selectItem(isSelected ? void 0 : item.ref),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("span", { className: library_default.itemTitle, children: [
                    item.title,
                    item.year !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("span", { className: library_default.itemYear, children: [
                      " (",
                      item.year,
                      ")"
                    ] })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime39.jsxs)("span", { className: library_default.itemMeta, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("span", { className: library_default.itemType, children: item.itemType }),
                    item.creatorSummary !== "" && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("span", { className: library_default.itemCreator, children: item.creatorSummary })
                  ] }),
                  hasPdf2 && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("span", { className: library_default.pdfBadge, children: "PDF" })
                ]
              }
            ) }, item.ref);
          }) })
        ] }),
        list.phase === "ready" && (list.items.length > 0 || offset > 0) && /* @__PURE__ */ (0, import_jsx_runtime39.jsx)("footer", { children: /* @__PURE__ */ (0, import_jsx_runtime39.jsx)(
          LibraryPager,
          {
            t,
            label: t("libraryItemList"),
            offset,
            limit: list.limit,
            total: list.total,
            returned: list.items.length,
            nextOffset: list.nextOffset,
            onPage: gotoOffset,
            showRange: false
          }
        ) })
      ]
    }
  );
}

// src/client/components/library/LibraryInspector.tsx
var import_react29 = require("react");
var import_dsh_client_ui_primitives35 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/creators.ts
var DEFAULT_CREATOR_TYPE = "author";
function formatCreatorDisplayName(creator) {
  const name = creator.name ?? `${creator.firstName ?? ""} ${creator.lastName ?? ""}`.trim();
  if (name === "") return "";
  return creator.creatorType !== DEFAULT_CREATOR_TYPE && creator.creatorType !== void 0 ? `${name} (${creator.creatorType})` : name;
}
function formatCreatorsList(creators) {
  return creators.map(formatCreatorDisplayName).filter((name) => name !== "").join("; ");
}

// src/client/components/library/LibraryCitationActions.tsx
var import_react28 = require("react");
var import_dsh_client_ui_primitives34 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime40 = require("react/jsx-runtime");
var DONE_KEY = {
  citation: "libraryCopyCitationDone",
  bibtex: "libraryCopyBibtexDone",
  bibliography: "libraryCopyBibliographyDone",
  biblatex: "libraryCopyBiblatexDone",
  ris: "libraryCopyRisDone",
  csljson: "libraryCopyCsljsonDone",
  itemInfo: "libraryCopyItemInfoDone"
};
var ALL_FORMATS = [
  { format: "bibtex", label: "libraryCopyBibtex" },
  { format: "biblatex", label: "libraryCopyBiblatex" },
  { format: "ris", label: "libraryCopyRis" },
  { format: "csljson", label: "libraryCopyCsljson" },
  { format: "itemInfo", label: "libraryCopyItemInfo", separatorBefore: true }
];
var CopyLocaleError = class extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
  key;
};
function copyTextOf(result) {
  if (result.format !== "citation") return result.text;
  const citation = result.citations[0];
  if (citation === void 0 || citation.text === "") {
    throw new CopyLocaleError("libraryCopyCitationEmpty");
  }
  return citation.text;
}
function itemInfoTextOf(detail) {
  const creators = formatCreatorsList(detail.creators);
  const origin = joinNonEmpty(detail.year, detail.venue);
  return [
    detail.title,
    creators,
    origin,
    detail.doi === void 0 ? "" : `DOI: ${detail.doi}`,
    detail.url === void 0 ? "" : `URL: ${detail.url}`
  ].filter((line, index) => index === 0 || line !== "").join("\n");
}
function LibraryCitationActions({
  detail,
  exportItem,
  t
}) {
  const [menuOpen, setMenuOpen] = (0, import_react28.useState)(false);
  const [action, setAction] = (0, import_react28.useState)(void 0);
  const { phase, error, copy } = useCopyFeedback(detail.ref);
  const busy = phase === "pending";
  const wireUnavailable = exportItem === void 0;
  (0, import_react28.useEffect)(() => {
    setMenuOpen(false);
    setAction(void 0);
  }, [detail.ref]);
  const run = (next) => {
    if (next === "itemInfo") {
      setAction(next);
      copy(async () => itemInfoTextOf(detail));
      return;
    }
    if (exportItem === void 0) return;
    const face = exportItem;
    setAction(next);
    copy(async () => {
      const result = await face({ refs: [detail.ref], format: next });
      if (!result.ok) throw result.error;
      return copyTextOf(result.value);
    });
  };
  let buttonLabel = t("libraryCitationMenu");
  if (action !== void 0) {
    if (phase === "pending") {
      buttonLabel = t("libraryExportPending");
    } else if (phase === "done") {
      buttonLabel = t(DONE_KEY[action]);
    }
  }
  let errorText;
  if (phase === "rejected") {
    errorText = t("libraryCopyClipboardUnavailable");
  } else if (phase === "error") {
    errorText = error instanceof CopyLocaleError ? t(error.key) : t("libraryCopyFailed", { message: messageOf(error) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime40.jsxs)(import_jsx_runtime40.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime40.jsx)(
      import_dsh_client_ui_primitives34.Menu,
      {
        open: menuOpen,
        portal: true,
        align: "start",
        onClose: () => setMenuOpen(false),
        anchor: /* @__PURE__ */ (0, import_jsx_runtime40.jsxs)(
          import_dsh_client_ui_primitives34.Button,
          {
            variant: "outline",
            size: "sm",
            icon: /* @__PURE__ */ (0, import_jsx_runtime40.jsx)(import_dsh_client_ui_primitives34.IconCopyOutlineRegular, { size: 14 }),
            "aria-haspopup": "menu",
            "aria-expanded": menuOpen,
            "aria-label": buttonLabel,
            disabled: busy,
            onClick: () => setMenuOpen((open) => !open),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", { children: buttonLabel }),
              /* @__PURE__ */ (0, import_jsx_runtime40.jsx)(import_dsh_client_ui_primitives34.IconChevronDownOutlineRegular, { size: 12 })
            ]
          }
        ),
        children: ALL_FORMATS.map(({ format, label, separatorBefore }) => /* @__PURE__ */ (0, import_jsx_runtime40.jsx)(
          import_dsh_client_ui_primitives34.MenuItemButton,
          {
            separatorBefore,
            disabled: busy || format !== "itemInfo" && wireUnavailable,
            onSelect: () => {
              setMenuOpen(false);
              void run(format);
            },
            children: t(label)
          },
          format
        ))
      }
    ),
    errorText !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime40.jsx)("span", { className: library_default.listError, role: "alert", children: errorText })
  ] });
}

// src/client/components/library/LibraryInspector.tsx
var import_jsx_runtime41 = require("react/jsx-runtime");
function MetaRow({ label, value }) {
  return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.metaRow, children: [
    /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("dt", { className: clsx_default(library_default.caption, library_default.metaLabel), children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("dd", { className: library_default.metaValue, children: value })
  ] });
}
function attachmentKindOf(contentType) {
  if (contentType === PDF_CONTENT_TYPE) return "PDF";
  if (contentType === HTML_CONTENT_TYPE) return "HTML";
  const subtype = contentType.split("/")[1];
  return (subtype ?? contentType).toUpperCase();
}
function fileTypeKindFor(contentType, filename) {
  if (contentType === PDF_CONTENT_TYPE) return "pdf";
  if (contentType === HTML_CONTENT_TYPE) return "html";
  if (contentType.includes("markdown") || filename.toLowerCase().endsWith(".md")) return "markdown";
  return "other";
}
var DSH_SUPPORTED_MIMES = [
  "application/pdf",
  "text/",
  "image/",
  "application/json",
  "application/xml"
];
var DSH_SUPPORTED_EXTS = /* @__PURE__ */ new Set([
  "pdf",
  "md",
  "markdown",
  "txt",
  "text",
  "html",
  "htm",
  "json",
  "xml",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp"
]);
function isDshSupportedAttachment(contentType, title) {
  if (DSH_SUPPORTED_MIMES.some((mime) => contentType.startsWith(mime))) return true;
  const ext = title.split(".").pop()?.toLowerCase();
  return ext !== void 0 && DSH_SUPPORTED_EXTS.has(ext);
}
function AttachmentItem({
  t,
  attachment,
  openFile,
  resolveAttachment
}) {
  const [resolving, setResolving] = (0, import_react29.useState)(false);
  const [error, setError] = (0, import_react29.useState)(null);
  const supported = isDshSupportedAttachment(attachment.contentType, attachment.title);
  const canOpen = supported && (openFile !== void 0 || resolveAttachment !== void 0);
  const handleOpen = async () => {
    if (!canOpen || resolving) return;
    setError(null);
    setResolving(true);
    try {
      const resolver = resolveAttachment ?? getAttachmentResolver();
      if (!resolver) return;
      const res = await resolver(attachment.ref);
      if (res.ok) {
        if (res.value.kind === "file" && res.value.path) {
          if (openFile) openFile(res.value.path);
        } else if (res.value.kind === "url" && res.value.url) {
          window.open(res.value.url, "_blank", "noopener,noreferrer");
        }
      } else {
        setError(res.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };
  const content = /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(import_jsx_runtime41.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.childInfo, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
        import_dsh_client_ui_primitives35.FileTypeIcon,
        {
          kind: fileTypeKindFor(attachment.contentType, attachment.title),
          size: 18,
          className: library_default.childFileIcon
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { className: library_default.childTitle, title: error ?? attachment.title, children: resolving ? `${attachment.title} (${t("libraryLoading")})` : attachment.title })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { className: library_default.childKind, children: attachmentKindOf(attachment.contentType) })
  ] });
  if (canOpen) {
    return /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
      "button",
      {
        type: "button",
        className: clsx_default(library_default.childRow, library_default.childRowClickable),
        onClick: handleOpen,
        disabled: resolving,
        "aria-label": attachment.title,
        title: error ?? (supported ? t("readPdfInSidebar") : attachment.title),
        children: content
      }
    ) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("li", { className: library_default.childRow, children: content });
}
function NoteItem({
  t,
  note,
  inputActions
}) {
  const [expanded, setExpanded] = (0, import_react29.useState)(false);
  const isLong = note.truncated || note.text.length > 180 || note.text.split("\n").length > 4;
  const handleInsert = () => {
    if (!inputActions) return;
    inputActions.insertQuote(note.text.replace(/\r\n?/gu, "\n"));
  };
  return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("li", { className: library_default.noteCard, children: [
    /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("div", { className: clsx_default(library_default.noteText, isLong && !expanded && library_default.cardClamped), children: note.text }),
    note.truncated && !expanded && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { className: library_default.truncatedHint, children: t("libraryAbstractTruncated") }),
    /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.cardFooter, children: [
      isLong ? /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
        "button",
        {
          type: "button",
          className: library_default.cardToggle,
          "aria-expanded": expanded,
          onClick: () => setExpanded((v) => !v),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: expanded ? t("libraryCollapse") : t("libraryExpand") }),
            /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
              import_dsh_client_ui_primitives35.IconChevronDownOutlineRegular,
              {
                size: 12,
                className: clsx_default(library_default.toggleChevron, expanded && library_default.toggleChevronOpen)
              }
            )
          ]
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", {}),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.cardActions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
          CopyButton,
          {
            value: note.text,
            label: t("copy"),
            copiedLabel: t("copied"),
            className: library_default.cardActionBtn,
            icon: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconCopyOutlineRegular, { size: 11 }),
            title: t("libraryCopyNote")
          }
        ),
        inputActions !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
          "button",
          {
            type: "button",
            className: library_default.cardActionBtn,
            onClick: handleInsert,
            title: t("libraryInsertNote"),
            "aria-label": t("libraryInsertNote"),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconNewChatOutlineRegular, { size: 11 }),
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: t("libraryInsertNote") })
            ]
          }
        )
      ] })
    ] })
  ] });
}
function AnnotationItem({
  t,
  annotation,
  inputActions,
  targetAttachmentRef
}) {
  const [expanded, setExpanded] = (0, import_react29.useState)(false);
  const isLong = annotation.text.length > 180 || annotation.text.split("\n").length > 4;
  const handleInsert = () => {
    if (!inputActions) return;
    const pageInfo = annotation.pageLabel ? ` (P. ${annotation.pageLabel})` : "";
    const quote = `"${annotation.text}"${pageInfo}`;
    inputActions.insertQuote(quote);
  };
  const identity = parseRefIdentity(annotation.ref);
  const annotationKey = identity && (identity.kind === "annotation" || identity.kind === "item") && /^[A-Z0-9]{8}$/.test(identity.key) ? identity.key : void 0;
  const annotationUrl = targetAttachmentRef && annotationKey ? pdfUrlOf(targetAttachmentRef, { annotation: annotationKey }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("li", { className: library_default.annotationCard, children: [
    /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.annotationHeader, children: [
      annotation.pageLabel !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.Tag, { className: library_default.pageBadge, tone: "neutral", children: t("libraryAnnotationPageBadge", { page: annotation.pageLabel }) }) : /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", {}),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.cardActions, children: [
        annotationUrl !== null && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
          "button",
          {
            type: "button",
            className: library_default.cardActionBtn,
            onClick: () => void launchZoteroProtocol(annotationUrl),
            title: t("openInZoteroTooltip"),
            "aria-label": t("openInZotero"),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconLinkOutlineRegular, { size: 11 }),
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: t("openInZotero") })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
          CopyButton,
          {
            value: annotation.text,
            label: t("copy"),
            copiedLabel: t("copied"),
            className: library_default.cardActionBtn,
            icon: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconCopyOutlineRegular, { size: 11 }),
            title: t("libraryCopyQuote")
          }
        ),
        inputActions !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
          "button",
          {
            type: "button",
            className: library_default.cardActionBtn,
            onClick: handleInsert,
            title: t("libraryInsertQuote"),
            "aria-label": t("libraryInsertQuote"),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconNewChatOutlineRegular, { size: 11 }),
              /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: t("libraryInsertQuote") })
            ]
          }
        )
      ] })
    ] }),
    annotation.text !== "" && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("blockquote", { className: clsx_default(library_default.annotationQuote, isLong && !expanded && library_default.cardClamped), children: annotation.text }),
    isLong && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
      "button",
      {
        type: "button",
        className: library_default.cardToggle,
        "aria-expanded": expanded,
        onClick: () => setExpanded((v) => !v),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: expanded ? t("libraryCollapse") : t("libraryExpand") }),
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
            import_dsh_client_ui_primitives35.IconChevronDownOutlineRegular,
            {
              size: 12,
              className: clsx_default(library_default.toggleChevron, expanded && library_default.toggleChevronOpen)
            }
          )
        ]
      }
    ),
    annotation.comment !== void 0 && annotation.comment !== "" && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.annotationComment, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { className: library_default.commentIcon, "aria-hidden": "true", children: "\u{1F4AC}" }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.commentText, children: annotation.comment })
    ] })
  ] });
}
function LibraryInspector({
  t,
  inspector,
  inputActions,
  openFile,
  resolveAttachment,
  retry,
  pageChild,
  childStates,
  retryChild,
  exportItem
}) {
  const [abstractOpen, setAbstractOpen] = (0, import_react29.useState)(false);
  if (inspector === void 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("aside", { className: library_default.inspector, "aria-label": t("libraryInspector"), children: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("div", { className: library_default.inspectorEmpty, children: /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.emptyStateWrapper, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconInspectOutlineMedium, { className: library_default.emptyStateIcon }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.emptyStateTitle, children: t("libraryNoSelection") })
    ] }) }) });
  }
  if (inspector.phase === "loading") {
    return /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("aside", { className: library_default.inspector, "aria-label": t("libraryInspector"), children: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.listNote, role: "status", children: t("libraryLoading") }) });
  }
  if (inspector.phase === "error") {
    return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("aside", { className: library_default.inspector, "aria-label": t("libraryInspector"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.listError, role: "alert", children: inspector.message }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
        import_dsh_client_ui_primitives35.Button,
        {
          variant: "outline",
          size: "sm",
          "aria-label": `${t("libraryInspector")}: ${t("libraryRetry")}`,
          onClick: retry,
          children: t("libraryRetry")
        }
      )
    ] });
  }
  const detail = inspector.detail;
  const creators = formatCreatorsList(detail.creators);
  const origin = [detail.venue, detail.date].filter(Boolean).join(" \xB7 ");
  const pdfAttachment = pdfAttachmentOf(detail);
  const askPrompt = t("libraryAskPrompt", { title: detail.title, ref: detail.ref });
  const askInChat = () => {
    if (!inputActions) return;
    if (!inputActions.insertQuote(askPrompt)) {
      const span = inputActions.captureInsertion();
      if (span !== void 0) {
        inputActions.insertText(askPrompt, span);
      } else {
        inputActions.setDraft(askPrompt);
      }
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("aside", { className: library_default.inspector, "aria-label": t("libraryInspector"), children: [
    /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("header", { className: library_default.inspectorHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: clsx_default(library_default.caption, library_default.inspectorEyebrow), children: detail.itemType }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h3", { className: library_default.inspectorTitle, children: detail.title }),
      creators !== "" && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.inspectorCreators, children: creators }),
      origin !== "" && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.inspectorOrigin, children: origin }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.inspectorActions, children: [
        pdfAttachment !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
          PdfReadButton,
          {
            attachmentRef: pdfAttachment.ref,
            onOpenFile: openFile,
            resolveAttachment,
            requireSessionForResolvedFile: openFile === void 0,
            emphasis: "primary",
            t
          }
        ),
        inputActions !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
          import_dsh_client_ui_primitives35.Button,
          {
            variant: "outline",
            size: "sm",
            icon: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconPlusOutlineRegular, { size: 14 }),
            onClick: askInChat,
            title: t("libraryAskInChat"),
            children: t("libraryAskInChat")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(LibraryCitationActions, { detail, exportItem, t }),
        selectUrlOf(detail.ref) !== null && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
          import_dsh_client_ui_primitives35.Button,
          {
            variant: "outline",
            size: "sm",
            icon: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconLinkOutlineRegular, { size: 14 }),
            onClick: () => {
              const url = selectUrlOf(detail.ref);
              if (url) void launchZoteroProtocol(url);
            },
            title: t("openInZoteroTooltip"),
            children: t("openInZotero")
          }
        )
      ] })
    ] }),
    detail.abstract !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("section", { className: library_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h4", { className: library_default.sectionTitle, children: t("libraryMetaAbstract") }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
        "p",
        {
          className: clsx_default(
            library_default.abstract,
            detail.abstractTruncated && !abstractOpen && library_default.abstractClamped
          ),
          children: detail.abstract
        }
      ),
      detail.abstractTruncated && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
        "button",
        {
          type: "button",
          className: library_default.abstractToggle,
          "aria-expanded": abstractOpen,
          onClick: () => setAbstractOpen((open) => !open),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: abstractOpen ? t("libraryCollapse") : t("libraryExpand") }),
            /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
              import_dsh_client_ui_primitives35.IconChevronDownOutlineRegular,
              {
                size: 12,
                className: clsx_default(library_default.toggleChevron, abstractOpen && library_default.toggleChevronOpen)
              }
            )
          ]
        }
      )
    ] }),
    detail.noteBody !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("section", { className: library_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h4", { className: library_default.sectionTitle, children: t("libraryMetaNote") }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.abstract, children: detail.noteBody.text }),
      detail.noteBody.truncated && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("p", { className: library_default.listNote, children: t("libraryAbstractTruncated") })
    ] }),
    (detail.venue !== void 0 || detail.date !== void 0 || detail.doi !== void 0 || detail.url !== void 0 || detail.extra !== void 0) && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("section", { className: library_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h4", { className: library_default.sectionTitle, children: t("libraryInfoTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("dl", { className: library_default.metaTable, children: [
        detail.venue !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(MetaRow, { label: t("libraryMetaVenue"), value: detail.venue }),
        detail.date !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(MetaRow, { label: t("libraryMetaDate"), value: detail.date }),
        detail.doi !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.metaRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("dt", { className: clsx_default(library_default.caption, library_default.metaLabel), children: t("libraryMetaDoi") }),
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("dd", { className: library_default.metaValue, children: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
            CopyButton,
            {
              value: detail.doi,
              label: detail.doi,
              copiedLabel: t("copied"),
              className: library_default.copyInline
            }
          ) })
        ] }),
        detail.url !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("div", { className: library_default.metaRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("dt", { className: clsx_default(library_default.caption, library_default.metaLabel), children: t("libraryMetaUrl") }),
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("dd", { className: library_default.metaValue, children: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
            CopyButton,
            {
              value: detail.url,
              label: detail.url,
              copiedLabel: t("copied"),
              className: library_default.copyInline
            }
          ) })
        ] }),
        detail.extra !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(MetaRow, { label: t("libraryMetaExtra"), value: detail.extra })
      ] })
    ] }),
    detail.collections.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("section", { className: library_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h4", { className: library_default.sectionTitle, children: t("libraryMetaCollections") }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("div", { className: library_default.chipRow, children: detail.collections.map((collection) => /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(import_dsh_client_ui_primitives35.Tag, { tone: "outline", className: library_default.chip, children: [
        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.IconFolderCloseMedium, { size: 11, className: library_default.chipIcon }),
        /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: collection.name ?? collection.ref })
      ] }, collection.ref)) })
    ] }),
    detail.tags.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("section", { className: library_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h4", { className: library_default.sectionTitle, children: t("libraryMetaTags") }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("div", { className: library_default.chipRow, children: detail.tags.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(import_dsh_client_ui_primitives35.Tag, { tone: "outline", className: library_default.chip, children: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("span", { children: tag }) }, tag)) })
    ] }),
    detail.attachments !== void 0 && detail.attachments.total > 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
      ChildSection,
      {
        t,
        title: t("libraryAttachmentsTitle", { count: detail.attachments.total }),
        page: detail.attachments,
        state: childStates.attachments,
        retry: () => retryChild("attachments"),
        pageTo: (offset) => pageChild("attachments", offset),
        children: detail.attachments.items.map((attachment) => /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
          AttachmentItem,
          {
            t,
            attachment,
            openFile,
            resolveAttachment
          },
          attachment.ref
        ))
      }
    ),
    detail.notes !== void 0 && detail.notes.total > 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
      ChildSection,
      {
        t,
        title: t("libraryNotesTitle", { count: detail.notes.total }),
        page: detail.notes,
        state: childStates.notes,
        retry: () => retryChild("notes"),
        pageTo: (offset) => pageChild("notes", offset),
        children: detail.notes.items.map((note) => /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(NoteItem, { t, note, inputActions }, note.ref))
      }
    ),
    detail.annotations !== void 0 && detail.annotations.total > 0 && /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
      ChildSection,
      {
        t,
        title: t("libraryAnnotationsTitle", { count: detail.annotations.total }),
        page: detail.annotations,
        state: childStates.annotations,
        retry: () => retryChild("annotations"),
        pageTo: (offset) => pageChild("annotations", offset),
        children: detail.annotations.items.map((annotation) => {
          const targetAttachmentRef = annotation.parentRef ?? detail.attachments?.items.find((att) => att.contentType === "application/pdf")?.ref ?? detail.attachments?.items[0]?.ref;
          return /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
            AnnotationItem,
            {
              t,
              annotation,
              inputActions,
              targetAttachmentRef
            },
            annotation.ref
          );
        })
      }
    )
  ] });
}
function ChildSection({
  t,
  title,
  page,
  state,
  retry,
  pageTo,
  children,
  defaultOpen = true
}) {
  const [open, setOpen] = (0, import_react29.useState)(defaultOpen);
  return /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)("section", { className: library_default.section, children: [
    /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(
      "button",
      {
        type: "button",
        className: library_default.sectionHeaderBtn,
        "aria-expanded": open,
        "aria-label": open ? t("librarySectionCollapse", { title }) : t("librarySectionExpand", { title }),
        onClick: () => setOpen((prev) => !prev),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("h4", { className: library_default.sectionTitle, children: title }),
          /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
            import_dsh_client_ui_primitives35.IconChevronDownOutlineRegular,
            {
              size: 12,
              className: clsx_default(library_default.toggleChevron, open && library_default.toggleChevronOpen)
            }
          )
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime41.jsxs)(import_jsx_runtime41.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("ul", { className: library_default.childList, children }),
      /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
        ChildPager,
        {
          t,
          label: title,
          offset: page.offset,
          limit: page.limit,
          total: page.total,
          returned: page.returned,
          nextOffset: page.nextOffset,
          setOffset: pageTo,
          state,
          retry
        }
      )
    ] })
  ] });
}
function ChildPager({
  t,
  label,
  offset,
  limit,
  total,
  returned,
  nextOffset,
  setOffset,
  state,
  retry
}) {
  if (offset === 0 && nextOffset === void 0 && state === void 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime41.jsx)("div", { className: library_default.childPager, children: /* @__PURE__ */ (0, import_jsx_runtime41.jsx)(
    ListingPager,
    {
      t,
      status: state,
      retry,
      pager: { page: { label, offset, limit, total, returned, nextOffset }, onPage: setOffset }
    }
  ) });
}

// src/client/components/library/LibraryFilters.tsx
var import_react31 = require("react");
var import_dsh_client_ui_primitives37 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/library/LibraryTagPicker.tsx
var import_react30 = require("react");
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives36 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime42 = require("react/jsx-runtime");
var TAG_SEARCH_DEBOUNCE_MS = 200;
var PANEL_GAP = 4;
var VIEWPORT_MARGIN = 8;
var TAG_PANEL_Z_INDEX = 1100;
function LibraryTagPicker({
  t,
  face,
  library,
  value,
  change,
  enabled,
  onError
}) {
  const [open, setOpen] = (0, import_react30.useState)(false);
  const [query, setQuery] = (0, import_react30.useState)("");
  const [rows, setRows] = (0, import_react30.useState)([]);
  const [nextOffset, setNextOffset] = (0, import_react30.useState)(void 0);
  const [loading, setLoading] = (0, import_react30.useState)(false);
  const selected = (0, import_react30.useMemo)(() => new Set(value.tags ?? []), [value.tags]);
  const seq = (0, import_react30.useRef)(0);
  const debounce = (0, import_react30.useRef)(void 0);
  const rowsLibrary = (0, import_react30.useRef)();
  const triggerRef = (0, import_react30.useRef)(null);
  const panelRef = (0, import_react30.useRef)(null);
  const requestPage = (search2, offset, append) => {
    const ticket = seq.current + 1;
    seq.current = ticket;
    setLoading(true);
    void face.browse({
      kind: "tags",
      library,
      offset,
      limit: LIBRARY_PAGE_SIZE,
      ...search2 !== "" ? { q: search2, match: "contains" } : {}
    }).then((result) => {
      if (seq.current !== ticket) return;
      setLoading(false);
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      rowsLibrary.current = library;
      const tags = result.value.items.flatMap((row) => row.kind === "tag" ? [row.tag] : []);
      setRows((previous) => append ? [...previous, ...tags] : tags);
      setNextOffset(result.value.nextOffset);
    }).catch((error) => {
      if (seq.current !== ticket) return;
      setLoading(false);
      onError(messageOf(error));
    });
  };
  (0, import_react30.useEffect)(() => {
    rowsLibrary.current = void 0;
    setRows([]);
    setNextOffset(void 0);
    setQuery("");
    setLoading(false);
    return () => {
      seq.current += 1;
      if (debounce.current !== void 0) clearTimeout(debounce.current);
    };
  }, [library.type, library.id]);
  const position = (0, import_dsh_client_ui_primitives36.useAnchoredPosition)({
    open,
    anchorRef: triggerRef,
    panelRef,
    gap: PANEL_GAP,
    margin: VIEWPORT_MARGIN
  });
  (0, import_dsh_client_ui_primitives36.useDismissOnOutsidePointer)(triggerRef, open, setOpen, panelRef);
  (0, import_react30.useEffect)(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const active = document.activeElement;
      const inside = active instanceof Node && (panelRef.current?.contains(active) === true || triggerRef.current?.contains(active) === true);
      setOpen(false);
      if (inside) triggerRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  const toggleOpen = () => {
    const next = !open;
    if (!next && debounce.current !== void 0) {
      clearTimeout(debounce.current);
      debounce.current = void 0;
    }
    setOpen(next);
    if (next && enabled && (rows.length === 0 || rowsLibrary.current === void 0 || !sameLibrary(rowsLibrary.current, library))) {
      requestPage("", 0, false);
    }
  };
  const search = (text) => {
    setQuery(text);
    if (debounce.current !== void 0) clearTimeout(debounce.current);
    if (!enabled) return;
    debounce.current = setTimeout(() => requestPage(text.trim(), 0, false), TAG_SEARCH_DEBOUNCE_MS);
  };
  const latest = (0, import_react30.useRef)({ selected, value, change });
  latest.current = { selected, value, change };
  const toggleTag = (0, import_react30.useCallback)((tag) => {
    const current = latest.current;
    const next = new Set(current.selected);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    current.change({ ...current.value, tags: Array.from(next) });
  }, []);
  const options = (0, import_react30.useMemo)(
    () => rows.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime42.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)(
      "button",
      {
        type: "button",
        role: "option",
        "aria-selected": selected.has(tag),
        className: clsx_default(library_default.tagOption, selected.has(tag) && library_default.tagOptionSelected),
        onClick: () => toggleTag(tag),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime42.jsx)("span", { className: library_default.tagOptionLabel, children: tag }),
          selected.has(tag) && /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(import_dsh_client_ui_primitives36.IconCheckOutlineRegular, { size: 14, className: library_default.tagCheckIcon })
        ]
      }
    ) }, tag)),
    [rows, selected, toggleTag]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)("div", { className: library_default.tagPickerWrap, ref: triggerRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)(
      import_dsh_client_ui_primitives36.Pill,
      {
        active: selected.size > 0,
        onClick: toggleOpen,
        "aria-label": t("libraryFilterTags"),
        "aria-expanded": open,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime42.jsx)("span", { children: t("libraryFilterTags") }),
          selected.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)("span", { children: [
            "(",
            selected.size,
            ")"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(import_dsh_client_ui_primitives36.IconChevronDownOutlineMedium, { className: library_default.chevronIcon })
        ]
      }
    ),
    open && (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)(
        import_dsh_client_ui_primitives36.MenuSurface,
        {
          ref: panelRef,
          compact: true,
          className: library_default.tagPanel,
          role: "group",
          "aria-label": t("libraryFilterTags"),
          style: {
            position: "fixed",
            zIndex: TAG_PANEL_Z_INDEX,
            // The first measure runs after mount; until then the panel is
            // placed but invisible, so it can read its own size.
            ...position ?? { visibility: "hidden" }
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(
              import_dsh_client_ui_primitives36.Input,
              {
                type: "search",
                className: library_default.tagSearchInput,
                icon: /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(import_dsh_client_ui_primitives36.IconSearchOutlineMedium, { size: 14, className: library_default.searchIcon }),
                placeholder: t("librarySearchTags"),
                "aria-label": t("librarySearchTags"),
                value: query,
                onChange: (event) => search(event.target.value),
                autoFocus: true
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)("ul", { className: library_default.tagOptions, children: [
              options,
              rows.length === 0 && !loading && /* @__PURE__ */ (0, import_jsx_runtime42.jsx)("li", { className: library_default.tagPanelNote, children: t("libraryEmptyList") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime42.jsxs)("div", { className: library_default.tagPanelFoot, children: [
              loading && /* @__PURE__ */ (0, import_jsx_runtime42.jsx)("span", { className: library_default.tagPanelNote, children: t("libraryLoading") }),
              !loading && nextOffset !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime42.jsx)(
                import_dsh_client_ui_primitives36.Button,
                {
                  variant: "outline",
                  size: "sm",
                  onClick: () => requestPage(query.trim(), nextOffset, true),
                  children: t("libraryLoadMore")
                }
              )
            ] })
          ]
        }
      ),
      document.body
    )
  ] });
}

// src/client/components/library/LibraryFilters.tsx
var import_jsx_runtime43 = require("react/jsx-runtime");
var YEAR_COMMIT_DEBOUNCE_MS = 300;
function LibraryFilters({
  t,
  face,
  library,
  value,
  change,
  enabled = true
}) {
  const [types, setTypes] = (0, import_react31.useState)([]);
  const [error, setError] = (0, import_react31.useState)();
  const [retry, setRetry] = (0, import_react31.useState)(0);
  const [typeMenuOpen, setTypeMenuOpen] = (0, import_react31.useState)(false);
  const [yearOpen, setYearOpen] = (0, import_react31.useState)(false);
  const [yearDraft, setYearDraft] = (0, import_react31.useState)({ from: "", to: "" });
  const [yearInvalid, setYearInvalid] = (0, import_react31.useState)(false);
  const yearTimer = (0, import_react31.useRef)(void 0);
  (0, import_react31.useEffect)(() => {
    if (!enabled) return;
    let active = true;
    setError(void 0);
    setTypes([]);
    void (async () => {
      const rows = [];
      let offset = 0;
      for (; ; ) {
        const result = await face.browse({ kind: "itemTypes", offset, limit: LIBRARY_PAGE_SIZE });
        if (!active) return;
        if (!result.ok) throw new Error(result.error.message);
        rows.push(...result.value.items);
        const next = result.value.nextOffset;
        if (next === void 0) break;
        if (next <= offset) throw new Error(t("libraryInvalidPage"));
        offset = next;
      }
      if (active) {
        setTypes(
          rows.flatMap(
            (row) => row.kind === "itemType" ? [{ value: row.itemType, label: row.localized ?? row.itemType }] : []
          )
        );
      }
    })().catch((cause) => {
      if (active) setError(messageOf(cause));
    });
    return () => {
      active = false;
    };
  }, [face, retry, enabled, t]);
  (0, import_react31.useEffect)(
    () => () => {
      if (yearTimer.current !== void 0) clearTimeout(yearTimer.current);
    },
    []
  );
  const selectedTypes = (0, import_react31.useMemo)(() => new Set(value.itemTypes ?? []), [value.itemTypes]);
  const selectedTags = (0, import_react31.useMemo)(() => new Set(value.tags ?? []), [value.tags]);
  const typeMenuItems = (0, import_react31.useMemo)(() => {
    return types.map((item) => ({
      id: item.value,
      label: item.label
    }));
  }, [types]);
  const hasFilters = Boolean(
    (value.itemTypes?.length ?? 0) > 0 || (value.tags?.length ?? 0) > 0 || value.hasAttachment !== void 0 || value.yearFrom !== void 0 || value.yearTo !== void 0
  );
  const toggleAttachment = () => {
    if (value.hasAttachment === void 0) {
      change({ ...value, hasAttachment: true });
    } else if (value.hasAttachment === true) {
      change({ ...value, hasAttachment: false });
    } else {
      change({ ...value, hasAttachment: void 0 });
    }
  };
  const toggleTagMatch = () => {
    change({ ...value, tagMatch: value.tagMatch === "any" ? "all" : "any" });
  };
  const commitYear = (from, to) => {
    if (yearTimer.current !== void 0) clearTimeout(yearTimer.current);
    const fromValue = from === "" ? void 0 : Number(from);
    const toValue = to === "" ? void 0 : Number(to);
    if (fromValue !== void 0 && toValue !== void 0 && fromValue > toValue) {
      setYearInvalid(true);
      return;
    }
    setYearInvalid(false);
    if (value.yearFrom === fromValue && value.yearTo === toValue) return;
    change({ ...value, yearFrom: fromValue, yearTo: toValue });
  };
  const editYear = (side, text) => {
    const draft = { ...yearDraft, [side]: text };
    setYearDraft(draft);
    if (yearTimer.current !== void 0) clearTimeout(yearTimer.current);
    yearTimer.current = setTimeout(() => commitYear(draft.from, draft.to), YEAR_COMMIT_DEBOUNCE_MS);
  };
  const openYear = () => {
    const next = !yearOpen;
    setYearOpen(next);
    setYearInvalid(false);
    if (next) {
      setYearDraft({
        from: value.yearFrom === void 0 ? "" : String(value.yearFrom),
        to: value.yearTo === void 0 ? "" : String(value.yearTo)
      });
    } else if (yearTimer.current !== void 0) {
      clearTimeout(yearTimer.current);
      commitYear(yearDraft.from, yearDraft.to);
    }
  };
  const clearAll = () => {
    if (yearTimer.current !== void 0) clearTimeout(yearTimer.current);
    setYearOpen(false);
    setYearInvalid(false);
    setYearDraft({ from: "", to: "" });
    change({});
  };
  return /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("div", { className: library_default.filterRail, role: "toolbar", "aria-label": t("libraryFilters"), children: [
    types.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(
      import_dsh_client_ui_primitives37.Menu,
      {
        open: typeMenuOpen,
        anchor: /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)(
          import_dsh_client_ui_primitives37.Pill,
          {
            active: selectedTypes.size > 0,
            onClick: () => setTypeMenuOpen(!typeMenuOpen),
            "aria-label": t("libraryFilterTypes"),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("span", { children: t("libraryFilterTypes") }),
              selectedTypes.size > 0 && /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("span", { children: [
                "(",
                selectedTypes.size,
                ")"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(import_dsh_client_ui_primitives37.IconChevronDownOutlineMedium, { className: library_default.chevronIcon })
            ]
          }
        ),
        items: typeMenuItems,
        selectedIds: Array.from(selectedTypes),
        onSelect: (id) => {
          const next = new Set(selectedTypes);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          change({ ...value, itemTypes: Array.from(next) });
        },
        onClose: () => setTypeMenuOpen(false),
        portal: true,
        align: "start"
      }
    ),
    Array.from(selectedTypes).map((typeVal) => {
      const label = types.find((item) => item.value === typeVal)?.label ?? typeVal;
      return /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)(import_dsh_client_ui_primitives37.Tag, { tone: "neutral", className: library_default.filterTagWrap, children: [
        /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("span", { children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(
          "button",
          {
            type: "button",
            className: library_default.tagRemoveButton,
            "aria-label": t("libraryFilterRemove", { label }),
            onClick: () => {
              const next = new Set(selectedTypes);
              next.delete(typeVal);
              change({ ...value, itemTypes: Array.from(next) });
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(import_dsh_client_ui_primitives37.IconCloseOutlineRegular, { size: 11 })
          }
        )
      ] }, typeVal);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(
      LibraryTagPicker,
      {
        t,
        face,
        library,
        value,
        change,
        enabled,
        onError: setError
      }
    ),
    Array.from(selectedTags).map((tag) => /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)(import_dsh_client_ui_primitives37.Tag, { tone: "neutral", className: library_default.filterTagWrap, children: [
      /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("span", { children: tag }),
      /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(
        "button",
        {
          type: "button",
          className: library_default.tagRemoveButton,
          "aria-label": t("libraryTagRemove", { tag }),
          onClick: () => {
            const next = new Set(selectedTags);
            next.delete(tag);
            change({ ...value, tags: Array.from(next) });
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(import_dsh_client_ui_primitives37.IconCloseOutlineRegular, { size: 11 })
        }
      )
    ] }, tag)),
    selectedTags.size > 1 && /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(import_dsh_client_ui_primitives37.Pill, { onClick: toggleTagMatch, children: value.tagMatch === "any" ? t("libraryTagAny") : t("libraryTagAll") }),
    /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(import_dsh_client_ui_primitives37.Pill, { active: value.hasAttachment !== void 0, onClick: toggleAttachment, children: value.hasAttachment === void 0 ? t("libraryAttachmentFilter") : value.hasAttachment ? t("libraryHasAttachment") : t("libraryNoAttachment") }),
    /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)(
      import_dsh_client_ui_primitives37.Pill,
      {
        active: yearOpen || value.yearFrom !== void 0 || value.yearTo !== void 0,
        onClick: openYear,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("span", { children: t("libraryYearLabel") }),
          (value.yearFrom !== void 0 || value.yearTo !== void 0) && /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("span", { children: [
            value.yearFrom ?? "",
            "-",
            value.yearTo ?? ""
          ] })
        ]
      }
    ),
    yearOpen && /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("div", { className: library_default.filterYearRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(
        "input",
        {
          type: "number",
          className: library_default.filterNumberInput,
          placeholder: t("libraryYearFromShort"),
          "aria-label": t("libraryYearFrom"),
          min: ZOTERO_YEAR_MIN,
          max: ZOTERO_YEAR_MAX,
          value: yearDraft.from,
          onChange: (e) => editYear("from", e.target.value),
          onBlur: () => commitYear(yearDraft.from, yearDraft.to),
          onKeyDown: (e) => {
            if (e.key === "Enter") commitYear(yearDraft.from, yearDraft.to);
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("span", { children: "\u2013" }),
      /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(
        "input",
        {
          type: "number",
          className: library_default.filterNumberInput,
          placeholder: t("libraryYearToShort"),
          "aria-label": t("libraryYearTo"),
          min: ZOTERO_YEAR_MIN,
          max: ZOTERO_YEAR_MAX,
          value: yearDraft.to,
          onChange: (e) => editYear("to", e.target.value),
          onBlur: () => commitYear(yearDraft.from, yearDraft.to),
          onKeyDown: (e) => {
            if (e.key === "Enter") commitYear(yearDraft.from, yearDraft.to);
          }
        }
      ),
      yearInvalid && /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("span", { className: library_default.filterYearInvalid, role: "alert", children: t("libraryYearRangeInvalid") })
    ] }),
    hasFilters && /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("button", { type: "button", className: clsx_default(quiet_default.quiet, library_default.filterClear), onClick: clearAll, children: t("libraryClearFilters") }),
    error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime43.jsxs)("div", { className: library_default.filterError, role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime43.jsx)("span", { children: error }),
      /* @__PURE__ */ (0, import_jsx_runtime43.jsx)(import_dsh_client_ui_primitives37.Button, { variant: "outline", size: "sm", onClick: () => setRetry((v) => v + 1), children: t("libraryRetry") })
    ] })
  ] });
}

// src/client/components/library/LibraryWrite.tsx
var import_react32 = require("react");
var import_dsh_client_ui_primitives38 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/library/write-draft.ts
function savedSearchConditionsOf(rows) {
  const trimmed = rows.map((row) => ({
    condition: row.condition.trim(),
    operator: row.operator.trim(),
    value: row.value.trim()
  }));
  const kept = trimmed.filter(
    (row) => row.condition !== "" || row.operator !== "" || row.value !== ""
  );
  if (kept.length === 0) return { kind: "empty" };
  if (kept.some((row) => row.condition === "" || row.operator === "" || row.value === "")) {
    return { kind: "invalid" };
  }
  return { kind: "ok", conditions: kept };
}

// src/client/components/library/LibraryWrite.tsx
var import_jsx_runtime44 = require("react/jsx-runtime");
var FIELDS = {
  updateItem: ["ref", "set"],
  updateTags: ["ref", "add", "remove"],
  updateMembership: ["ref", "add", "remove"],
  createItem: [
    "itemType",
    "title",
    "url",
    "date",
    "doi",
    "publicationTitle",
    "abstractNote",
    "creators",
    "tags",
    "collections"
  ],
  createNote: ["parentItem", "markdown", "tags", "collections", "sourceRefs"],
  updateNote: ["ref", "markdown"],
  createCollection: ["name", "parent"],
  updateCollection: ["collection", "name", "parent"],
  deleteCollection: ["collection"],
  createSavedSearch: ["name", "conditions"],
  updateSavedSearch: ["search", "name", "conditions"],
  deleteSavedSearch: ["search"],
  trash: ["refs"],
  restore: ["refs"],
  batch: ["create", "update", "delete"]
};
var OPERATIONS = Object.keys(FIELDS);
var METADATA = [
  "title",
  "date",
  "url",
  "doi",
  "abstractNote",
  "publicationTitle",
  "extra"
];
var LISTS = /* @__PURE__ */ new Set([
  "add",
  "remove",
  "tags",
  "collections",
  "sourceRefs",
  "refs",
  "delete"
]);
var JSON_FIELDS = /* @__PURE__ */ new Set(["creators", "create", "update"]);
var AFFECTED_LANE = {
  createCollection: "collections",
  updateCollection: "collections",
  deleteCollection: "collections",
  createSavedSearch: "savedSearches",
  updateSavedSearch: "savedSearches",
  deleteSavedSearch: "savedSearches"
};
function LibraryWrite({
  t,
  write,
  sessionId,
  sessionRunning,
  selectedRef,
  collectionRef,
  searchRef,
  refreshAffected
}) {
  const [operation, setOperation] = (0, import_react32.useState)("updateItem");
  const [draft, setDraft] = (0, import_react32.useState)({});
  const [conditions, setConditions] = (0, import_react32.useState)([{ condition: "", operator: "", value: "" }]);
  const [busy, setBusy] = (0, import_react32.useState)(false);
  const [result, setResult] = (0, import_react32.useState)();
  const mounted = (0, import_react32.useRef)(true);
  const inFlight = (0, import_react32.useRef)(false);
  (0, import_react32.useEffect)(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const labels = {
    ref: t("libraryWriteRef"),
    refs: t("libraryWriteRefs"),
    parentItem: t("libraryWriteParentItem"),
    collection: t("libraryWriteCollection"),
    parent: t("libraryWriteParentCollection"),
    search: t("libraryWriteSearch"),
    title: t("libraryWriteTitle"),
    name: t("libraryWriteName"),
    itemType: t("libraryWriteItemType"),
    url: t("libraryMetaUrl"),
    date: t("libraryMetaDate"),
    doi: t("libraryMetaDoi"),
    publicationTitle: t("libraryMetaVenue"),
    abstractNote: t("libraryMetaAbstract"),
    extra: t("libraryMetaExtra"),
    markdown: t("libraryWriteMarkdown"),
    tags: t("libraryMetaTags"),
    collections: t("libraryMetaCollections"),
    sourceRefs: t("libraryWriteSources"),
    add: t("libraryWriteAdd"),
    remove: t("libraryWriteRemove"),
    set: t("libraryWriteMetadata"),
    conditions: t("librarySearchConditions"),
    creators: t("libraryWriteCreators"),
    create: t("libraryWriteBatchCreate"),
    update: t("libraryWriteBatchUpdate"),
    delete: t("libraryWriteTrashRefs")
  };
  const operationLabels = {
    updateItem: t("libraryWriteUpdateItem"),
    updateTags: t("libraryWriteTags"),
    updateMembership: t("libraryWriteMembership"),
    createItem: t("libraryWriteCreateItem"),
    createNote: t("libraryWriteCreateNote"),
    updateNote: t("libraryWriteUpdateNote"),
    createCollection: t("libraryWriteCreateCollection"),
    updateCollection: t("libraryWriteUpdateCollection"),
    deleteCollection: t("libraryWriteDeleteCollection"),
    createSavedSearch: t("libraryWriteCreateSearch"),
    updateSavedSearch: t("libraryWriteUpdateSearch"),
    deleteSavedSearch: t("libraryWriteDeleteSearch"),
    trash: t("libraryWriteTrash"),
    restore: t("libraryWriteRestore"),
    batch: t("libraryWriteBatch")
  };
  const initial = (field2) => field2 === "ref" || field2 === "parentItem" || field2 === "refs" ? selectedRef ?? "" : field2 === "collection" ? collectionRef ?? "" : field2 === "search" ? searchRef ?? "" : "";
  const value = (field2) => draft[field2] ?? initial(field2);
  const change = (field2, text) => setDraft((previous) => ({ ...previous, [field2]: text }));
  const submit = async (event) => {
    event.preventDefault();
    if (!sessionRunning || inFlight.current) return;
    setResult(void 0);
    let request;
    try {
      const args = {};
      for (const field2 of FIELDS[operation]) {
        if (field2 === "set") {
          args.set = Object.fromEntries(
            METADATA.filter((key) => value(key) !== "").map((key) => [key, value(key)])
          );
          continue;
        }
        if (field2 === "conditions") {
          const draftConditions = savedSearchConditionsOf(conditions);
          if (draftConditions.kind === "invalid") {
            setResult({ kind: "failed", message: t("libraryWriteConditionIncomplete") });
            return;
          }
          if (operation === "createSavedSearch" && draftConditions.kind === "empty") {
            setResult({ kind: "failed", message: t("libraryWriteConditionsRequired") });
            return;
          }
          if (draftConditions.kind === "ok") args.conditions = draftConditions.conditions;
          continue;
        }
        const text = value(field2);
        if (text === "") continue;
        args[field2] = LISTS.has(field2) ? text.split("\n").map((line) => line.trim()).filter(Boolean) : JSON_FIELDS.has(field2) ? JSON.parse(text) : text;
      }
      request = zoteroLibraryWriteRequestSchema.parse({ sessionId, operation, args });
    } catch {
      setResult({ kind: "failed", message: t("libraryWriteInvalid") });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const answer = await write(request);
      const result2 = answer.ok ? answer.value : { kind: "failed", message: answer.error.message };
      if (result2.kind === "applied" || result2.kind === "committed-unverified")
        refreshAffected(AFFECTED_LANE[operation] ?? "items");
      if (!mounted.current) return;
      setResult(result2);
    } catch (error) {
      if (mounted.current)
        setResult({
          kind: "failed",
          message: messageOf(error)
        });
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("details", { className: library_default.writeCard, children: [
    /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("summary", { children: t("libraryWriteActions") }),
    /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("p", { className: library_default.listNote, children: t("libraryWriteApprovalHint") }),
    !sessionRunning && /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("p", { className: library_default.listNote, role: "status", children: t("libraryWriteNeedsSession") }),
    /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("form", { className: library_default.writeForm, onSubmit: (event) => void submit(event), children: /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("fieldset", { disabled: busy || !sessionRunning, className: library_default.writeForm, children: [
      /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("label", { className: library_default.writeField, children: [
        /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("span", { className: library_default.caption, children: t("libraryWriteSession") }),
        /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("input", { className: library_default.writeInput, value: sessionId, readOnly: true, "aria-readonly": "true" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("label", { className: library_default.writeField, children: [
        /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("span", { className: library_default.caption, children: t("libraryWriteOperation") }),
        /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(
          "select",
          {
            className: library_default.writeSelect,
            value: operation,
            onChange: (event) => {
              setOperation(event.target.value);
              setDraft({});
              setResult(void 0);
              setConditions([{ condition: "", operator: "", value: "" }]);
            },
            children: OPERATIONS.map((name) => /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("option", { value: name, children: operationLabels[name] }, name))
          }
        )
      ] }),
      FIELDS[operation].flatMap((field2) => field2 === "set" ? METADATA : [field2]).map(
        (field2) => field2 === "conditions" ? /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("fieldset", { className: library_default.writeField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("legend", { className: library_default.caption, children: labels.conditions }),
          conditions.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("div", { className: library_default.writeConditionRow, children: [
            ["condition", "operator", "value"].map((part) => /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("label", { className: clsx_default(library_default.writeField, library_default.writeConditionField), children: [
              /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("span", { className: library_default.caption, children: part === "condition" ? t("libraryWriteCondition") : part === "operator" ? t("libraryWriteOperator") : t("libraryWriteValue") }),
              /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(
                "input",
                {
                  className: library_default.writeInput,
                  value: row[part],
                  onChange: (event) => setConditions(
                    (rows) => rows.map(
                      (entry, i) => i === index ? { ...entry, [part]: event.target.value } : entry
                    )
                  )
                }
              )
            ] }, part)),
            /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(
              import_dsh_client_ui_primitives38.Button,
              {
                variant: "outline",
                size: "sm",
                disabled: conditions.length === 1,
                onClick: () => setConditions((rows) => rows.filter((_, i) => i !== index)),
                children: t("libraryWriteRemoveCondition")
              }
            )
          ] }, index)),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(
            import_dsh_client_ui_primitives38.Button,
            {
              variant: "outline",
              size: "sm",
              onClick: () => setConditions((rows) => [...rows, { condition: "", operator: "", value: "" }]),
              children: t("libraryWriteAddCondition")
            }
          )
        ] }, field2) : /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("label", { className: library_default.writeField, children: [
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("span", { className: library_default.caption, children: labels[field2] }),
          LISTS.has(field2) && /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("small", { className: library_default.listNote, children: t("libraryWriteOnePerLine") }),
          JSON_FIELDS.has(field2) && /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("small", { className: library_default.listNote, children: t("libraryWriteJsonHint") }),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(
            "textarea",
            {
              className: library_default.writeTextarea,
              value: value(field2),
              onChange: (event) => change(field2, event.target.value),
              rows: field2 === "markdown" ? 6 : 2
            }
          )
        ] }, field2)
      ),
      /* @__PURE__ */ (0, import_jsx_runtime44.jsx)(
        import_dsh_client_ui_primitives38.Button,
        {
          type: "submit",
          variant: "primary",
          size: "sm",
          className: library_default.writeSubmitButton,
          disabled: busy,
          children: busy ? t("libraryWritePending") : t("libraryWriteReview")
        }
      )
    ] }) }),
    result !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)(
      "div",
      {
        className: clsx_default(library_default.writeResult, result.kind === "failed" && library_default.writeResultFailed),
        role: result.kind === "failed" ? "alert" : "status",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime44.jsx)("strong", { children: result.kind === "declined" ? t("libraryWriteDeclined") : result.kind === "committed-unverified" ? t("libraryWriteUnverified") : result.kind === "failed" ? t("libraryWriteFailed") : t("libraryWriteApplied") }),
          /* @__PURE__ */ (0, import_jsx_runtime44.jsxs)("pre", { children: [
            result.code,
            result.code ? "\n" : "",
            result.message
          ] })
        ]
      }
    )
  ] });
}

// src/client/components/library/ZoteroLibraryPanel.tsx
var import_jsx_runtime45 = require("react/jsx-runtime");
function ZoteroLibraryPanel(props) {
  const { t } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(ZoteroSurfaceBoundary, { t, surface: "library", children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(ZoteroLibraryPanelBody, { ...props }) });
}
var SORT_OPTIONS = LIBRARY_SORTS.flatMap(
  (sort) => ["desc", "asc"].map((direction) => ({ sort, direction }))
);
var SORT_LABELS = {
  dateModified: "librarySortDateModified",
  dateAdded: "librarySortDateAdded",
  date: "librarySortDate",
  title: "librarySortTitle",
  creator: "librarySortCreator"
};
function sortValueOf(sort, direction) {
  return `${sort}:${direction}`;
}
var SORT_BY_VALUE = new Map(
  SORT_OPTIONS.map((option) => [sortValueOf(option.sort, option.direction), option])
);
function ZoteroLibraryPanelBody(props) {
  const { t } = props;
  const [diagMenuOpen, setDiagMenuOpen] = (0, import_react33.useState)(false);
  const sessionKey = props.sessionId;
  const initialView = readLibrarySessionMemory(sessionKey);
  const {
    state: probeState,
    settled,
    runProbe
  } = useZoteroProbe(props.status, {
    initialAutoRun: true,
    initialData: initialView?.lastProbeData
  });
  const face = (0, import_react33.useMemo)(
    () => ({
      collectionPath: props.collectionPath,
      browse: props.browse,
      search: props.search,
      item: props.item,
      childPage: props.childPage,
      invalidate: props.invalidate,
      setInstance: props.setInstance
    }),
    [
      props.collectionPath,
      props.browse,
      props.search,
      props.item,
      props.childPage,
      props.invalidate,
      props.setInstance
    ]
  );
  const connected = probeState.data?.connected === true;
  const confirmed = settled && connected;
  const inputActions = props.inputActions;
  const feed = useLibraryFeed(
    face,
    confirmed ? probeState.data?.serverId : void 0,
    confirmed,
    props.sessionId
  );
  (0, import_react33.useEffect)(() => {
    const inspector = feed.inspector?.phase === "ready" ? feed.inspector : void 0;
    if (inspector === void 0 && probeState.data === void 0) {
      clearLibrarySessionMemory(props.sessionId);
      return;
    }
    writeLibrarySessionView(props.sessionId, { inspector, lastProbeData: probeState.data });
  }, [feed.inspector, probeState.data, props.sessionId]);
  (0, import_react33.useEffect)(() => {
    if (feed.refreshToken > 0) void runProbe();
  }, [feed.refreshToken, runProbe]);
  const sessionRunning = props.useSession((snapshot) => snapshot.running && !snapshot.removed);
  const sessionRemoved = props.useSession((snapshot) => snapshot.removed);
  (0, import_react33.useEffect)(() => {
    if (sessionRemoved) clearLibrarySessionMemory(props.sessionId);
  }, [sessionRemoved, props.sessionId]);
  const cwd = props.useSessions((snapshot) => snapshot.byId[props.sessionId]?.cwd);
  const openFile = (path) => {
    try {
      props.openResource(fileAddressFor(props.sessionId, cwd, path));
    } catch (error) {
      if (error instanceof Error && error.message.includes("no session surface is mounted")) {
        throw new Error(t("libraryNoSessionForOpen"));
      }
      throw error;
    }
  };
  const tabInfo = props.useTabInfo?.();
  (0, import_react33.useEffect)(() => {
    if (!tabInfo?.tab || sessionRemoved) return;
    return props.bindRefresh?.(props.sessionId, tabInfo.tab.id, feed.refresh);
  }, [props.bindRefresh, props.sessionId, tabInfo?.tab?.id, feed.refresh, sessionRemoved]);
  (0, import_react33.useEffect)(() => {
    if (!tabInfo?.tab?.actions?.bindCommands) return;
    return tabInfo.tab.actions.bindCommands({
      refresh: () => {
        feed.refresh();
      }
    });
  }, [tabInfo?.tab?.actions, feed]);
  const handleSelectScope = (selection2) => {
    feed.selectScope(selection2);
  };
  const handleSelectItem = (ref) => {
    feed.selectItem(ref);
  };
  const diagnosticMenuItems = (0, import_react33.useMemo)(() => {
    const data = probeState.data;
    const items = [];
    if (data?.serverId !== void 0) {
      items.push({ id: "server", label: `${t("serverIdLabel")} ${data.serverId}`, disabled: true });
    }
    if (data?.zoteroVersion !== void 0) {
      items.push({
        id: "zoteroVer",
        label: `${t("zoteroVersionLabel")} ${data.zoteroVersion}`,
        disabled: true
      });
    }
    if (data?.apiVersion !== void 0) {
      items.push({
        id: "apiVer",
        label: `${t("apiVersionLabel")} ${data.apiVersion}`,
        disabled: true
      });
    }
    if (data?.write !== void 0) {
      items.push({
        id: "write",
        label: `${t("writeLabel")} ${writeStatusLabel(data.write, t)}`,
        disabled: true
      });
    }
    return items;
  }, [probeState.data, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("div", { className: library_default.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("header", { className: library_default.toolbar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("div", { className: library_default.librarySelectWrap, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
        LibrarySelect,
        {
          t,
          state: feed.libraries,
          current: feed.currentLibrary,
          onSelect: feed.selectLibrary
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
        import_dsh_client_ui_primitives39.Input,
        {
          className: library_default.searchInputWrap,
          icon: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.IconSearchOutlineMedium, { size: 14, className: library_default.searchIcon }),
          type: "search",
          placeholder: t("librarySearchPlaceholder"),
          value: feed.q,
          onChange: (event) => feed.setQ(event.target.value),
          "aria-label": t("librarySearchPlaceholder")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("div", { className: library_default.searchModeWrap, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
        import_dsh_client_ui_primitives39.SegmentedControl,
        {
          id: "zotero-search-mode",
          label: t("librarySearchModeLabel"),
          value: feed.mode,
          onChange: feed.setMode,
          options: [
            { value: "metadata", label: t("librarySearchModeMetadata") },
            { value: "everything", label: t("librarySearchModeEverything") }
          ]
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("div", { className: library_default.sortSelectWrap, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
        SortSelect,
        {
          t,
          sort: feed.sort,
          direction: feed.direction,
          onSelect: (sort, direction) => feed.setSort(sort, direction)
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("span", { className: library_default.spacer }),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("div", { className: library_default.statusGroup, children: [
        /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.StateDot, { state: probeState.loading ? "ongoing" : connected ? "done" : "error" }),
        /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
          "span",
          {
            className: library_default.statusText,
            role: "status",
            title: connected ? void 0 : probeState.error ?? probeState.data?.diagnosis,
            children: probeState.loading || probeState.data === void 0 && probeState.error === void 0 ? t("libraryLoading") : connected ? t("libraryConnected") : t("libraryOffline")
          }
        )
      ] }),
      diagnosticMenuItems.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("div", { className: library_default.diagnosticsWrap, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
        import_dsh_client_ui_primitives39.Menu,
        {
          open: diagMenuOpen,
          anchor: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.Tooltip, { label: t("detailsLabel"), side: "bottom", delayMs: 500, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
            "button",
            {
              type: "button",
              className: library_default.toolButton,
              "aria-label": t("detailsLabel"),
              onClick: () => setDiagMenuOpen(!diagMenuOpen),
              children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.IconEllipsisOutlineMedium, { className: library_default.actionIcon })
            }
          ) }),
          items: diagnosticMenuItems,
          onClose: () => setDiagMenuOpen(false),
          align: "end",
          portal: true
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("div", { className: library_default.refreshWrap, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.Tooltip, { label: t("refresh"), side: "bottom", delayMs: 500, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
        "button",
        {
          type: "button",
          className: library_default.toolButton,
          onClick: () => feed.refresh(),
          "aria-label": t("refresh"),
          children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.IconRefreshOutlineMedium, { className: library_default.actionIcon })
        }
      ) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("div", { className: library_default.toolbarBreak, "aria-hidden": "true" })
    ] }),
    settled && !connected && (probeState.data !== void 0 || probeState.error !== void 0) ? /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("div", { className: library_default.offline, role: "note", children: [
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("p", { className: library_default.offlineText, children: t("libraryOfflineNote") }),
      (probeState.error ?? probeState.data?.diagnosis) !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("p", { className: library_default.offlineDetail, children: probeState.error ?? probeState.data?.diagnosis })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)(import_jsx_runtime45.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("div", { className: library_default.narrowNavWrap, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
        import_dsh_client_ui_primitives39.SegmentedControl,
        {
          id: "zotero-library-narrow-nav",
          label: t("tabLibrary"),
          value: feed.narrowPane,
          onChange: feed.setNarrowPane,
          options: [
            { value: "tree", label: t("libraryNavTree") },
            { value: "list", label: t("libraryNavList") },
            { value: "inspector", label: t("libraryNavInspector") }
          ]
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("div", { className: library_default.columns, children: [
        /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
          "div",
          {
            className: clsx_default(
              library_default.columnPane,
              library_default.treePane,
              feed.narrowPane !== "tree" && library_default.columnPaneHidden
            ),
            children: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
              LibraryTree,
              {
                t,
                locatedRef: feed.locatedRef,
                flatTree: feed.flatTree,
                expanded: feed.expanded,
                identityOf: feed.identityOf,
                toggleCollection: feed.toggleCollection,
                selection: feed.selection,
                selectScope: handleSelectScope,
                savedSearches: feed.savedSearches,
                rootLane: feed.treeLane(void 0),
                treeLane: feed.treeLane,
                loadMoreTree: feed.loadMoreTree,
                retryTree: feed.retryTree,
                loadMoreSavedSearches: feed.loadMoreSavedSearches,
                retrySavedSearches: feed.retrySavedSearches
              }
            )
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)(
          "div",
          {
            className: clsx_default(
              library_default.columnPane,
              library_default.listPane,
              feed.narrowPane !== "list" && library_default.columnPaneHidden
            ),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
                LibraryFilters,
                {
                  t,
                  face,
                  library: feed.currentLibrary,
                  value: feed.filters,
                  change: feed.setFilters,
                  enabled: connected
                },
                feed.scopeKey
              ),
              feed.mode === "everything" && /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)("div", { className: clsx_default(library_default.caption, library_default.everywhereHint), children: [
                /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.IconSearchOutlineMedium, { className: library_default.hintIcon }),
                /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("span", { children: t("libraryEverythingHint") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
                LibraryItemList,
                {
                  returnToLibrary: () => feed.selectScope({ kind: "library" }),
                  filtered: feed.q !== "" || Object.values(feed.filters).some(
                    (value) => Array.isArray(value) ? value.length > 0 : value !== void 0
                  ),
                  locate: "ref" in feed.selection ? feed.locate : void 0,
                  locateError: feed.locateError,
                  t,
                  list: feed.list,
                  selection: feed.selection,
                  offset: feed.offset,
                  gotoOffset: feed.gotoOffset,
                  selectedRef: feed.selectedRef,
                  selectItem: handleSelectItem,
                  retry: feed.retryList
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)(
          "div",
          {
            className: clsx_default(
              library_default.columnPane,
              library_default.inspectorPane,
              feed.narrowPane !== "inspector" && library_default.columnPaneHidden
            ),
            children: [
              probeState.data?.write?.enabled === true && feed.currentLibrary.type === "user" && /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
                LibraryWrite,
                {
                  t,
                  write: props.write,
                  sessionId: props.sessionId,
                  sessionRunning,
                  selectedRef: feed.selectedRef,
                  collectionRef: feed.selection.kind === "collection" ? feed.selection.ref : void 0,
                  searchRef: feed.selection.kind === "savedSearch" ? feed.selection.ref : void 0,
                  refreshAffected: feed.refreshAffected
                },
                JSON.stringify([feed.scopeKey, feed.selectedRef ?? null])
              ),
              /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
                LibraryInspector,
                {
                  t,
                  inspector: feed.inspector,
                  inputActions,
                  retry: feed.retryInspector,
                  pageChild: feed.pageChild,
                  childStates: feed.childStates,
                  retryChild: feed.retryChild,
                  openFile,
                  resolveAttachment: props.resolveAttachment,
                  exportItem: props.export
                }
              )
            ]
          }
        )
      ] })
    ] })
  ] });
}
function LibrarySelect({
  t,
  state,
  current,
  onSelect
}) {
  const [open, setOpen] = (0, import_react33.useState)(false);
  if (state.phase === "loading") {
    return /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("span", { className: library_default.statusText, children: t("libraryLoading") });
  }
  if (state.phase === "error") {
    return /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("span", { className: library_default.statusText, children: state.message });
  }
  const currentKey = libraryKeyOf(current);
  const currentName = state.options.find((option) => libraryKeyOf(option.library) === currentKey)?.name ?? currentKey;
  const items = state.options.map((option) => ({
    id: libraryKeyOf(option.library),
    label: option.name
  }));
  return /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
    import_dsh_client_ui_primitives39.Menu,
    {
      open,
      portal: true,
      dense: true,
      align: "start",
      onClose: () => setOpen(false),
      anchor: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.Tooltip, { label: `${t("librarySelectLibrary")}: ${currentName}`, side: "bottom", delayMs: 500, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)(
        "button",
        {
          type: "button",
          className: library_default.selectorButton,
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-label": t("librarySelectLibrary"),
          title: currentName,
          onClick: () => setOpen((prev) => !prev),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("span", { className: library_default.selectorLabel, children: currentName }),
            /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.IconChevronDownOutlineRegular, { size: 12, className: library_default.dropdownChevron })
          ]
        }
      ) }),
      items,
      selectedId: currentKey,
      onSelect: (id) => {
        const match = state.options.find((option) => libraryKeyOf(option.library) === id);
        if (match !== void 0) onSelect(match.library);
        setOpen(false);
      }
    }
  );
}
function SortSelect({
  t,
  sort,
  direction,
  onSelect
}) {
  const [open, setOpen] = (0, import_react33.useState)(false);
  const currentValue = sortValueOf(sort, direction);
  const currentLabel = `${t(SORT_LABELS[sort])} \xB7 ${direction === "asc" ? t("librarySortAsc") : t("librarySortDesc")}`;
  const items = SORT_OPTIONS.map((option) => {
    const val = sortValueOf(option.sort, option.direction);
    const label = `${t(SORT_LABELS[option.sort])} \xB7 ${option.direction === "asc" ? t("librarySortAsc") : t("librarySortDesc")}`;
    return {
      id: val,
      label
    };
  });
  return /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(
    import_dsh_client_ui_primitives39.Menu,
    {
      open,
      portal: true,
      dense: true,
      align: "start",
      onClose: () => setOpen(false),
      anchor: /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.Tooltip, { label: `${t("librarySortLabel")}: ${currentLabel}`, side: "bottom", delayMs: 500, children: /* @__PURE__ */ (0, import_jsx_runtime45.jsxs)(
        "button",
        {
          type: "button",
          className: library_default.selectorButton,
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-label": t("librarySortLabel"),
          title: currentLabel,
          onClick: () => setOpen((prev) => !prev),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime45.jsx)(import_dsh_client_ui_primitives39.IconChevronsUpDownOutlineMedium, { size: 14, className: library_default.sortIcon }),
            /* @__PURE__ */ (0, import_jsx_runtime45.jsx)("span", { className: library_default.sortLabel, children: currentLabel })
          ]
        }
      ) }),
      items,
      selectedId: currentValue,
      onSelect: (id) => {
        const option = SORT_BY_VALUE.get(id);
        if (option !== void 0) onSelect(option.sort, option.direction);
        setOpen(false);
      }
    }
  );
}

// src/client/components/library/library-data-plane.ts
var TTL_MS = {
  browse: 3e4,
  collectionPath: 0,
  item: 1e4,
  export: 1e4,
  search: 2e3,
  childPage: 2e3
};
var MAX_SETTLED_ENTRIES = 128;
function createLibraryDataPlane(face) {
  let generation = 0;
  let instance;
  const inflight = /* @__PURE__ */ new Map();
  const settled = /* @__PURE__ */ new Map();
  const pruneExpired = (now) => {
    for (const [key, entry] of settled) {
      if (now - entry.at >= entry.ttlMs) settled.delete(key);
    }
  };
  const call = (method, request, send) => {
    const requestGeneration = generation;
    const key = `${instance ?? ""}:${requestGeneration}:${method}:${JSON.stringify(request)}`;
    const now = Date.now();
    pruneExpired(now);
    const cached = settled.get(key);
    if (cached !== void 0 && now - cached.at < cached.ttlMs) {
      return Promise.resolve(cached.result);
    }
    const running = inflight.get(key);
    if (running !== void 0) return running;
    const task = send().then(
      (result) => {
        inflight.delete(key);
        if (result.ok && requestGeneration === generation && TTL_MS[method] > 0) {
          const at = Date.now();
          pruneExpired(at);
          settled.set(key, { at, ttlMs: TTL_MS[method], result });
          while (settled.size > MAX_SETTLED_ENTRIES) {
            const oldest = settled.keys().next().value;
            if (oldest === void 0) break;
            settled.delete(oldest);
          }
        }
        return result;
      },
      (cause) => {
        inflight.delete(key);
        throw cause;
      }
    );
    inflight.set(key, task);
    return task;
  };
  return {
    collectionPath: (request) => call("collectionPath", request, () => face.collectionPath(request)),
    browse: (request) => call("browse", request, () => face.browse(request)),
    search: (request) => {
      const query = { ...request, cacheGeneration: generation };
      return call("search", query, () => face.search(query));
    },
    item: (request) => call("item", request, () => face.item(request)),
    childPage: (request) => call("childPage", request, () => face.childPage(request)),
    export: (request) => call("export", request, () => face.export(request)),
    invalidate: () => {
      generation += 1;
      settled.clear();
    },
    setInstance: (serverId) => {
      if (serverId === instance) return;
      instance = serverId;
      generation += 1;
      settled.clear();
    }
  };
}

// src/client/components/library/ZoteroLibraryIcon.tsx
var import_jsx_runtime46 = require("react/jsx-runtime");
function ZoteroLibraryIcon({ size, className }) {
  const edge = size ?? 36;
  return /* @__PURE__ */ (0, import_jsx_runtime46.jsxs)("svg", { width: edge, height: edge, viewBox: "0 0 36 36", className, "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(
      "path",
      {
        d: "M9 10V8.5A2.5 2.5 0 0 1 11.5 6H28a2.5 2.5 0 0 1 2.5 2.5v19A2.5 2.5 0 0 1 28 30H11.5A2.5 2.5 0 0 1 9 27.5V10Z",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.5",
        opacity: "0.45"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(
      "path",
      {
        d: "M12 9.5A2.5 2.5 0 0 1 14.5 7H28a2.5 2.5 0 0 1 2.5 2.5v17A2.5 2.5 0 0 1 28 29H14.5a2.5 2.5 0 0 1-2.5-2.5z",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.5"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime46.jsx)(
      "path",
      {
        d: "M16 12h10M16 16h8M16 20h6",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round"
      }
    )
  ] });
}

// src/client/web-enabled.ts
function webEnabledOf(form) {
  const snapshot = form.getSnapshot();
  return snapshot.status !== "ready" || snapshot.value?.webEnabled !== false;
}
function watchWebEnabled(form, onChange) {
  const sync = () => onChange(webEnabledOf(form));
  const unsubscribe = form.subscribe(sync);
  sync();
  return unsubscribe;
}
function gatedMount(mount) {
  let dispose;
  return {
    sync(enabled) {
      if (enabled && dispose === void 0) {
        dispose = mount();
      } else if (!enabled && dispose !== void 0) {
        dispose();
        dispose = void 0;
      }
    },
    dispose() {
      dispose?.();
      dispose = void 0;
    }
  };
}
function registerGatedSurfaces(ctx, fiber, watch, mount) {
  const gate = gatedMount(mount);
  ctx.effect(() => {
    const unsubscribe = watch(gate.sync);
    return () => {
      unsubscribe();
      gate.dispose();
    };
  }, fiber);
}

// src/client/toolviews/ZoteroCardBoundary.tsx
var import_react34 = require("react");
var import_jsx_runtime47 = require("react/jsx-runtime");
var ZoteroCardBoundary = class extends import_react34.Component {
  state = { message: null };
  static getDerivedStateFromError(error) {
    return { message: messageOf(error) };
  }
  componentDidCatch(error, info) {
    console.error("dsh-zotero: tool card failed to render:", messageOf(error), info);
    reportCrashedSurface(`tool:${this.props.props.toolName}`, error, {
      kind: "componentStack",
      componentStack: info.componentStack
    });
  }
  render() {
    const { message } = this.state;
    if (message === null) return this.props.children;
    const { props } = this.props;
    return /* @__PURE__ */ (0, import_jsx_runtime47.jsxs)("div", { "data-zotero-card-error": true, className: cards_default.cardError, children: [
      /* @__PURE__ */ (0, import_jsx_runtime47.jsxs)("p", { className: cards_default.cardErrorTitle, children: [
        props.toolName,
        " \xB7 ",
        props.t("renderFailed")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime47.jsx)("p", { className: cards_default.cardErrorDetail, children: message })
    ] });
  }
};
function withCardBoundary(Wrapped) {
  function GuardedToolView(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime47.jsx)(ZoteroCardBoundary, { props, children: /* @__PURE__ */ (0, import_jsx_runtime47.jsx)(Wrapped, { ...props }) });
  }
  GuardedToolView.displayName = `Guarded(${Wrapped.displayName || Wrapped.name || "ToolView"})`;
  return GuardedToolView;
}

// src/client/toolviews/SearchToolView.tsx
var import_react36 = require("react");
var import_dsh_client_ui_primitives41 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/toolviews/ZoteroToolRow.tsx
var import_react35 = require("react");
var import_dsh_client_ui_primitives40 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/sources/write-decoder.ts
var WRITE_KINDS = ["declined", "applied", "deleted", "committed-unverified", "restored"];
function writeKindOf(value) {
  return WRITE_KINDS.find((kind) => kind === value) ?? "applied";
}
function writeMetaOf(meta) {
  return {
    kind: writeKindOf(meta["kind"]),
    restoredCount: numberField(meta, "restoredCount") ?? null,
    failedCount: numberField(meta, "failedCount") ?? null,
    addedCount: numberField(meta, "addedCount") ?? null,
    removedCount: numberField(meta, "removedCount") ?? null,
    deletedCount: numberField(meta, "deletedCount") ?? null
  };
}

// src/client/toolviews/toolviews.module.css
var style13 = `.OO2ABG_bodyWrap{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);flex-direction:column;gap:8px;padding:8px 12px 12px 28px;display:flex}.OO2ABG_summarySep{border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-label-caption);flex:none;width:2px;height:2px;margin:0 8px}.OO2ABG_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);transition:color .12s var(--ds-ease-in-out);flex:auto;overflow:hidden}.OO2ABG_summary>span,.OO2ABG_summary [data-text-shimmer]{text-overflow:ellipsis;white-space:nowrap;font-weight:400;display:inline;overflow:hidden}.OO2ABG_summarySuffix{white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);transition:color .12s var(--ds-ease-in-out);flex:none;margin-left:6px}@media (hover:hover){div[data-tool]:hover .OO2ABG_summary:not(.OO2ABG_errorSummary):not(.OO2ABG_cautionSummary),div[data-tool]:hover .OO2ABG_summarySuffix{color:var(--dsw-alias-label-primary)}}.OO2ABG_errorSummary{color:var(--dsw-alias-state-error-primary)}.OO2ABG_cautionSummary{color:var(--dsw-alias-state-warn-label)}.OO2ABG_inspectButton{align-self:flex-start}.OO2ABG_actionLink{height:22px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-link);cursor:pointer;transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;align-items:center;gap:4px;padding:0 4px;font-weight:500;text-decoration:none;display:inline-flex}@media (hover:hover){.OO2ABG_actionLink:hover{text-underline-offset:3px;opacity:.85;text-decoration:underline dotted}}.OO2ABG_badge{box-sizing:border-box;height:18px;font:var(--dsw-font-xxxs-11);text-transform:uppercase;letter-spacing:.03em;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);user-select:none;align-items:center;gap:4px;padding:0 6px;font-weight:600;display:inline-flex}.OO2ABG_badge[data-tone=info]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-link);border-color:#0000}.OO2ABG_badge[data-tone=success]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary);border-width:1px;border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 20%, transparent)}.OO2ABG_badge[data-tone=warning]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);color:var(--dsw-alias-state-warn-label);border-width:1px;border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 20%, transparent)}.OO2ABG_badge[data-tone=danger],.OO2ABG_badge[data-tone=error],.OO2ABG_badge[data-tone=pdf]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);color:var(--dsw-alias-state-error-primary);border-width:1px;border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 20%, transparent)}.OO2ABG_cardList{flex-direction:column;gap:6px;display:flex}.OO2ABG_itemCard{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);transition:border-color .12s var(--ds-ease-in-out);flex-direction:column;gap:6px;padding:10px 12px;display:flex}@media (hover:hover){.OO2ABG_itemCard:hover{border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}}.OO2ABG_itemHeader{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.OO2ABG_itemTitle{color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);font-weight:500}.OO2ABG_itemMeta{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);align-items:center;gap:6px;display:flex}.OO2ABG_itemCard[data-depth="1"]{margin-left:10px}.OO2ABG_itemCard[data-depth="2"]{margin-left:20px}.OO2ABG_itemCard[data-depth="3"]{margin-left:30px}.OO2ABG_itemCard[data-depth="4"]{margin-left:40px}.OO2ABG_itemActions{align-items:center;gap:8px;margin-top:2px;display:flex}.OO2ABG_evidenceItem{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);transition:border-color .12s var(--ds-ease-in-out);flex-direction:column;gap:6px;padding:10px 12px;display:flex}@media (hover:hover){.OO2ABG_evidenceItem:hover{border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}}.OO2ABG_evidenceHeader{justify-content:space-between;align-items:center;gap:8px;display:flex}.OO2ABG_evidenceBadges{align-items:center;gap:6px;display:flex}.OO2ABG_evidenceText{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;padding-top:2px}.OO2ABG_codeWrap{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);flex-direction:column;display:flex;overflow:hidden}.OO2ABG_codeHeader{background:var(--dsw-alias-bg-layer-1);border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;min-height:28px;padding:6px 10px;display:flex}.OO2ABG_codeBox{font:var(--dsw-font-markdown-code-block);color:var(--dsw-alias-label-secondary);white-space:pre;max-height:360px;margin:0;padding:10px 12px;overflow-x:auto}.OO2ABG_receiptCard{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:6px;padding:10px 12px;display:flex}.OO2ABG_receiptCard[data-state=declined],.OO2ABG_receiptCard[data-state=unverified]{border-width:1px;border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 5%, transparent)}.OO2ABG_receiptTitle{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);font-weight:500}.OO2ABG_notesSection{border-top:1px dashed var(--dsw-alias-border-l2);flex-direction:column;gap:4px;margin-top:4px;padding-top:6px;display:flex}.OO2ABG_sectionTitle{font:var(--dsw-font-xxxs-11);text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-caption);font-weight:600}.OO2ABG_annotationSwatch{border-radius:var(--dsw-radius-xs);background:var(--zotero-annotation,transparent);width:10px;height:10px;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);flex:none}.OO2ABG_tagPills{flex-wrap:wrap;gap:4px;display:flex}.OO2ABG_coverageNotice{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:6px;padding:4px 8px;display:flex}@media (prefers-reduced-motion:reduce){.OO2ABG_summary,.OO2ABG_summarySuffix,.OO2ABG_actionLink,.OO2ABG_itemCard,.OO2ABG_evidenceItem{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/toolviews/toolviews.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/toolviews/toolviews.module.css");
  tag.textContent = style13;
  document.head.appendChild(tag);
}
var toolviews_default = { "itemHeader": "OO2ABG_itemHeader", "inspectButton": "OO2ABG_inspectButton", "codeBox": "OO2ABG_codeBox", "receiptTitle": "OO2ABG_receiptTitle", "bodyWrap": "OO2ABG_bodyWrap", "summary": "OO2ABG_summary", "cautionSummary": "OO2ABG_cautionSummary", "receiptCard": "OO2ABG_receiptCard", "coverageNotice": "OO2ABG_coverageNotice", "sectionTitle": "OO2ABG_sectionTitle", "summarySep": "OO2ABG_summarySep", "itemTitle": "OO2ABG_itemTitle", "cardList": "OO2ABG_cardList", "codeWrap": "OO2ABG_codeWrap", "codeHeader": "OO2ABG_codeHeader", "notesSection": "OO2ABG_notesSection", "evidenceBadges": "OO2ABG_evidenceBadges", "summarySuffix": "OO2ABG_summarySuffix", "itemActions": "OO2ABG_itemActions", "badge": "OO2ABG_badge", "evidenceHeader": "OO2ABG_evidenceHeader", "evidenceItem": "OO2ABG_evidenceItem", "itemMeta": "OO2ABG_itemMeta", "evidenceText": "OO2ABG_evidenceText", "actionLink": "OO2ABG_actionLink", "tagPills": "OO2ABG_tagPills", "itemCard": "OO2ABG_itemCard", "annotationSwatch": "OO2ABG_annotationSwatch", "errorSummary": "OO2ABG_errorSummary" };

// src/client/toolviews/ZoteroToolRow.tsx
var import_jsx_runtime48 = require("react/jsx-runtime");
function RunningNotice({ text }) {
  return /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("div", { className: toolviews_default.coverageNotice, children: text });
}
function RawTextFallback({ text }) {
  return /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("pre", { className: toolviews_default.codeBox, children: text });
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
  const isRunning = isToolRunning(block);
  const { expanded, toggle: toggleExpand } = useDisclosure();
  const state = isPreparing ? "preparing" : rowStateOf(block);
  const writeKind = writeMetaOf(metaOf(block) ?? {}).kind;
  const isDeclined = writeKind === "declined";
  const isUnverified = !isDeclined && state === "ok" && writeKind === "committed-unverified";
  const failureLine = state === "error" && !isDeclined ? errorSummary ?? t("toolFailed") : null;
  const stoppedLine = state === "stopped" ? t("toolStopped") : null;
  const cautionLine = isUnverified ? t("toolUnverified") : null;
  const displaySummary = isDeclined ? t("toolDeclined") : failureLine ?? stoppedLine ?? cautionLine ?? summary;
  const collapsedContent = (0, import_react35.useMemo)(() => {
    if (!displaySummary && !isPreparing) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)(import_jsx_runtime48.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("span", { className: toolviews_default.summarySep, "aria-hidden": true }),
      /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(
        "span",
        {
          className: clsx_default(
            toolviews_default.summary,
            state === "error" && !isDeclined && toolviews_default.errorSummary,
            (state === "stopped" || isDeclined || isUnverified) && toolviews_default.cautionSummary
          ),
          children: /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(import_dsh_client_ui_primitives40.TextShimmer, { active: isRunning, children: displaySummary })
        }
      ),
      summarySuffix && (state === "ok" || isDeclined) && /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("span", { className: toolviews_default.summarySuffix, children: summarySuffix })
    ] });
  }, [displaySummary, isDeclined, isUnverified, isPreparing, isRunning, state, summarySuffix]);
  const expandable = !isPreparing && (children !== void 0 || failureLine !== null);
  const open = expanded && expandable;
  const renderContext = (0, import_react35.useMemo)(
    () => ({ isRunning, isDeclined, isUnverified, state }),
    [isRunning, isDeclined, isUnverified, state]
  );
  const content = !open ? null : typeof children === "function" ? children(renderContext) : children;
  const expandedBody = open ? /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)("div", { className: toolviews_default.bodyWrap, children: [
    content,
    inspect !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime48.jsxs)(
      "button",
      {
        type: "button",
        className: clsx_default(quiet_default.quietDense, quiet_default.muted, toolviews_default.inspectButton),
        onClick: (e) => {
          e.stopPropagation();
          inspect();
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(import_dsh_client_ui_primitives40.IconInspectOutlineRegular, { size: 12 }),
          /* @__PURE__ */ (0, import_jsx_runtime48.jsx)("span", { children: t("toolInspect") })
        ]
      }
    )
  ] }) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(
    "div",
    {
      "data-tool": toolName,
      "data-state": isDeclined ? "declined" : isUnverified ? "unverified" : state,
      children: /* @__PURE__ */ (0, import_jsx_runtime48.jsx)(
        import_dsh_client_ui_primitives40.DisclosureRow,
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
var import_jsx_runtime49 = require("react/jsx-runtime");
function SearchToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const { icon, query, summary, errorSummary, rows, omitted, detailOmitted, rawText } = (0, import_react36.useMemo)(() => {
    const args = argsViewOf(block);
    const q = (textArg(args, "query") ?? "").trim();
    const meta = metaOf(block);
    const searchView = meta !== null ? searchMetaOf(meta) : null;
    const noteMatches = searchView?.noteMatches ?? 0;
    const raw = (resultTextOf(block) ?? "").trim();
    let sum = "";
    if (isToolRunning(block)) {
      sum = q ? `"${q}"` : t("toolSearchRunning");
    } else if (searchView?.rows !== null && searchView?.rows !== void 0) {
      const count = searchView.returned ?? searchView.rows.length;
      sum = noteMatches > 0 ? t("toolSummaryFoundWithNotes", { count, notes: noteMatches }) : t("toolSummaryFound", { count });
    } else {
      sum = q ? `"${q}"` : t("toolTitleSearch");
    }
    const errSummary = errorSummaryOf(block, raw);
    return {
      icon: /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(import_dsh_client_ui_primitives41.IconSearchOutlineRegular, { size: 14 }),
      query: q,
      summary: sum,
      errorSummary: errSummary,
      rows: searchView?.rows ?? [],
      omitted: searchView?.omitted ?? 0,
      detailOmitted: searchView?.detailOmitted === true,
      rawText: raw
    };
  }, [block, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(
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
          return /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(RunningNotice, { text: t("toolSearchRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime49.jsxs)(import_jsx_runtime49.Fragment, { children: [
          detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") }),
          rows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime49.jsxs)(import_jsx_runtime49.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("div", { className: toolviews_default.cardList, children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime49.jsxs)("div", { className: toolviews_default.itemCard, children: [
              /* @__PURE__ */ (0, import_jsx_runtime49.jsxs)("div", { className: toolviews_default.itemHeader, children: [
                row.year !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("span", { className: toolviews_default.badge, children: row.year }),
                row.itemType !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("span", { className: toolviews_default.badge, "data-tone": "info", children: row.itemType }),
                row.bestAttachmentType && /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: t("badgePdf") }),
                /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("span", { className: toolviews_default.itemTitle, children: row.title })
              ] }),
              row.creatorSummary && /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("div", { className: toolviews_default.itemMeta, children: row.creatorSummary }),
              /* @__PURE__ */ (0, import_jsx_runtime49.jsxs)("div", { className: toolviews_default.itemActions, children: [
                row.bestAttachmentRef && /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(
                  PdfReadButton,
                  {
                    attachmentRef: row.bestAttachmentRef,
                    onOpenFile: props.openFile,
                    label: t("readPdf"),
                    t,
                    variant: "link",
                    className: toolviews_default.actionLink
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(
                  ZoteroLocateActions,
                  {
                    title: row.title,
                    itemRef: row.ref,
                    t,
                    variant: "link",
                    className: toolviews_default.actionLink
                  }
                )
              ] })
            ] }, row.ref)) }),
            omitted > 0 && /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("div", { className: toolviews_default.coverageNotice, children: t("omittedRowsNote", { count: omitted }) })
          ] }) : rawText ? /* @__PURE__ */ (0, import_jsx_runtime49.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime49.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") })
        ] });
      }
    }
  );
}

// src/client/toolviews/RetrieveToolView.tsx
var import_react37 = require("react");
var import_dsh_client_ui_primitives42 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime50 = require("react/jsx-runtime");
function RetrieveToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const { icon, summary, errorSummary, items, coverageLine, omittedNote, detailOmitted, rawText } = (0, import_react37.useMemo)(() => {
    const raw = (resultTextOf(block) ?? "").trim();
    const errSummary = errorSummaryOf(block, raw);
    const meta = metaOf(block);
    const retrieveView = meta !== null ? retrieveMetaOf(meta) : null;
    let sum = "";
    if (isToolRunning(block)) {
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
    return {
      // The icon rides the memo with the rest of the header, so a re-render
      // that leaves this call's facts alone reuses the same node and the
      // memo'd `DisclosureRow` above it can skip the work.
      icon: /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(import_dsh_client_ui_primitives42.IconBrowseOutlineRegular, { size: 14 }),
      summary: sum,
      errorSummary: errSummary,
      items: retrieveView?.items ?? [],
      coverageLine: covLine,
      omittedNote: omittedNote2,
      detailOmitted: retrieveView?.detailOmitted === true,
      rawText: raw
    };
  }, [block, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(
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
          return /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(RunningNotice, { text: t("toolRetrieveRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)(import_jsx_runtime50.Fragment, { children: [
          coverageLine && /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("div", { className: toolviews_default.coverageNotice, children: coverageLine }),
          omittedNote && /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("div", { className: toolviews_default.coverageNotice, children: omittedNote }),
          detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") }),
          items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("div", { className: toolviews_default.cardList, children: items.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", { className: toolviews_default.evidenceItem, children: [
            /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", { className: toolviews_default.evidenceHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", { className: toolviews_default.evidenceBadges, children: [
                /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(
                  "span",
                  {
                    className: toolviews_default.badge,
                    "data-tone": item.source === "fulltext" ? "pdf" : "info",
                    children: t(sourceLabelKeyOf(item.source))
                  }
                ),
                item.pageLabel && /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("span", { className: toolviews_default.badge, children: item.pageLabel }),
                item.matchedFields?.map((field2) => /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("span", { className: toolviews_default.badge, "data-tone": "warning", children: t(field2 === "comment" ? "matchedInComment" : "matchedInText") }, field2))
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", { className: toolviews_default.itemActions, children: [
                /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(
                  CopyButton,
                  {
                    value: item.preview,
                    label: t("copy"),
                    copiedLabel: t("copied"),
                    className: quiet_default.quietDense
                  }
                ),
                item.attachmentRef && /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(
                  PdfReadButton,
                  {
                    attachmentRef: item.attachmentRef,
                    onOpenFile: props.openFile,
                    label: t("readPdf"),
                    t,
                    variant: "link",
                    className: toolviews_default.actionLink
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(
                  ZoteroLocateActions,
                  {
                    itemRef: item.sourceRef,
                    t,
                    variant: "link",
                    className: toolviews_default.actionLink
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime50.jsxs)("div", { className: toolviews_default.evidenceText, children: [
              item.preview,
              item.previewTruncated ? ` ${t("truncatedPreview")}` : ""
            ] })
          ] }, `${item.sourceRef}-${index}`)) }) : rawText ? /* @__PURE__ */ (0, import_jsx_runtime50.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime50.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") })
        ] });
      }
    }
  );
}

// src/client/toolviews/ExportToolView.tsx
var import_react38 = require("react");
var import_dsh_client_ui_primitives43 = require("@deepseek-ai/dsh-client-ui-primitives");

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

// src/client/sources/sync-decoder.ts
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
    // present" is the *normal* shape of a diff carrying a coverage gap, not a
    // sign the gap went away. Only `unreadable` withholds the cursor, and that
    // fact is the card's separate no-cursor notice.
    withheld: withheldOf(meta["unobservable"]),
    changedTotal: sumTotals(changedTotalKeys) ?? sumSections(
      changed.map((section) => ({ total: section.total, size: section.entries.length }))
    ),
    changed,
    deletedTotal: sumTotals(deletedTotalKeys) ?? sumSections(deleted.map((section) => ({ total: section.total, size: section.keys.length }))),
    deleted,
    detailOmitted: detailOmittedOf(meta)
  };
}

// src/client/toolviews/ExportToolView.tsx
var import_jsx_runtime51 = require("react/jsx-runtime");
function ExportToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const {
    icon,
    format,
    formatLabel,
    refsCount,
    style: style16,
    locale,
    summary,
    errorSummary,
    items,
    rawText,
    job,
    detailOmitted
  } = (0, import_react38.useMemo)(() => {
    const raw = (resultTextOf(block) ?? "").trim();
    const errSummary = errorSummaryOf(block, raw);
    const args = argsViewOf(block);
    const formatArg = textArg(args, "format") ?? "bibtex";
    const meta = metaOf(block);
    const exportView = meta !== null ? exportMetaOf(meta) : null;
    const job2 = meta !== null ? jobArmOf(meta) : null;
    const rawFmt = exportView?.format || formatArg;
    const label = formatLabelOf(rawFmt, t);
    const count = exportView?.refs.length ?? listArg(args, "refs").length;
    let sum = "";
    if (isToolRunning(block)) {
      sum = t("toolExportRunning");
    } else {
      sum = job2 === null ? t("toolSummaryExport", { format: label, count }) : t(jobSummaryKeyOf(job2), { jobId: job2.jobId });
    }
    return {
      icon: /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(import_dsh_client_ui_primitives43.IconCopyOutlineRegular, { size: 14 }),
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
      items: exportView?.items ?? [],
      // A job arm's text is only an acknowledgement, never an export
      // artifact. Keep it out of the code/download surface until job_output
      // supplies the completed translator text.
      rawText: job2 === null ? raw : "",
      job: job2,
      detailOmitted: exportView?.detailOmitted === true
    };
  }, [block, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(
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
          return /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(RunningNotice, { text: t("toolExportRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)(import_jsx_runtime51.Fragment, { children: [
          job !== null ? /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolSummaryJobPending", { jobId: job.jobId }) }) : rawText ? /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("div", { className: toolviews_default.codeWrap, children: [
            /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("div", { className: toolviews_default.codeHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("div", { className: toolviews_default.evidenceBadges, children: [
                /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("span", { className: toolviews_default.badge, "data-tone": "info", children: formatLabel }),
                refsCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("span", { className: toolviews_default.badge, children: t("exportRefCount", { count: refsCount }) }),
                style16 !== null && /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("span", { className: toolviews_default.badge, children: style16 }),
                locale !== null && /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("span", { className: toolviews_default.badge, children: locale })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("div", { className: toolviews_default.itemActions, children: [
                /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(
                  CopyButton,
                  {
                    value: rawText,
                    label: t("copy"),
                    copiedLabel: t("copied"),
                    className: quiet_default.quietDense
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(
                  "button",
                  {
                    type: "button",
                    className: quiet_default.quietDense,
                    onClick: () => {
                      downloadBlob(rawText, fileNameForFormat(format), mimeOf(format));
                    },
                    children: `${t("downloadArtifact")} ${extensionOf(format)}`
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(RawTextFallback, { text: rawText })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") }),
          items.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("div", { className: toolviews_default.notesSection, children: [
            /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("span", { className: toolviews_default.sectionTitle, children: t("lensSources") }),
            /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("div", { className: toolviews_default.cardList, children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime51.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("span", { className: toolviews_default.itemTitle, children: item.title || item.ref }),
              /* @__PURE__ */ (0, import_jsx_runtime51.jsx)(
                ZoteroLocateActions,
                {
                  title: item.title,
                  itemRef: item.ref,
                  t,
                  variant: "link",
                  className: toolviews_default.actionLink
                }
              )
            ] }, item.ref)) })
          ] }),
          detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime51.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") })
        ] });
      }
    }
  );
}

// src/client/toolviews/ItemToolView.tsx
var import_react39 = require("react");
var import_dsh_client_ui_primitives44 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime52 = require("react/jsx-runtime");
function previewView(preview, index) {
  return {
    key: `${preview.ref}-${index}`,
    preview: preview.preview,
    pageLabel: preview.pageLabel,
    ref: preview.ref,
    parentRef: preview.parentRef ?? null
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
    childCounts,
    notePreviews,
    annotationPreviews,
    detailOmitted,
    rawText
  } = (0, import_react39.useMemo)(() => {
    const args = argsViewOf(block);
    const itemRef = textArg(args, "ref") ?? "";
    const meta = metaOf(block);
    const view = meta !== null ? getMetaOf(meta) : null;
    const raw = (resultTextOf(block) ?? "").trim();
    let sum = "";
    if (isToolRunning(block)) {
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
      icon: /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(import_dsh_client_ui_primitives44.IconDeliverDocRegular, { size: 14 }),
      ref: itemRef,
      summary: sum,
      errorSummary: errSummary,
      getItemView: view,
      childCounts: counts.flatMap(
        ({ key, count, shown, label }) => (
          // A kind the call did not ask for is absent, not zero: "no notes
          // exist" and "notes were not requested" are different facts.
          count === null ? [] : [{ key, label, count, shown }]
        )
      ),
      detailOmitted: view?.detailOmitted === true,
      notePreviews: notesPreviews.map((preview, index) => previewView(preview, index)),
      annotationPreviews: annotationPreviews2.map((preview, index) => previewView(preview, index)),
      rawText: raw
    };
  }, [block, t]);
  const previewSection = (label, previews) => {
    if (previews.length === 0) return null;
    return /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", { className: toolviews_default.notesSection, children: [
      /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", { className: toolviews_default.sectionTitle, children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("div", { className: toolviews_default.cardList, children: previews.map((preview) => /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", { className: toolviews_default.itemCard, "data-child-row": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", { className: toolviews_default.itemHeader, children: [
          preview.pageLabel !== null && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", { className: toolviews_default.badge, children: preview.pageLabel }),
          /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", { className: toolviews_default.itemMeta, children: preview.preview })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", { className: toolviews_default.itemActions, children: [
          preview.parentRef !== null && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(
            PdfReadButton,
            {
              attachmentRef: preview.parentRef,
              onOpenFile: props.openFile,
              label: t("readPdf"),
              t,
              variant: "link",
              className: toolviews_default.actionLink
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(
            ZoteroLocateActions,
            {
              itemRef: preview.ref,
              variant: "link",
              className: toolviews_default.actionLink,
              t
            }
          )
        ] })
      ] }, preview.key)) })
    ] });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(
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
          return /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)(import_jsx_runtime52.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", { className: toolviews_default.itemCard, children: [
            /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              getItemView?.year !== null && getItemView?.year !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", { className: toolviews_default.badge, children: getItemView.year }),
              getItemView?.bestAttachment && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: t("badgePdf") }),
              /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", { className: toolviews_default.itemTitle, children: getItemView?.title ?? ref })
            ] }),
            getItemView?.creators && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("div", { className: toolviews_default.itemMeta, children: getItemView.creators }),
            getItemView?.venue && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("div", { className: toolviews_default.itemMeta, children: getItemView.venue }),
            childCounts.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("div", { className: toolviews_default.evidenceBadges, children: childCounts.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("span", { className: toolviews_default.badge, "data-child-count": entry.key, children: entry.shown === null ? (
              // No list of this kind on this card, so there is nothing
              // to pair the count against: state the count itself.
              `${entry.label} ${entry.count.returned}`
            ) : `${entry.label} ${countOfLabel(entry.count.total, entry.shown, t)}` }, entry.key)) }),
            /* @__PURE__ */ (0, import_jsx_runtime52.jsxs)("div", { className: toolviews_default.itemActions, children: [
              getItemView?.bestAttachment?.ref && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(
                PdfReadButton,
                {
                  attachmentRef: getItemView.bestAttachment.ref,
                  onOpenFile: props.openFile,
                  label: t("readPdf"),
                  t,
                  variant: "link",
                  className: toolviews_default.actionLink
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(
                ZoteroLocateActions,
                {
                  title: getItemView?.title,
                  itemRef: ref,
                  t,
                  variant: "link",
                  className: toolviews_default.actionLink
                }
              )
            ] })
          ] }),
          previewSection(t(CHILD_KIND_LABEL.note), notePreviews),
          previewSection(t(CHILD_KIND_LABEL.annotation), annotationPreviews),
          rawText && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)(RawTextFallback, { text: rawText }),
          detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime52.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") })
        ] });
      }
    }
  );
}

// src/client/toolviews/ChildrenToolView.tsx
var import_react40 = require("react");
var import_dsh_client_ui_primitives45 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime53 = require("react/jsx-runtime");
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
  t,
  onOpenFile
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", { className: toolviews_default.notesSection, "data-child-kind": section.kind, children: [
    /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.sectionTitle, children: `${t(sectionLabelKeyOf(section.kind))} \xB7 ${countOfLabel(section.total, section.shown, t)}` }),
    section.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolChildrenNone") }) : /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("div", { className: toolviews_default.cardList, children: section.rows.map((row) => {
      const targetPdfRef = row.kind === "annotation" ? row.parentRef : row.kind === "attachment" ? row.ref : null;
      const swatch = annotationColorVar(row.kind === "annotation" ? row.color : null);
      return /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", { className: toolviews_default.itemCard, "data-child-row": row.kind, children: [
        /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", { className: toolviews_default.itemHeader, children: [
          swatch && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.annotationSwatch, style: swatch, "aria-hidden": true }),
          row.kind === "annotation" && row.pageLabel !== null && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.badge, children: row.pageLabel }),
          row.kind === "annotation" && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.badge, children: row.type }),
          row.kind === "attachment" && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: row.contentType }),
          /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.itemTitle, children: rowTextOf(row) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", { className: toolviews_default.itemActions, children: [
          targetPdfRef && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(
            PdfReadButton,
            {
              attachmentRef: targetPdfRef,
              onOpenFile,
              label: t("readPdf"),
              t,
              variant: "link",
              className: toolviews_default.actionLink
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(
            ZoteroLocateActions,
            {
              itemRef: row.ref,
              variant: "link",
              className: toolviews_default.actionLink,
              t
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
  const { icon, ref, summary, errorSummary, attachView, sections, detailOmitted, rawText } = (0, import_react40.useMemo)(() => {
    const args = argsViewOf(block);
    const itemRef = textArg(args, "ref") ?? "";
    const meta = metaOf(block);
    const attachView2 = isAttachment && meta !== null ? attachmentMetaOf(meta) : null;
    const children = !isAttachment && meta !== null ? childrenMetaOf(meta) : null;
    const raw = (resultTextOf(block) ?? "").trim();
    const childTotal = (children?.sections ?? []).reduce((sum2, section) => sum2 + section.total, 0);
    let sum = "";
    if (isToolRunning(block)) {
      sum = itemRef || title;
    } else if (attachView2?.title) {
      sum = t("toolSummaryAttachment", { title: attachView2.title });
    } else if ((children?.sections.length ?? 0) > 0) {
      sum = t("toolSummaryChildren", { count: childTotal });
    } else {
      sum = itemRef || title;
    }
    const errSummary = errorSummaryOf(block, raw);
    return {
      icon: /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(import_dsh_client_ui_primitives45.IconLinkOutlineMedium, { size: 14 }),
      ref: itemRef,
      summary: sum,
      errorSummary: errSummary,
      attachView: attachView2,
      sections: children?.sections ?? [],
      detailOmitted: (attachView2?.detailOmitted ?? children?.detailOmitted) === true,
      rawText: raw
    };
  }, [block, isAttachment, t, title]);
  return /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(
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
          return /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)(import_jsx_runtime53.Fragment, { children: [
          detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") }),
          attachView && /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", { className: toolviews_default.itemCard, children: [
            /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              attachView.kind && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.badge, children: attachView.kind.toUpperCase() }),
              attachView.contentType && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.badge, "data-tone": "pdf", children: attachView.contentType }),
              /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("span", { className: toolviews_default.itemTitle, children: attachView.title ?? ref })
            ] }),
            attachView.location && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)("div", { className: toolviews_default.itemMeta, children: attachView.location }),
            /* @__PURE__ */ (0, import_jsx_runtime53.jsxs)("div", { className: toolviews_default.itemActions, children: [
              attachView.location && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(
                CopyButton,
                {
                  value: attachView.location,
                  label: t("copy"),
                  copiedLabel: t("copied"),
                  className: quiet_default.quietDense
                }
              ),
              (attachView.ref || attachView.location) && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(
                PdfReadButton,
                {
                  attachmentRef: attachView.ref ?? void 0,
                  filePath: attachView.kind === "file" ? attachView.location ?? void 0 : void 0,
                  webUrl: attachView.kind === "url" ? attachView.location ?? void 0 : void 0,
                  onOpenFile: props.openFile,
                  label: t("readPdf"),
                  t,
                  variant: "link",
                  className: toolviews_default.actionLink
                }
              )
            ] })
          ] }),
          sections.map((section) => /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(
            ChildSectionView,
            {
              section,
              t,
              onOpenFile: props.openFile
            },
            section.kind
          )),
          rawText && /* @__PURE__ */ (0, import_jsx_runtime53.jsx)(RawTextFallback, { text: rawText })
        ] });
      }
    }
  );
}

// src/client/toolviews/WriteToolView.tsx
var import_react41 = require("react");
var import_dsh_client_ui_primitives46 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime54 = require("react/jsx-runtime");
var RECEIPT_BADGE = {
  partial: { label: "badgePartial", tone: "warning" },
  failed: { label: "toolFailed", tone: "danger" },
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
var WRITE_DESCRIPTORS = {
  zotero_batch_items: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleBatchItems",
    describe: ({ args, t }) => {
      return {
        summary: t("toolSummaryBatchItems", {
          creates: listArg(args, "create").length,
          updates: listArg(args, "update").length,
          deletes: listArg(args, "delete").length
        }),
        tone: "applied",
        tags: []
      };
    }
  },
  zotero_create_note: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleCreateNote",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryCreateNote", {
        title: noteTitleOf(textArg(args, "markdown"), t("toolDefaultNoteTitle"))
      }),
      tone: "applied",
      tags: listArg(args, "tags"),
      parentRef: textArg(args, "parentItem") ?? textArg(args, "ref")
    })
  },
  zotero_update_note: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateNote",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryUpdateNote", {
        title: noteTitleOf(textArg(args, "markdown"), t("toolDefaultNoteTitle"))
      }),
      tone: "applied",
      tags: [],
      parentRef: textArg(args, "ref")
    })
  },
  zotero_update_item_tags: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconPlusOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateItemTags",
    describe: ({ args, write, t }) => {
      const requested = [...listArg(args, "add"), ...listArg(args, "remove")];
      if (write === null || write.addedCount === null && write.removedCount === null) {
        return {
          summary: t("toolSummaryUpdateItemTagsRequested", { count: requested.length }),
          tone: "unreported",
          tags: requested,
          parentRef: textArg(args, "ref")
        };
      }
      const added = write.addedCount ?? 0;
      const removed = write.removedCount ?? 0;
      return {
        summary: added === 0 && removed === 0 ? t("toolNoTagsChanged") : t("toolSummaryUpdateItemTags", { added, removed }),
        tone: added === 0 && removed === 0 ? "noop" : "applied",
        tags: requested,
        parentRef: textArg(args, "ref")
      };
    }
  },
  zotero_update_item_collections: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateItemCollections",
    describe: ({ args, write, t }) => {
      const requested = [...listArg(args, "add"), ...listArg(args, "remove")];
      if (write === null || write.addedCount === null && write.removedCount === null) {
        const name = requested[0] !== void 0 ? shortKeyOf(requested[0]) ?? requested[0].trim() : "";
        return {
          summary: t("toolSummaryUpdateItemCollectionsRequested", { name }),
          tone: "unreported",
          tags: [],
          parentRef: textArg(args, "ref")
        };
      }
      const added = write.addedCount ?? 0;
      const removed = write.removedCount ?? 0;
      return {
        summary: added === 0 && removed === 0 ? t("toolNoMembershipChanged") : t("toolSummaryUpdateItemCollections", { added, removed }),
        tone: added === 0 && removed === 0 ? "noop" : "applied",
        tags: [],
        parentRef: textArg(args, "ref")
      };
    }
  },
  zotero_create_collection: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleCreateCollection",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryCreateCollection", {
        name: (textArg(args, "name") ?? "").trim()
      }),
      tone: "applied",
      tags: [],
      parentRef: textArg(args, "parent")
    })
  },
  zotero_update_collection: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateCollection",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryUpdateCollection", {
        name: (textArg(args, "name") ?? textArg(args, "collection") ?? "").trim()
      }),
      tone: "applied",
      tags: [],
      parentRef: textArg(args, "collection")
    })
  },
  zotero_delete_collection: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleDeleteCollection",
    describe: ({ args, t }) => {
      const collectionArg = textArg(args, "collection") ?? "";
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
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleCreateItem",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryCreateItem", {
        title: (textArg(args, "title") ?? textArg(args, "url") ?? "").trim()
      }),
      tone: "applied",
      tags: []
    })
  },
  zotero_update_item: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateItem",
    describe: ({ args, t }) => {
      const ref = textArg(args, "ref");
      return {
        summary: t("toolSummaryUpdateItem", { ref: shortKeyOf(ref ?? "") ?? (ref ?? "").trim() }),
        tone: "applied",
        tags: [],
        parentRef: ref
      };
    }
  },
  zotero_restore_items: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconEditOutlineRegular, { size: 14 }),
    titleKey: "toolTitleRestoreItems",
    describe: ({ args, write, t }) => {
      if (write?.kind !== "restored" || write.restoredCount === null || write.failedCount === null) {
        return {
          summary: t("toolSummaryRestoreItemsRequested", { count: listArg(args, "refs").length }),
          tone: "unreported",
          tags: []
        };
      }
      return {
        summary: t("toolSummaryRestoreItems", {
          restored: write.restoredCount,
          failed: write.failedCount
        }),
        tone: write.failedCount > 0 ? write.restoredCount > 0 ? "partial" : "failed" : "applied",
        tags: []
      };
    }
  },
  zotero_create_saved_search: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleCreateSavedSearch",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryCreateSavedSearch", { name: textArg(args, "name") ?? "" }),
      tone: "applied",
      tags: []
    })
  },
  zotero_update_saved_search: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconBranchOutlineRegular, { size: 14 }),
    titleKey: "toolTitleUpdateSavedSearch",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryUpdateSavedSearch", {
        name: textArg(args, "name") ?? textArg(args, "search") ?? ""
      }),
      tone: "applied",
      tags: []
    })
  },
  zotero_delete_saved_search: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconTrashOutlineRegular, { size: 14 }),
    titleKey: "toolTitleDeleteSavedSearch",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryDeleteSavedSearch", { name: textArg(args, "search") ?? "" }),
      tone: "applied",
      tags: []
    })
  },
  scholarly_save_to_zotero: {
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconPlusOutlineRegular, { size: 14 }),
    titleKey: "toolTitleScholarlySave",
    describe: ({ args, t }) => ({
      summary: t("toolSummaryScholarlySave", { title: textArg(args, "title") ?? "" }),
      tone: "applied",
      tags: []
    })
  },
  zotero_delete_library_tags: {
    // A destructive glyph: this is the irreversible library-wide delete, and
    // the icon must not read like any other edit.
    icon: () => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconTrashOutlineRegular, { size: 14 }),
    titleKey: "toolTitleDeleteLibraryTags",
    describe: ({ args, write, t }) => {
      const tags = listArg(args, "tags");
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
    rawText,
    unknownTool
  } = (0, import_react41.useMemo)(() => {
    const descriptor = WRITE_DESCRIPTORS[toolName];
    if (descriptor === void 0) {
      const raw2 = (resultTextOf(block) ?? "").trim();
      return {
        icon: null,
        title: "",
        summary: raw2.split("\n", 1)[0] ?? "",
        tone: "unreported",
        errorSummary: errorSummaryOf(block, raw2),
        parentRef: null,
        parentSelectUrl: null,
        tagsList: [],
        rawText: raw2,
        unknownTool: true
      };
    }
    const args = argsViewOf(block);
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
      tagsList: Array.from(new Set(described.tags)),
      rawText: raw,
      unknownTool: false
    };
  }, [block, t, toolName]);
  if (unknownTool) {
    return /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(
      ZoteroToolRow,
      {
        toolName,
        block,
        useDisclosure,
        inspect,
        t,
        icon: null,
        title: toolName,
        summary,
        children: () => rawText ? /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("div", { className: toolviews_default.receiptCard, children: /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(RawTextFallback, { text: rawText }) }) : null
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(
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
          return /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        if (isDeclined) {
          return /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.receiptCard, "data-state": "declined", children: [
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.Tag, { className: toolviews_default.badge, tone: "warning", children: t("toolDeclined") }),
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("div", { className: toolviews_default.itemMeta, children: rawText })
          ] });
        }
        if (isUnverified) {
          return /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.receiptCard, "data-state": "unverified", children: [
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolUnverifiedDetail") }),
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("div", { className: toolviews_default.itemMeta, children: rawText })
          ] });
        }
        if (state === "error") {
          return /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.receiptCard, children: [
            /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.itemHeader, children: [
              /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.Tag, { className: toolviews_default.badge, tone: "danger", children: t("toolFailed") }),
              /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("span", { className: toolviews_default.receiptTitle, children: errorSummary })
            ] }),
            rawText && /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(RawTextFallback, { text: rawText })
          ] });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.receiptCard, "data-state": tone, children: [
          /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.itemHeader, children: [
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.Tag, { className: toolviews_default.badge, tone: RECEIPT_BADGE[tone].tone, children: t(RECEIPT_BADGE[tone].label) }),
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("span", { className: toolviews_default.receiptTitle, children: summary })
          ] }),
          parentRef && /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.itemActions, children: [
            /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("span", { className: toolviews_default.itemMeta, children: [
              t("toolParentItem"),
              ":"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)(
              "button",
              {
                type: "button",
                className: toolviews_default.actionLink,
                onClick: () => {
                  const targetUrl = parentSelectUrl ?? selectUrlOf(parentRef);
                  if (targetUrl) void launchZoteroProtocol(targetUrl);
                },
                title: t("openInZoteroTooltip"),
                "aria-label": t("openInZotero"),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(import_dsh_client_ui_primitives46.IconLinkOutlineRegular, { size: 12 }),
                  /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("span", { children: parentRef })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(
              CopyButton,
              {
                value: parentSelectUrl ?? selectUrlOf(parentRef) ?? parentRef,
                label: t("copyZoteroLink"),
                copiedLabel: t("copied"),
                title: t("copyZoteroLinkTooltip"),
                className: toolviews_default.actionLink
              }
            )
          ] }),
          tagsList.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime54.jsxs)("div", { className: toolviews_default.notesSection, children: [
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolTags") }),
            /* @__PURE__ */ (0, import_jsx_runtime54.jsx)("div", { className: toolviews_default.tagPills, children: tagsList.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(
              import_dsh_client_ui_primitives46.Tag,
              {
                className: toolviews_default.badge,
                tone: tone === "applied" ? "outline" : RECEIPT_BADGE[tone].tone,
                children: tag
              },
              tag
            )) })
          ] }),
          rawText && /* @__PURE__ */ (0, import_jsx_runtime54.jsx)(RawTextFallback, { text: rawText })
        ] });
      }
    }
  );
}

// src/client/toolviews/BrowseToolView.tsx
var import_react42 = require("react");
var import_dsh_client_ui_primitives47 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime55 = require("react/jsx-runtime");
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
  return /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)(import_jsx_runtime55.Fragment, { children: [
    changes.fromVersion !== null && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.itemMeta, "data-changes-range": true, children: t("toolChangesRange", {
      from: changes.fromVersion,
      to: cursor?.version ?? t("toolChangesRangeUnknown")
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.cardList, "data-changes-sections": true, children: changes.changed.map((section) => /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.itemCard, "data-changes-kind": section.key, children: [
      /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.itemHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.itemTitle, children: t(section.label) }),
        /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.badge, children: countOfLabel(section.total, section.entries.length, t) })
      ] }),
      section.entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.itemMeta, "data-changes-entry": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { children: entry.key }),
        /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("span", { className: toolviews_default.badge, children: [
          "v",
          entry.version
        ] })
      ] }, entry.key)),
      section === fulltext && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.itemMeta, "data-changes-caveat": true, children: t("toolChangesFulltextCaveat") })
    ] }, section.key)) }),
    changes.deleted.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.notesSection, "data-changes-deleted": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.sectionTitle, children: changes.deletedTotal === null ? t("toolDeletedNone") : t("toolDeletedTitle", { count: changes.deletedTotal }) }),
      /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.cardList, children: changes.deleted.map((section) => /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.itemCard, "data-changes-kind": section.key, children: [
        /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.itemHeader, children: [
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.itemTitle, children: t(section.label) }),
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.badge, children: countOfLabel(section.total, section.keys.length, t) })
        ] }),
        section.keys.map((key) => /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.itemMeta, "data-changes-entry": true, children: /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { children: key }) }, key))
      ] }, section.key)) })
    ] }),
    changes.withheld !== null && /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.notesSection, "data-changes-withheld": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolChangesWithheld") }),
      changes.withheld.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.itemMeta, children: t("availabilityEntry", {
        source: `${entry.kind}: ${t(WITHHELD_REASON_LABEL[entry.reason])}`,
        detail: t(WITHHELD_REMEDY[entry.reason])
      }) }, `${entry.kind}-${entry.reason}`))
    ] }),
    cursor !== null ? /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.notesSection, "data-changes-cursor": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.sectionTitle, children: t("toolChangesCursor") }),
      /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.itemHeader, children: [
        /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.itemMeta, children: t("toolChangesCursorValue", { version: cursor.version, serverId: cursor.serverId }) }),
        /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(
          CopyButton,
          {
            value: JSON.stringify({
              version: cursor.version,
              serverId: cursor.serverId
            }),
            label: t("copy"),
            copiedLabel: t("copied"),
            className: quiet_default.quietDense
          }
        )
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, "data-changes-no-cursor": true, children: t("toolChangesNoCursor") }),
    changes.detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") })
  ] });
}
function BrowseToolView(props) {
  const { toolName, block, useDisclosure, inspect, t } = props;
  const isChanges = toolName === "zotero_changes";
  const title = isChanges ? t("toolTitleChanges") : t("toolTitleBrowse");
  const {
    icon,
    summary,
    errorSummary,
    rows,
    empty,
    nextOffset,
    changes,
    job,
    detailOmitted,
    rawText
  } = (0, import_react42.useMemo)(() => {
    const raw = (resultTextOf(block) ?? "").trim();
    const errSummary = errorSummaryOf(block, raw);
    const args = argsViewOf(block);
    const askedKind = textArg(args, "kind");
    const meta = metaOf(block);
    let sum = "";
    let rowViews = [];
    let empty2 = false;
    let next = null;
    let browseDetailOmitted = false;
    let changesView = null;
    let job2 = null;
    if (isToolRunning(block)) {
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
      browseDetailOmitted = browse?.detailOmitted === true;
    }
    return {
      // The icon rides the memo with everything else the header renders, so a
      // re-render that leaves the call's own facts alone reuses the same node
      // and the `DisclosureRow` above it can skip the work.
      icon: isChanges ? /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(import_dsh_client_ui_primitives47.IconRefreshOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(import_dsh_client_ui_primitives47.IconBrowseOutlineRegular, { size: 14 }),
      summary: sum,
      errorSummary: errSummary,
      rows: rowViews,
      empty: empty2,
      nextOffset: next,
      changes: changesView,
      job: job2,
      detailOmitted: browseDetailOmitted,
      rawText: raw
    };
  }, [block, isChanges, t]);
  return /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(
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
          return /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(RunningNotice, { text: t("toolRunning") });
        }
        if (isChanges) {
          if (changes !== null && (changes.changed.length > 0 || changes.deleted.length > 0 || changes.detailOmitted)) {
            return /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(ChangesBody, { changes, t });
          }
          if (job !== null) {
            return /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, "data-job-arm": job.kind, children: rawText || t("toolSummaryJobPending") });
          }
          return rawText ? /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") });
        }
        if (rows.length === 0) {
          if (empty) {
            return /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") });
          }
          return /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)(import_jsx_runtime55.Fragment, { children: [
            detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") }),
            rawText ? /* @__PURE__ */ (0, import_jsx_runtime55.jsx)(RawTextFallback, { text: rawText }) : /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolNoResults") })
          ] });
        }
        return /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)(import_jsx_runtime55.Fragment, { children: [
          detailOmitted && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, children: t("detailOmittedNote") }),
          /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.cardList, children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)(
            "div",
            {
              className: toolviews_default.itemCard,
              "data-browse-row": row.key,
              "data-depth": row.depth > 0 ? Math.min(row.depth, MAX_BROWSE_DEPTH) : void 0,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime55.jsxs)("div", { className: toolviews_default.itemHeader, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.itemTitle, children: row.name }),
                  row.detail !== null && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("span", { className: toolviews_default.badge, children: row.detail })
                ] }),
                row.ref !== null && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.itemMeta, children: row.ref })
              ]
            },
            row.key
          )) }),
          nextOffset !== null && /* @__PURE__ */ (0, import_jsx_runtime55.jsx)("div", { className: toolviews_default.coverageNotice, children: t("toolBrowseNextPage", { offset: nextOffset }) })
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
  ["zotero_batch_items", WriteToolView],
  ["zotero_update_note", WriteToolView],
  ["zotero_update_item_tags", WriteToolView],
  ["zotero_update_item_collections", WriteToolView],
  ["zotero_create_collection", WriteToolView],
  ["zotero_update_collection", WriteToolView],
  ["zotero_delete_collection", WriteToolView],
  ["zotero_create_item", WriteToolView],
  ["zotero_update_item", WriteToolView],
  ["zotero_restore_items", WriteToolView],
  ["zotero_create_saved_search", WriteToolView],
  ["zotero_update_saved_search", WriteToolView],
  ["zotero_delete_saved_search", WriteToolView],
  ["scholarly_save_to_zotero", WriteToolView],
  ["zotero_delete_library_tags", WriteToolView],
  ["zotero_browse", BrowseToolView],
  ["zotero_changes", BrowseToolView]
];
var REGISTRANT = ZOTERO_REMOTE_PACKAGE;
function registerZoteroToolviews(ctx) {
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const [key, component] of REGISTRATIONS) {
      yield ctx.slots.register(
        { name: "tool.call.toolview", key, locale: "zotero", registrant: REGISTRANT },
        withCardBoundary(component)
      );
    }
  });
}

// src/client/components/library/ZoteroLibraryMenu.tsx
var import_jsx_runtime56 = require("react/jsx-runtime");
function ZoteroLibraryMenu({
  tab,
  sessionId,
  dismiss,
  onRefresh,
  t
}) {
  if (tab?.kind !== "zotero-library") return null;
  return /* @__PURE__ */ (0, import_jsx_runtime56.jsxs)(import_jsx_runtime56.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime56.jsx)(
      "button",
      {
        type: "button",
        className: library_default.tabMenuItem,
        onClick: () => {
          dismiss?.();
          if (sessionId && tab?.id) onRefresh?.(sessionId, tab.id);
        },
        children: t("libraryMenuRefresh")
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime56.jsx)(
      "button",
      {
        type: "button",
        className: library_default.tabMenuItem,
        onClick: () => {
          dismiss?.();
          launchZoteroProtocol("zotero://select/");
        },
        children: t("openInZotero")
      }
    )
  ] });
}

// src/client/components/composer/ZoteroComposerButton.tsx
var import_dsh_client_ui_primitives48 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/composer/composer.module.css
var style14 = `.AUZy-q_composerButton{corner-shape:round;background:var(--dsw-specific-selector);width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background .12s var(--ds-ease-in-out), color .12s var(--ds-ease-in-out);border:none;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}@media (hover:hover){.AUZy-q_composerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}}.AUZy-q_composerButton:disabled{opacity:.4;cursor:not-allowed}@media (prefers-reduced-motion:reduce){.AUZy-q_composerButton{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/composer/composer.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/composer/composer.module.css");
  tag.textContent = style14;
  document.head.appendChild(tag);
}
var composer_default = { "composerButton": "AUZy-q_composerButton" };

// src/client/components/composer/ZoteroComposerButton.tsx
var import_jsx_runtime57 = require("react/jsx-runtime");
function ZoteroComposerButton({ t, onClick }) {
  const label = t("tabLibrary");
  return /* @__PURE__ */ (0, import_jsx_runtime57.jsx)(import_dsh_client_ui_primitives48.Tooltip, { label, side: "top", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime57.jsx)(
    "button",
    {
      type: "button",
      className: composer_default.composerButton,
      onClick,
      "aria-label": label,
      title: label,
      children: /* @__PURE__ */ (0, import_jsx_runtime57.jsx)(ZoteroLibraryIcon, { size: 16 })
    }
  ) });
}
function ZoteroComposerSlot({ t, onOpen }) {
  return /* @__PURE__ */ (0, import_jsx_runtime57.jsx)(ZoteroComposerButton, { t, onClick: onOpen });
}

// src/client/components/deliverables/DeliverableZoteroAction.tsx
var import_dsh_client_ui_primitives49 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/components/deliverables/deliverables.module.css
var style15 = `.LHZlqW_actionButton{height:22px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs,4px);cursor:pointer;transition:color .12s var(--ds-ease-in-out), background-color .12s var(--ds-ease-in-out), border-color .12s var(--ds-ease-in-out);background:0 0;align-items:center;gap:4px;padding:0 6px;display:inline-flex}@media (hover:hover){.LHZlqW_actionButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}}@media (prefers-reduced-motion:reduce){.LHZlqW_actionButton{transition:none}}`;
if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-zotero/src/client/components/deliverables/deliverables.module.css"]')) {
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", "dsh-zotero/src/client/components/deliverables/deliverables.module.css");
  tag.textContent = style15;
  document.head.appendChild(tag);
}
var deliverables_default = { "actionButton": "LHZlqW_actionButton" };

// src/client/components/deliverables/DeliverableZoteroAction.tsx
var import_jsx_runtime58 = require("react/jsx-runtime");
var STRICT_BIBLIOGRAPHY_EXTENSIONS = /\.(bib|ris|csljson|csl\.json|biblatex|bibtex)$/i;
var BIBLIOGRAPHY_DESCRIPTION_PATTERN = /exported (?:csljson|citation|references|bib)/i;
var BIBLIOGRAPHY_FILENAME_PATTERN = /(?:csl|zotero|citations?|references?|bibliography)/i;
function isBibliographyDeliverable(file) {
  if (!file?.path) return false;
  if (STRICT_BIBLIOGRAPHY_EXTENSIONS.test(file.path)) return true;
  if (/\.json$/i.test(file.path)) {
    if (file.description && BIBLIOGRAPHY_DESCRIPTION_PATTERN.test(file.description)) return true;
    if (BIBLIOGRAPHY_FILENAME_PATTERN.test(file.path)) return true;
  }
  return false;
}
function resolveDeliverableFile(actionUrl, snapshot) {
  if (!actionUrl || !snapshot) return void 0;
  try {
    const query = actionUrl.includes("?") ? actionUrl.split("?")[1] : actionUrl;
    const params = new URLSearchParams(query);
    const seqStr = params.get("seq");
    const indexStr = params.get("index");
    if (seqStr === null || indexStr === null) return void 0;
    const seq = Number(seqStr);
    const index = Number(indexStr);
    if (!/^[0-9]+$/.test(seqStr) || !/^[0-9]+$/.test(indexStr) || !Number.isSafeInteger(seq) || !Number.isSafeInteger(index) || seq < 1 || index < 0 || params.getAll("seq").length !== 1 || params.getAll("index").length !== 1)
      return void 0;
    for (const turnId of snapshot.timeline.turnOrder) {
      const presented = snapshot.timeline.turns.get(turnId)?.data.get("deliverables")?.presented;
      const match = presented?.find((p) => p.seq === seq && p.index === index);
      if (match?.path) return { path: match.path, description: match.description };
    }
  } catch {
    return void 0;
  }
  return void 0;
}
function DeliverableZoteroAction(props) {
  const { actionUrl, t, useChat, onOpenLibrary } = props;
  const snapshot = useChat ? useChat((s) => s) : void 0;
  const file = resolveDeliverableFile(actionUrl, snapshot);
  if (!isBibliographyDeliverable(file)) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime58.jsxs)(
    import_dsh_client_ui_primitives49.Button,
    {
      variant: "outline",
      size: "sm",
      className: deliverables_default.actionButton,
      onClick: onOpenLibrary,
      title: t("deliverableOpenLibrary"),
      "aria-label": t("deliverableOpenLibrary"),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime58.jsx)(ZoteroLibraryIcon, { size: 12 }),
        /* @__PURE__ */ (0, import_jsx_runtime58.jsx)("span", { children: t("deliverableOpenLibrary") })
      ]
    }
  );
}

// src/client/locales.ts
var en = {
  libraryLoadedCount: "{loaded} / {total} loaded",
  libraryLocate: "Locate current scope",
  libraryWriteActions: "Write actions",
  libraryWriteApprovalHint: "Submit once to review the exact plan in this conversation. Every change requires session approval and plan approval. Writes are never retried automatically.",
  libraryWriteNeedsSession: "This conversation is not running. Start it to receive the write approval and plan card.",
  libraryWriteSession: "Approval conversation",
  libraryWriteConditionsRequired: "Add at least one complete condition row.",
  libraryWriteConditionIncomplete: "Every condition row needs a condition, an operator, and a value; remove the empty rows.",
  libraryWriteOperation: "Operation",
  libraryWriteRef: "Item or note ref",
  libraryWriteRefs: "Item refs",
  libraryWriteParentItem: "Parent item ref (optional)",
  libraryWriteCollection: "Collection ref",
  libraryWriteParentCollection: "Parent collection ref (optional)",
  libraryWriteSearch: "Saved search ref",
  libraryWriteTitle: "Title",
  libraryWriteName: "Name",
  libraryWriteItemType: "Item type",
  libraryWriteMarkdown: "Note body (Markdown)",
  libraryWriteSources: "Source item refs",
  libraryWriteAdd: "Add",
  libraryWriteRemove: "Remove",
  libraryWriteMetadata: "Metadata fields",
  libraryWriteCreators: "Creators",
  libraryWriteBatchCreate: "Items to create",
  libraryWriteBatchUpdate: "Items to update",
  libraryWriteTrashRefs: "Items to move to Trash",
  libraryWriteUpdateItem: "Update metadata",
  libraryWriteTags: "Update tags",
  libraryWriteMembership: "Update collection membership",
  libraryWriteCreateItem: "Create item",
  libraryWriteCreateNote: "Create note",
  libraryWriteUpdateNote: "Update note",
  libraryWriteCreateCollection: "Create collection",
  libraryWriteUpdateCollection: "Update collection",
  libraryWriteDeleteCollection: "Delete collection",
  libraryWriteCreateSearch: "Create saved search",
  libraryWriteUpdateSearch: "Update saved search",
  libraryWriteDeleteSearch: "Delete saved search",
  libraryWriteTrash: "Move items to Trash",
  libraryWriteRestore: "Restore items",
  libraryWriteBatch: "Batch changes",
  libraryWriteCondition: "Condition",
  libraryWriteOperator: "Operator",
  libraryWriteValue: "Value",
  libraryWriteAddCondition: "Add condition",
  libraryWriteRemoveCondition: "Remove condition",
  libraryWriteOnePerLine: "One entry per line.",
  libraryWriteJsonHint: "Enter a JSON array using the documented batch or creator fields.",
  libraryWriteReview: "Review write plan",
  libraryWritePending: "Awaiting approval or result\u2026",
  libraryWriteDeclined: "Declined; nothing written.",
  libraryWriteUnverified: "Commit unverified; check Zotero before submitting again.",
  libraryWriteFailed: "Write failed",
  libraryWriteApplied: "Change applied",
  libraryWriteInvalid: "Check required fields and JSON arrays before submitting.",
  nav: "Literature trail",
  overridden: "Overridden",
  reset: "Reset to default",
  readOnly: "This deployment stores settings read-only.",
  save: "Save",
  saving: "Saving\u2026",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  unavailable: "This deployment does not serve the Zotero settings namespace, so there is nothing to configure here.",
  scholarlyDisabled: 'Scholarly search comes from the dsh-zotero/scholarly component. Enable that component under "Included components" to turn the external scholarly tools on; they will then contact the external indexes, the DOI registry, and the open-access lookup service. Nothing here is configurable while the component is off.',
  invalidNumber: "Enter a number, or leave blank to use the default.",
  tabFeatures: "General",
  tabConnection: "Connection",
  tabSearch: "Search & Extraction",
  tabLibrary: "Literature panel",
  tabLibraryDesc: "Preferences for the literature panel and its right-sidebar display.",
  libraryGuideTitle: "Literature panel",
  libraryGuideDesc: "Browse Zotero literature.",
  tabScholarly: "Scholarly Search",
  tabScholarlyDesc: "Multi-source academic search, API keys, and fulltext quotas from the dsh-zotero/scholarly component. Enabling that component turns the external tools on.",
  tabAdvanced: "Advanced",
  groupLibrarySidebar: "Sidebar Display",
  groupLibrarySidebarDesc: "Choose where the literature panel appears in DeepSeek Harness, with support for right-sidebar display.",
  libraryDisabled: 'The literature panel is provided by the dsh-zotero/library component. Enable that component under "Included components" to turn on library browsing and sidebar configuration.',
  rightSidebarEnabled: "Show in right sidebar",
  rightSidebarHint: "Provide a literature panel tab and quick launcher in the right sidebar for simultaneous chat and reading.",
  libraryNavTree: "Collections",
  libraryNavList: "Items",
  libraryNavInspector: "Inspector",
  configTabsLabel: "Zotero configuration tabs",
  groupWebDesc: "Toggle the literature trail tab in conversations.",
  groupWriteDesc: "Manage write access, authorizations, and safety gates for your personal library.",
  groupDefaultsDesc: "Default citation style and locale code for generated references and bibliographies.",
  groupConnectionDesc: "Configure HTTP API parameters for communicating with the running local Zotero instance.",
  groupSearchQuery: "Search & Concurrency",
  groupSearchQueryDesc: "Search result quotas, concurrency, and scan/retrieval limits.",
  groupSearchEvidence: "Passages & Fulltext Extraction",
  groupSearchEvidenceDesc: "Passage length, passage count, notes, and full-text chunk sizes.",
  groupScholarlyAuth: "API Credentials & Identification",
  groupScholarlyAuthDesc: "Contact email for the Polite Pool and optional academic API keys.",
  groupScholarlyLimits: "Search & Full-text Quotas",
  groupScholarlyLimitsDesc: "Maximum results per search and the full-text reading limit.",
  groupOutputDesc: "Response buffer sizes and batch export caps.",
  groupJobsDesc: "Background task offloading policies and automatic timeout escalation.",
  groupDiagnosticsDesc: "Diagnostics logging and verbose troubleshooting traces.",
  scholarlyEmail: "Contact email",
  scholarlyEmailHint: "Contact email sent to Crossref, OpenAlex, and NCBI/Europe PMC for the polite pool and higher rate limits.",
  scholarlyS2Key: "Semantic Scholar API key",
  scholarlyS2KeyHint: "Optional; avoids shared-pool rate limiting.",
  scholarlyNcbiKey: "NCBI / PubMed API key",
  scholarlyNcbiKeyHint: "Optional; raises rate limit from 3 to 10 req/s.",
  scholarlyOpenalexKey: "OpenAlex API key",
  scholarlyOpenalexKeyHint: "Optional; raises rate limit to 100 req/s.",
  scholarlyMaxResults: "Max papers per search",
  scholarlyMaxResultsHint: "Maximum number of papers returned in a single search (1-100).",
  scholarlyMaxContentChars: "Max full-text characters",
  scholarlyMaxContentCharsHint: "Character ceiling for chunked open-access full-text reading (1,000-50,000).",
  secretConfigured: "Configured",
  secretNotConfigured: "Not configured",
  groupConnection: "Connection",
  groupOutput: "Output limits",
  groupDefaults: "Citation defaults",
  groupWrite: "Writing",
  writeEnabled: "Allow writes",
  writeEnabledHint: "The agent can change the library: notes, tags, collections, and items.",
  writeRiskTitle: "Enable writes?",
  writeRiskDescription: "Turning this on lets the agent change your Zotero library: notes, tags, collections, and items. Deletions cannot be undone. AI can make mistakes; review before enabling.",
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
  maxAttachmentRecords: "Attachment record cap",
  maxAttachmentRecordsHint: "Most attachments returned for one item.",
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
  maxChangesResultsHint: "Most rows one changes listing shows per kind, display only; the diff still covers the whole range and totals report the true counts.",
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
  groupWeb: "Literature trail",
  webEnabled: "Show literature trail",
  webEnabledHint: "Shows the literature trail tab at the top of conversations: the papers the agent retrieved or read in this session, their passages, and its exports.",
  groupDiagnostics: "Diagnostics",
  debug: "Diagnostic mode",
  debugHint: "Enables diagnostic mode and displays the diagnostics log panel at the bottom of the plugin details page. When disabled, the panel is hidden. Retained in local process memory only.",
  diagnosticsTitle: "Diagnostics",
  diagnosticsLogLabel: "Diagnostics log",
  diagnosticsEmpty: "No entries yet. State changes, degradations, and failures will appear here.",
  diagnosticsNoProblems: "No warn or error entries in the current record.",
  diagnosticsLevelAll: "All levels",
  diagnosticsLevelProblems: "Problems",
  diagnosticsShowLatest: "Showing the latest {shown} of {total} entries.",
  diagnosticsCopyBundle: "Copy diagnostics",
  diagnosticsDebugOn: "Diagnostics: on",
  diagnosticsDebugOff: "Diagnostics: off",
  diagnosticsDetail: "Detail",
  diagnosticsFilterLabel: "Filter log level",
  jsonCopyValue: "Copy value",
  jsonCopyJson: "Copy JSON",
  jsonCopyPath: "Copy path",
  jsonCopyPrettyJson: "Copy pretty JSON",
  jsonCopyCompactJson: "Copy compact JSON",
  jsonCopyFailed: "Copy failed",
  jsonCollapseNode: "Collapse node",
  jsonExpandNode: "Expand node",
  copy: "Copy",
  copied: "Copied",
  commandInputAria: "Command input",
  checking: "Checking\u2026",
  statusUnavailable: "Unavailable",
  statusConnectedNote: "Connected to Zotero",
  detailsLabel: "Status details",
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
  diagnosisProviderUnavailable: "The configured Zotero provider is not registered. Check the provider id in the dsh-zotero configuration on the Plugins page.",
  diagnosisCapabilityUnavailable: "The selected Zotero provider does not serve this capability. Switch provider or enable the feature.",
  diagnosisUnknown: "Connection error",
  renderFailed: "Render failed",
  refresh: "Refresh",
  lastCheckedLabel: "Last checked",
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
  tipWebTab: 'Turn on "Show literature trail" and the literature trail tab appears at the top of conversations, with the papers this session touched, their passages, and exports.',
  tipWriteGate: 'To let the agent write notes, tags, collections, or items, turn on "Allow writes" and approve the Zotero popup.',
  tipSettingsNav: "Connection, result caps, and citation style are fully configurable in the dsh-zotero configuration on the Plugins page.",
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
  modeMetadata: "Metadata",
  modeEverything: "Metadata and full text",
  overviewScopeLibrary: "Library",
  overviewScopePublications: "My Publications",
  overviewScopeCollection: "Collection",
  overviewScopeSavedSearch: "Saved search",
  searchDetailOpen: "Technical details",
  searchDetailClose: "Hide technical details",
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
  detailOmittedNote: "The card outgrew its byte budget, so its detail rows were omitted; the complete data stays in the result.",
  noSources: "No Zotero papers in this session yet.",
  searchEpisodeQueryLine: 'Search "{query}" \xB7 {scope} \xB7 {mode}',
  searchEpisodeNoQueryLine: "Browse search \xB7 {scope} \xB7 {mode}",
  searchEpisodeFilterLine: "Filters: {filters}",
  searchEpisodeHitsLine: "{returned} returned of {total} total",
  searchEpisodeHitsNoTotal: "{returned} returned",
  searchEpisodeNoteHits: "{noteMatches} note matches",
  databaseMismatch: "Belongs to a different Zotero database",
  evidenceBadge: "{count} passages",
  exportBadge: "{count} exports",
  failedBadge: "{count} failed",
  runningBadge: "{count} running",
  stoppedBadge: "{count} stopped",
  badgePdf: "PDF",
  issuesBadge: "Issues",
  copyRef: "Copy Zotero link",
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
  readPdf: "Read PDF",
  readPdfInSidebar: "Read in sidebar",
  copyTitle: "Copy title",
  copyTitleTooltip: "Paste into Zotero Quick Search (Cmd/Ctrl+F) to find the item",
  copyZoteroLink: "Copy link",
  copyZoteroLinkTooltip: "Canonical Zotero deep link, for notes or the address bar",
  openInZotero: "Open in Zotero",
  openInZoteroTooltip: "Open this item in the local Zotero desktop app",
  libraryMenuRefresh: "Refresh library data",
  deliverableOpenLibrary: "View in Zotero panel",
  pdfResolving: "Resolving attachment\u2026",
  pdfFileNotFound: "Local PDF file not found",
  instanceUnverified: "cannot verify the current Zotero instance",
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
  toolTitleRetrieve: "Zotero Retrieve Passages",
  toolTitleExport: "Zotero Export Citation",
  toolTitleGet: "Zotero Item Details",
  toolTitleChildren: "Zotero Item Children",
  toolTitleAttachment: "Zotero Attachment",
  toolTitleCreateNote: "Zotero Create Note",
  toolTitleBatchItems: "Zotero Batch Items",
  toolTitleUpdateItemTags: "Zotero Update Item Tags",
  toolTitleUpdateItemCollections: "Zotero Update Item Collections",
  toolTitleCreateCollection: "Zotero Create Collection",
  toolTitleDeleteCollection: "Zotero Delete Collection",
  toolTitleCreateItem: "Zotero Create Item",
  toolTitleUpdateItem: "Zotero Update Item",
  toolTitleUpdateNote: "Zotero Update Note",
  badgePartial: "Partially completed",
  toolTitleUpdateCollection: "Zotero Update Collection",
  toolTitleRestoreItems: "Zotero Restore Items",
  toolTitleCreateSavedSearch: "Zotero Create Saved Search",
  toolTitleUpdateSavedSearch: "Zotero Update Saved Search",
  toolTitleDeleteSavedSearch: "Zotero Delete Saved Search",
  toolTitleScholarlySave: "Save Scholarly Result to Zotero",
  toolSummaryUpdateNote: 'Updated note "{title}"',
  toolSummaryUpdateCollection: 'Updated collection "{name}"',
  toolSummaryRestoreItems: "Restored {restored} items; {failed} failed",
  toolSummaryRestoreItemsRequested: "Requested restoration of {count} items",
  toolSummaryCreateSavedSearch: 'Created saved search "{name}"',
  toolSummaryUpdateSavedSearch: 'Updated saved search "{name}"',
  toolSummaryDeleteSavedSearch: 'Deleted saved search "{name}"',
  toolSummaryScholarlySave: 'Saved scholarly result "{title}" to Zotero',
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
  toolRetrieveRunning: "Retrieving passages\u2026",
  toolExportRunning: "Exporting citations\u2026",
  toolSummaryFound: "found {count} items",
  toolSummaryFoundWithNotes: "found {count} items (+{notes} notes)",
  toolSummaryEvidence: "extracted {count} passages",
  toolSummaryExport: "exported {format} ({count} items)",
  toolSummaryItem: "{title} ({year})",
  toolSummaryChildren: "{count} child objects",
  toolSummaryAttachment: "Attachment: {title}",
  toolSummaryCreateNote: 'Created note "{title}"',
  toolSummaryBatchItems: "Requested {creates} creates, {updates} updates, {deletes} deletes",
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
  statusLocalApiAddress: "Local API Address",
  libraryPanel: "Literature panel navigation",
  librarySelectLibrary: "Library",
  librarySearchLabel: "Search",
  librarySearchPlaceholder: "Search titles, creators, years\u2026",
  librarySearchModeLabel: "Mode",
  librarySearchModeMetadata: "Metadata",
  librarySearchModeEverything: "Full text",
  libraryEverythingHint: "Searches PDF text via Zotero\u2019s local index.",
  librarySortLabel: "Sort",
  librarySortAsc: "Ascending",
  librarySortDesc: "Descending",
  librarySortDateModified: "Date modified",
  librarySortDateAdded: "Date added",
  librarySortDate: "Publication date",
  librarySortTitle: "Title",
  librarySortCreator: "Creator",
  libraryStatusLabel: "Connection",
  libraryConnected: "Connected",
  libraryOffline: "Offline",
  libraryAllItems: "All items",
  libraryPublications: "My Publications",
  libraryTrash: "Trash",
  libraryCollections: "Collections",
  libraryNoCollections: "No collections",
  librarySavedSearches: "Saved searches",
  libraryNoSavedSearches: "No saved searches",
  libraryItemList: "Item list",
  libraryLoading: "Loading\u2026",
  libraryEmptyList: "No items in this scope",
  libraryNoMatches: "No items match these filters",
  libraryRangeOfTotal: "{start}\u2013{end} of {total}",
  libraryPagePrev: "Previous",
  libraryPageNext: "Next",
  libraryRetry: "Retry",
  libraryFilters: "Filters",
  libraryFilterTypes: "Item types",
  libraryFilterTags: "Tags",
  libraryTagMatch: "Tag match",
  libraryTagAll: "All selected tags",
  libraryTagAny: "Any selected tag",
  libraryYearFrom: "Year from (inclusive)",
  libraryYearTo: "Year to (inclusive)",
  libraryYearLabel: "Year",
  libraryYearFromShort: "From",
  libraryYearToShort: "To",
  libraryFilterRemove: "Remove {label}",
  libraryTagRemove: "Remove tag {tag}",
  librarySearchTags: "Search tags",
  libraryLoadMore: "Load more",
  libraryYearRangeInvalid: "From year must not exceed to year",
  libraryAnnotationPage: "p. {page}",
  libraryAttachmentFilter: "Attachments",
  libraryFilterAny: "Any",
  libraryHasAttachment: "Has attachments",
  libraryNoAttachment: "No attachments",
  libraryClearFilters: "Clear filters",
  librarySearchConditions: "Stored conditions",
  libraryInvalidPage: "Invalid pagination cursor",
  libraryOfflineNote: "Zotero is offline; browsing is paused. Start Zotero, then refresh.",
  libraryInspector: "Item detail",
  libraryNoSelection: "Select an item to see its detail",
  libraryAskInChat: "Ask",
  libraryAddToChat: "Add to chat",
  libraryExpand: "Expand",
  libraryCollapse: "Collapse",
  libraryInfoTitle: "Info",
  libraryAskTemplate: 'Answer questions about the paper "{title}" ({ref}). My question: ',
  libraryAskPrompt: 'Please refer to the paper "{title}" ({ref}) and answer questions based on its contents.',
  libraryCiteLine: '"{title}" ({ref})',
  libraryMetaType: "Type",
  libraryMetaCreators: "Creators",
  libraryMetaDate: "Date",
  libraryMetaVenue: "Venue",
  libraryMetaDoi: "DOI",
  libraryMetaUrl: "URL",
  libraryMetaCollections: "Collections",
  libraryMetaTags: "Tags",
  libraryMetaExtra: "Extra",
  libraryMetaAbstract: "Abstract",
  libraryMetaNote: "Note",
  libraryAbstractTruncated: "Content truncated for display.",
  libraryNotesTitle: "Notes ({count})",
  libraryAttachmentsTitle: "Attachments ({count})",
  libraryAnnotationsTitle: "Annotations ({count})",
  libraryAnnotationPageBadge: "P. {page}",
  libraryCitationMenu: "Export citation",
  libraryMoreActions: "More actions",
  libraryCopyQuote: "Copy quote",
  libraryCopyNote: "Copy note",
  libraryCopyCitation: "Copy citation",
  libraryCopyCitationDone: "Citation copied",
  libraryCopyBibtex: "BibTeX",
  libraryCopyBibtexDone: "BibTeX copied",
  libraryCopyMoreFormats: "More formats",
  libraryCopyBibliography: "Bibliography",
  libraryCopyBibliographyDone: "Bibliography copied",
  libraryCopyBiblatex: "BibLaTeX",
  libraryCopyBiblatexDone: "BibLaTeX copied",
  libraryCopyRis: "RIS",
  libraryCopyRisDone: "RIS copied",
  libraryCopyCsljson: "CSL-JSON",
  libraryCopyCsljsonDone: "CSL-JSON copied",
  libraryCopyItemInfo: "Copy item info",
  libraryCopyItemInfoDone: "Item info copied",
  libraryExportPending: "Formatting\u2026",
  libraryCopyFailed: "Copy failed: {message}",
  libraryCopyCitationEmpty: "The host returned no citation text.",
  libraryCopyClipboardUnavailable: "The clipboard is unavailable.",
  libraryInsertQuote: "Quote in chat",
  libraryInsertNote: "Quote note in chat",
  librarySectionCollapse: "Collapse {title}",
  librarySectionExpand: "Expand {title}",
  libraryNoSessionForOpen: "No session is open, so local attachments cannot open in the right reader."
};
var zh = {
  libraryLoadedCount: "\u5DF2\u52A0\u8F7D {loaded} / {total}",
  libraryLocate: "\u5B9A\u4F4D\u5F53\u524D\u8303\u56F4",
  libraryWriteActions: "\u5199\u5165\u64CD\u4F5C",
  libraryWriteApprovalHint: "\u63D0\u4EA4\u540E\u8BF7\u5728\u5F53\u524D\u4F1A\u8BDD\u4E2D\u6838\u5BF9\u5177\u4F53\u8BA1\u5212\u3002\u6BCF\u6B21\u53D8\u66F4\u90FD\u9700\u8981\u4F1A\u8BDD\u5BA1\u6279\u548C\u8BA1\u5212\u6279\u51C6\uFF0C\u5199\u5165\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002",
  libraryWriteNeedsSession: "\u5F53\u524D\u4F1A\u8BDD\u672A\u8FD0\u884C\uFF1B\u542F\u52A8\u8BE5\u4F1A\u8BDD\u540E\u624D\u80FD\u63A5\u6536\u5199\u5165\u5BA1\u6279\u4E0E\u8BA1\u5212\u5361\u3002",
  libraryWriteSession: "\u5BA1\u6279\u4F1A\u8BDD",
  libraryWriteConditionsRequired: "\u81F3\u5C11\u586B\u5199\u4E00\u884C\u5B8C\u6574\u6761\u4EF6\u3002",
  libraryWriteConditionIncomplete: "\u6BCF\u4E2A\u6761\u4EF6\u884C\u90FD\u9700\u8981\u6761\u4EF6\u3001\u8FD0\u7B97\u7B26\u4E0E\u503C\uFF1B\u8BF7\u5220\u9664\u7A7A\u884C\u3002",
  libraryWriteOperation: "\u64CD\u4F5C",
  libraryWriteRef: "\u6761\u76EE\u6216\u7B14\u8BB0\u5F15\u7528",
  libraryWriteRefs: "\u6761\u76EE\u5F15\u7528",
  libraryWriteParentItem: "\u7236\u6761\u76EE\u5F15\u7528\uFF08\u53EF\u9009\uFF09",
  libraryWriteCollection: "\u5408\u96C6\u5F15\u7528",
  libraryWriteParentCollection: "\u7236\u5408\u96C6\u5F15\u7528\uFF08\u53EF\u9009\uFF09",
  libraryWriteSearch: "\u4FDD\u5B58\u641C\u7D22\u5F15\u7528",
  libraryWriteTitle: "\u6807\u9898",
  libraryWriteName: "\u540D\u79F0",
  libraryWriteItemType: "\u6761\u76EE\u7C7B\u578B",
  libraryWriteMarkdown: "\u7B14\u8BB0\u6B63\u6587\uFF08Markdown\uFF09",
  libraryWriteSources: "\u6765\u6E90\u6761\u76EE\u5F15\u7528",
  libraryWriteAdd: "\u6DFB\u52A0",
  libraryWriteRemove: "\u79FB\u9664",
  libraryWriteMetadata: "\u5143\u6570\u636E\u5B57\u6BB5",
  libraryWriteCreators: "\u4F5C\u8005",
  libraryWriteBatchCreate: "\u5F85\u521B\u5EFA\u6761\u76EE",
  libraryWriteBatchUpdate: "\u5F85\u66F4\u65B0\u6761\u76EE",
  libraryWriteTrashRefs: "\u5F85\u79FB\u5165\u56DE\u6536\u7AD9\u7684\u6761\u76EE",
  libraryWriteUpdateItem: "\u66F4\u65B0\u5143\u6570\u636E",
  libraryWriteTags: "\u66F4\u65B0\u6807\u7B7E",
  libraryWriteMembership: "\u66F4\u65B0\u6240\u5C5E\u5408\u96C6",
  libraryWriteCreateItem: "\u521B\u5EFA\u6761\u76EE",
  libraryWriteCreateNote: "\u521B\u5EFA\u7B14\u8BB0",
  libraryWriteUpdateNote: "\u66F4\u65B0\u7B14\u8BB0",
  libraryWriteCreateCollection: "\u521B\u5EFA\u5408\u96C6",
  libraryWriteUpdateCollection: "\u66F4\u65B0\u5408\u96C6",
  libraryWriteDeleteCollection: "\u5220\u9664\u5408\u96C6",
  libraryWriteCreateSearch: "\u521B\u5EFA\u4FDD\u5B58\u641C\u7D22",
  libraryWriteUpdateSearch: "\u66F4\u65B0\u4FDD\u5B58\u641C\u7D22",
  libraryWriteDeleteSearch: "\u5220\u9664\u4FDD\u5B58\u641C\u7D22",
  libraryWriteTrash: "\u79FB\u5165\u56DE\u6536\u7AD9",
  libraryWriteRestore: "\u6062\u590D\u6761\u76EE",
  libraryWriteBatch: "\u6279\u91CF\u53D8\u66F4",
  libraryWriteCondition: "\u6761\u4EF6",
  libraryWriteOperator: "\u8FD0\u7B97\u7B26",
  libraryWriteValue: "\u503C",
  libraryWriteAddCondition: "\u6DFB\u52A0\u6761\u4EF6",
  libraryWriteRemoveCondition: "\u79FB\u9664\u6761\u4EF6",
  libraryWriteOnePerLine: "\u6BCF\u884C\u4E00\u9879\u3002",
  libraryWriteJsonHint: "\u4F7F\u7528\u6587\u6863\u4E2D\u7684\u6279\u91CF\u6216\u4F5C\u8005\u5B57\u6BB5\u586B\u5199 JSON \u6570\u7EC4\u3002",
  libraryWriteReview: "\u5BA1\u6838\u5199\u5165\u8BA1\u5212",
  libraryWritePending: "\u7B49\u5F85\u5BA1\u6279\u6216\u7ED3\u679C\u2026",
  libraryWriteDeclined: "\u5DF2\u62D2\u7EDD\uFF0C\u672A\u5199\u5165\u3002",
  libraryWriteUnverified: "\u63D0\u4EA4\u672A\u6838\u9A8C\uFF0C\u518D\u6B21\u63D0\u4EA4\u524D\u8BF7\u5148\u68C0\u67E5 Zotero\u3002",
  libraryWriteFailed: "\u5199\u5165\u5931\u8D25",
  libraryWriteApplied: "\u53D8\u66F4\u5DF2\u5E94\u7528",
  libraryWriteInvalid: "\u63D0\u4EA4\u524D\u8BF7\u68C0\u67E5\u5FC5\u586B\u5B57\u6BB5\u548C JSON \u6570\u7EC4\u3002",
  nav: "\u6587\u732E\u8F68\u8FF9",
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saveFailed: "\u672C\u90E8\u7F72\u6CA1\u6709\u63A5\u53D7\u8FD9\u4E9B\u503C\uFF0C\u5DF2\u4FDD\u7559\u4F9B\u4F60\u4FEE\u6539\u3002",
  unavailable: "\u672C\u90E8\u7F72\u6CA1\u6709\u63D0\u4F9B Zotero \u8BBE\u7F6E\u9879\uFF0C\u8FD9\u91CC\u6682\u65E0\u53EF\u914D\u7F6E\u5185\u5BB9\u3002",
  scholarlyDisabled: "\u5B66\u672F\u68C0\u7D22\u7531 dsh-zotero/scholarly \u7EC4\u4EF6\u63D0\u4F9B\u3002\u5728\u63D2\u4EF6\u5217\u8868\u7684\u300C\u5305\u542B\u7684\u7EC4\u4EF6\u300D\u4E2D\u542F\u7528\u8BE5\u7EC4\u4EF6\uFF0C\u5373\u542F\u7528\u5916\u90E8\u5B66\u672F\u68C0\u7D22\uFF1B\u6B64\u540E\u4F1A\u8BBF\u95EE\u5916\u90E8\u5B66\u672F\u7D22\u5F15\u3001DOI \u6CE8\u518C\u4E2D\u5FC3\u4E0E\u5F00\u653E\u83B7\u53D6\u67E5\u627E\u670D\u52A1\u3002\u7EC4\u4EF6\u672A\u542F\u7528\u65F6\u6B64\u5904\u4E0D\u53EF\u914D\u7F6E\u3002",
  invalidNumber: "\u8BF7\u586B\u6570\u5B57\uFF1B\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u9ED8\u8BA4\u503C\u3002",
  tabFeatures: "\u57FA\u7840\u8BBE\u7F6E",
  tabConnection: "\u672C\u5730\u8FDE\u63A5",
  tabSearch: "\u68C0\u7D22\u63D0\u53D6",
  tabLibrary: "\u6587\u732E\u9762\u677F",
  tabLibraryDesc: "Zotero \u6587\u732E\u9762\u677F\u4E0E\u5176\u53F3\u4FA7\u8FB9\u680F\u663E\u793A\u504F\u597D\u3002",
  libraryGuideTitle: "\u6587\u732E\u9762\u677F",
  libraryGuideDesc: "\u6D4F\u89C8 Zotero \u6587\u732E",
  tabScholarly: "\u5B66\u672F\u68C0\u7D22",
  tabScholarlyDesc: "dsh-zotero/scholarly \u7EC4\u4EF6\u63D0\u4F9B\u7684\u591A\u6E90\u5B66\u672F\u68C0\u7D22\u3001API \u5BC6\u94A5\u4E0E\u5168\u6587\u914D\u989D\u3002\u542F\u7528\u8BE5\u7EC4\u4EF6\u5373\u542F\u7528\u5916\u90E8\u68C0\u7D22\u3002",
  tabAdvanced: "\u9AD8\u7EA7\u9009\u9879",
  groupLibrarySidebar: "\u4FA7\u8FB9\u680F\u663E\u793A\u8BBE\u7F6E",
  groupLibrarySidebarDesc: "\u9009\u62E9\u662F\u5426\u5728 DeepSeek Harness \u53F3\u4FA7\u8FB9\u680F\u663E\u793A\u6587\u732E\u9762\u677F\u6807\u7B7E\u9875\u3002",
  libraryDisabled: "\u6587\u732E\u9762\u677F\u7531 dsh-zotero/library \u7EC4\u4EF6\u63D0\u4F9B\u3002\u5728\u63D2\u4EF6\u5217\u8868\u7684\u300C\u5305\u542B\u7684\u7EC4\u4EF6\u300D\u4E2D\u542F\u7528\u8BE5\u7EC4\u4EF6\uFF0C\u5373\u53EF\u5F00\u542F\u6587\u732E\u9762\u677F\u4E0E\u4FA7\u8FB9\u680F\u914D\u7F6E\u3002",
  rightSidebarEnabled: "\u5728\u53F3\u4FA7\u4FA7\u8FB9\u680F\u663E\u793A",
  rightSidebarHint: "\u5728\u53F3\u4FA7\u8FB9\u680F\u63D0\u4F9B\u6587\u732E\u9762\u677F\u6807\u7B7E\u9875\u4E0E\u5FEB\u6377\u5165\u53E3\uFF0C\u652F\u6301\u8FB9\u5BF9\u8BDD\u8FB9\u67E5\u9605\u6587\u732E\u3002",
  libraryNavTree: "\u76EE\u5F55",
  libraryNavList: "\u5217\u8868",
  libraryNavInspector: "\u8BE6\u60C5",
  configTabsLabel: "Zotero \u8BBE\u7F6E\u5206\u533A",
  groupWebDesc: "\u63A7\u5236\u4F1A\u8BDD\u9876\u90E8\u6587\u732E\u8F68\u8FF9\u6807\u7B7E\u9875\u7684\u663E\u793A\u3002",
  groupWriteDesc: "\u7BA1\u7406\u5BF9\u672C\u5730 Zotero \u6587\u5E93\u7684\u5199\u5165\u3001\u6388\u6743\u4E0E\u5B89\u5168\u95E8\u7981\u3002",
  groupDefaultsDesc: "\u8BBE\u5B9A\u751F\u6210\u5F15\u6587\u4E0E\u53C2\u8003\u6587\u732E\u65F6\u4F7F\u7528\u7684\u9ED8\u8BA4\u6837\u5F0F\u4E0E\u8BED\u8A00\u4EE3\u7801\u3002",
  groupConnectionDesc: "\u914D\u7F6E\u4E0E\u5F53\u524D\u8FD0\u884C\u7684\u672C\u673A Zotero \u5B9E\u4F8B\u7684 HTTP API \u901A\u4FE1\u53C2\u6570\u3002",
  groupSearchQuery: "\u68C0\u7D22\u4E0E\u5E76\u53D1",
  groupSearchQueryDesc: "\u68C0\u7D22\u6761\u6570\u914D\u989D\u3001\u641C\u7D22\u5E76\u53D1\u4E0E\u5168\u6587/\u56FE\u8C31\u68C0\u7D22\u4E0A\u9650\u3002",
  groupSearchEvidence: "\u7247\u6BB5\u4E0E\u5168\u6587\u63D0\u53D6",
  groupSearchEvidenceDesc: "\u539F\u6587\u7247\u6BB5\u957F\u5EA6\u3001\u6BB5\u843D\u6570\u3001\u7B14\u8BB0\u6B63\u6587\u53CA\u5168\u6587\u5207\u7247\u4E0A\u9650\u3002",
  groupScholarlyAuth: "\u6570\u636E\u6E90\u8EAB\u4EFD\u4E0E\u5BC6\u94A5",
  groupScholarlyAuthDesc: "\u914D\u7F6E\u90AE\u7BB1\u4EE5\u52A0\u5165 Polite Pool \u83B7\u5F97\u66F4\u4F18\u9650\u901F\u914D\u989D\uFF0C\u4EE5\u53CA\u53EF\u9009\u7684\u5916\u90E8\u5B66\u672F API \u5BC6\u94A5\u3002",
  groupScholarlyLimits: "\u5B66\u672F\u68C0\u7D22\u4E0E\u5168\u6587\u914D\u989D",
  groupScholarlyLimitsDesc: "\u5168\u7F51\u68C0\u7D22\u6700\u5927\u8FD4\u56DE\u7BC7\u6570\u4E0E\u5168\u6587\u63D0\u53D6\u5B57\u7B26\u4E0A\u9650\u3002",
  groupOutputDesc: "\u6570\u636E\u5E8F\u5217\u5316\u7F13\u51B2\u533A\u4E0E\u6279\u91CF\u5BFC\u51FA\u89C4\u6A21\u9650\u5236\u3002",
  groupJobsDesc: "\u8017\u65F6\u64CD\u4F5C\u7684\u540E\u53F0\u5F02\u6B65\u6267\u884C\u7B56\u7565\u4E0E\u8D85\u65F6\u81EA\u52A8\u63D0\u5347\u3002",
  groupDiagnosticsDesc: "\u672C\u5730\u6392\u9519\u4E0E\u8BE6\u7EC6\u8FD0\u884C\u65E5\u5FD7\u8F93\u51FA\u3002",
  scholarlyEmail: "\u8054\u7CFB\u90AE\u7BB1",
  scholarlyEmailHint: "\u9644\u52A0\u4E8E Crossref\u3001OpenAlex \u548C NCBI/Europe PMC \u8BF7\u6C42\u5934\uFF0C\u52A0\u5165 Polite Pool \u83B7\u5F97\u66F4\u9AD8\u9650\u901F\u914D\u989D\u3002",
  scholarlyS2Key: "Semantic Scholar API \u5BC6\u94A5",
  scholarlyS2KeyHint: "\u53EF\u9009\uFF1B\u907F\u514D\u5171\u4EAB IP \u6C60\u9650\u901F\u3002",
  scholarlyNcbiKey: "NCBI / PubMed API \u5BC6\u94A5",
  scholarlyNcbiKeyHint: "\u53EF\u9009\uFF1B\u5C06\u8BF7\u6C42\u4E0A\u9650\u4ECE\u6BCF\u79D2 3 \u6B21\u63D0\u5347\u81F3 10 \u6B21\u3002",
  scholarlyOpenalexKey: "OpenAlex API \u5BC6\u94A5",
  scholarlyOpenalexKeyHint: "\u53EF\u9009\uFF1B\u5C06\u8BF7\u6C42\u4E0A\u9650\u63D0\u5347\u81F3\u6BCF\u79D2 100 \u6B21\u3002",
  scholarlyMaxResults: "\u5355\u6B21\u68C0\u7D22\u8BBA\u6587\u6570\u4E0A\u9650",
  scholarlyMaxResultsHint: "\u5355\u6B21\u5168\u7F51\u68C0\u7D22\u8FD4\u56DE\u7684\u6700\u5927\u8BBA\u6587\u6570\u91CF\uFF081-100\uFF09\u3002",
  scholarlyMaxContentChars: "\u5168\u6587\u8BFB\u53D6\u5B57\u7B26\u6570\u4E0A\u9650",
  scholarlyMaxContentCharsHint: "\u5F00\u653E\u83B7\u53D6\u5168\u6587\u5206\u5757\u8BFB\u53D6\u7684\u5B57\u7B26\u6570\u4E0A\u9650\uFF081,000-50,000\uFF09\u3002",
  secretConfigured: "\u5DF2\u914D\u7F6E",
  secretNotConfigured: "\u672A\u914D\u7F6E",
  groupConnection: "\u8FDE\u63A5",
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
  maxAttachmentRecords: "\u9644\u4EF6\u6761\u6570\u4E0A\u9650",
  maxAttachmentRecordsHint: "\u5355\u4E2A\u6761\u76EE\u6700\u591A\u8FD4\u56DE\u7684\u9644\u4EF6\u6761\u6570\u3002",
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
  groupWeb: "\u6587\u732E\u8F68\u8FF9",
  webEnabled: "\u663E\u793A\u6587\u732E\u8F68\u8FF9",
  webEnabledHint: "\u5728\u4F1A\u8BDD\u9876\u90E8\u663E\u793A\u6587\u732E\u8F68\u8FF9\u6807\u7B7E\u9875\uFF1A\u672C\u4F1A\u8BDD\u4E2D Agent \u68C0\u7D22\u6216\u8BFB\u5230\u7684\u6587\u732E\u3001\u539F\u6587\u7247\u6BB5\u4E0E\u5BFC\u51FA\u3002",
  groupDiagnostics: "\u8BCA\u65AD",
  debug: "\u5F00\u542F\u8BCA\u65AD",
  debugHint: "\u5F00\u542F\u540E\u5728\u63D2\u4EF6\u8BE6\u60C5\u9875\u5E95\u90E8\u663E\u793A\u8BCA\u65AD\u8BB0\u5F55\u9762\u677F\uFF0C\u4FDD\u7559\u901A\u4FE1\u4E0E\u8C03\u7528\u6392\u969C\u65E5\u5FD7\uFF1B\u5173\u95ED\u65F6\u5B8C\u5168\u9690\u85CF\u8BCA\u65AD\u9762\u677F\u3002\u8BB0\u5F55\u4EC5\u4FDD\u5B58\u5728\u672C\u673A\u8FDB\u7A0B\u5185\u3002",
  diagnosticsTitle: "\u8BCA\u65AD",
  diagnosticsLogLabel: "\u8BCA\u65AD\u8BB0\u5F55",
  diagnosticsEmpty: "\u6682\u65E0\u8BB0\u5F55\u3002\u72B6\u6001\u53D8\u5316\u3001\u964D\u7EA7\u4E0E\u5931\u8D25\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  diagnosticsNoProblems: "\u5F53\u524D\u8BB0\u5F55\u4E2D\u6CA1\u6709\u8B66\u544A\u6216\u9519\u8BEF\u6761\u76EE\u3002",
  diagnosticsLevelAll: "\u5168\u90E8\u7EA7\u522B",
  diagnosticsLevelProblems: "\u4EC5\u95EE\u9898",
  diagnosticsShowLatest: "\u4EC5\u663E\u793A\u6700\u65B0 {shown} / {total} \u6761\u3002",
  diagnosticsCopyBundle: "\u590D\u5236\u8BCA\u65AD\u4FE1\u606F",
  diagnosticsDebugOn: "\u8BCA\u65AD\u6A21\u5F0F\uFF1A\u5F00",
  diagnosticsDebugOff: "\u8BCA\u65AD\u6A21\u5F0F\uFF1A\u5173",
  diagnosticsDetail: "\u8BE6\u60C5",
  diagnosticsFilterLabel: "\u7B5B\u9009\u65E5\u5FD7\u7EA7\u522B",
  jsonCopyValue: "\u590D\u5236\u503C",
  jsonCopyJson: "\u590D\u5236 JSON",
  jsonCopyPath: "\u590D\u5236\u8DEF\u5F84",
  jsonCopyPrettyJson: "\u590D\u5236\u683C\u5F0F\u5316 JSON",
  jsonCopyCompactJson: "\u590D\u5236\u7D27\u51D1 JSON",
  jsonCopyFailed: "\u590D\u5236\u5931\u8D25",
  jsonCollapseNode: "\u6298\u53E0\u8282\u70B9",
  jsonExpandNode: "\u5C55\u5F00\u8282\u70B9",
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
  diagnosisProviderUnavailable: "\u914D\u7F6E\u7684 Zotero \u63D0\u4F9B\u65B9\u672A\u6CE8\u518C\u3002\u8BF7\u5728\u63D2\u4EF6\u9875\u7684 dsh-zotero \u914D\u7F6E\u533A\u68C0\u67E5\u63D0\u4F9B\u65B9 ID\u3002",
  diagnosisCapabilityUnavailable: "\u5F53\u524D Zotero \u63D0\u4F9B\u65B9\u4E0D\u652F\u6301\u8BE5\u80FD\u529B\u3002\u8BF7\u5207\u6362\u63D0\u4F9B\u65B9\u6216\u542F\u7528\u5BF9\u5E94\u529F\u80FD\u3002",
  diagnosisUnknown: "\u8FDE\u63A5\u5F02\u5E38",
  renderFailed: "\u6E32\u67D3\u5931\u8D25",
  refresh: "\u5237\u65B0",
  lastCheckedLabel: "\u4E0A\u6B21\u68C0\u67E5",
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
  tipWebTab: "\u6253\u5F00\u300C\u663E\u793A\u6587\u732E\u8F68\u8FF9\u300D\u540E\uFF0C\u4F1A\u8BDD\u9876\u90E8\u51FA\u73B0\u6587\u732E\u8F68\u8FF9\u6807\u7B7E\u9875\uFF0C\u672C\u4F1A\u8BDD\u6D89\u53CA\u7684\u6587\u732E\u3001\u76F8\u5173\u7247\u6BB5\u4E0E\u5BFC\u51FA\u90FD\u5728\u5176\u4E2D\u3002",
  tipWriteGate: "\u667A\u80FD\u4F53\u8981\u5199\u7B14\u8BB0\u3001\u6807\u7B7E\u3001\u5408\u96C6\u6216\u6761\u76EE\uFF0C\u9700\u6253\u5F00\u300C\u5141\u8BB8\u5199\u5165\u300D\u5E76\u5728 Zotero \u5F39\u7A97\u4E2D\u6388\u6743\u3002",
  tipSettingsNav: "\u8FDE\u63A5\u3001\u7ED3\u679C\u4E0A\u9650\u4E0E\u5F15\u6587\u683C\u5F0F\u7684\u5B8C\u6574\u8BBE\u7F6E\u5728\u63D2\u4EF6\u9875\u7684 dsh-zotero \u914D\u7F6E\u533A\u3002",
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
  modeMetadata: "\u5143\u6570\u636E",
  modeEverything: "\u5143\u6570\u636E\u4E0E\u5168\u6587",
  overviewScopeLibrary: "\u6587\u732E\u5E93",
  overviewScopePublications: "\u6211\u7684\u51FA\u7248\u7269",
  overviewScopeCollection: "\u5408\u96C6",
  overviewScopeSavedSearch: "\u4FDD\u5B58\u7684\u68C0\u7D22",
  searchDetailOpen: "\u6280\u672F\u4FE1\u606F",
  searchDetailClose: "\u6536\u8D77\u6280\u672F\u4FE1\u606F",
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
  detailOmittedNote: "\u7ED3\u679C\u8D85\u51FA\u5361\u7247\u7684\u5B57\u8282\u9884\u7B97\uFF0C\u660E\u7EC6\u5DF2\u7701\u7565\uFF1B\u5B8C\u6574\u6570\u636E\u4FDD\u7559\u5728\u539F\u59CB\u7ED3\u679C\u4E2D\u3002",
  noSources: "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709 Zotero \u6587\u732E\u3002",
  searchEpisodeQueryLine: "\u68C0\u7D22\u300C{query}\u300D \xB7 {scope} \xB7 {mode}",
  searchEpisodeNoQueryLine: "\u6D4F\u89C8\u68C0\u7D22 \xB7 {scope} \xB7 {mode}",
  searchEpisodeFilterLine: "\u7B5B\u9009\uFF1A{filters}",
  searchEpisodeHitsLine: "\u547D\u4E2D {returned} \u6761\uFF08\u5171 {total} \u6761\uFF09",
  searchEpisodeHitsNoTotal: "\u547D\u4E2D {returned} \u6761",
  searchEpisodeNoteHits: "\u7B14\u8BB0\u547D\u4E2D {noteMatches} \u6761",
  databaseMismatch: "\u5C5E\u4E8E\u53E6\u4E00\u4E2A Zotero \u6570\u636E\u5E93",
  evidenceBadge: "\u7247\u6BB5 {count}",
  exportBadge: "\u5BFC\u51FA {count}",
  failedBadge: "\u5931\u8D25 {count}",
  runningBadge: "\u8FDB\u884C\u4E2D {count}",
  stoppedBadge: "\u5DF2\u505C\u6B62 {count}",
  badgePdf: "PDF",
  issuesBadge: "\u5F02\u5E38",
  copyRef: "\u590D\u5236Zotero\u94FE\u63A5",
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
  readPdf: "\u9605\u8BFB PDF",
  readPdfInSidebar: "\u5728\u4FA7\u8FB9\u680F\u9605\u8BFB",
  copyTitle: "\u590D\u5236\u6807\u9898",
  copyTitleTooltip: "\u7C98\u8D34\u5230 Zotero \u5FEB\u6377\u641C\u7D22\uFF08Cmd/Ctrl+F\uFF09\u5373\u53EF\u5B9A\u4F4D\u6761\u76EE",
  copyZoteroLink: "\u590D\u5236\u94FE\u63A5",
  copyZoteroLinkTooltip: "\u89C4\u8303 Zotero \u6DF1\u94FE\uFF0C\u53EF\u7C98\u8D34\u5230\u5916\u90E8\u7B14\u8BB0\u6216\u5730\u5740\u680F",
  openInZotero: "\u5728 Zotero \u4E2D\u6253\u5F00",
  openInZoteroTooltip: "\u5728\u672C\u5730 Zotero \u684C\u9762\u5BA2\u6237\u7AEF\u4E2D\u6253\u5F00\u5E76\u5B9A\u4F4D\u6B64\u6761\u76EE",
  libraryMenuRefresh: "\u5237\u65B0\u6587\u5E93\u6570\u636E",
  deliverableOpenLibrary: "\u5728 Zotero \u9762\u677F\u4E2D\u67E5\u770B",
  pdfResolving: "\u6B63\u5728\u5B9A\u4F4D\u9644\u4EF6\u2026",
  pdfFileNotFound: "\u672A\u627E\u5230\u672C\u5730 PDF \u6587\u4EF6",
  instanceUnverified: "\u65E0\u6CD5\u9A8C\u8BC1\u5F53\u524D Zotero \u5B9E\u4F8B",
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
  toolTitleRetrieve: "Zotero \u68C0\u7D22\u539F\u6587\u7247\u6BB5",
  toolTitleExport: "Zotero \u5BFC\u51FA\u5F15\u6587",
  toolTitleGet: "Zotero \u6587\u732E\u8BE6\u60C5",
  toolTitleChildren: "Zotero \u5B50\u9879\u4E0E\u9644\u4EF6",
  toolTitleAttachment: "Zotero \u9644\u4EF6",
  toolTitleCreateNote: "Zotero \u521B\u5EFA\u7B14\u8BB0",
  toolTitleBatchItems: "Zotero \u6279\u91CF\u6761\u76EE\u64CD\u4F5C",
  toolTitleUpdateItemTags: "Zotero \u66F4\u65B0\u6761\u76EE\u6807\u7B7E",
  toolTitleUpdateItemCollections: "Zotero \u66F4\u65B0\u6761\u76EE\u5408\u96C6",
  toolTitleCreateCollection: "Zotero \u521B\u5EFA\u5408\u96C6",
  toolTitleDeleteCollection: "Zotero \u5220\u9664\u5408\u96C6",
  toolTitleCreateItem: "Zotero \u521B\u5EFA\u6761\u76EE",
  toolTitleUpdateItem: "Zotero \u66F4\u65B0\u6761\u76EE",
  toolTitleUpdateNote: "Zotero \u66F4\u65B0\u7B14\u8BB0",
  badgePartial: "\u90E8\u5206\u5B8C\u6210",
  toolTitleUpdateCollection: "Zotero \u66F4\u65B0\u5408\u96C6",
  toolTitleRestoreItems: "Zotero \u6062\u590D\u6761\u76EE",
  toolTitleCreateSavedSearch: "Zotero \u521B\u5EFA\u5DF2\u5B58\u641C\u7D22",
  toolTitleUpdateSavedSearch: "Zotero \u66F4\u65B0\u5DF2\u5B58\u641C\u7D22",
  toolTitleDeleteSavedSearch: "Zotero \u5220\u9664\u5DF2\u5B58\u641C\u7D22",
  toolTitleScholarlySave: "\u4FDD\u5B58\u5B66\u672F\u7ED3\u679C\u5230 Zotero",
  toolSummaryUpdateNote: '\u5DF2\u66F4\u65B0\u7B14\u8BB0 "{title}"',
  toolSummaryUpdateCollection: '\u5DF2\u66F4\u65B0\u5408\u96C6 "{name}"',
  toolSummaryRestoreItems: "\u5DF2\u6062\u590D {restored} \u4E2A\u6761\u76EE\uFF1B{failed} \u4E2A\u5931\u8D25",
  toolSummaryRestoreItemsRequested: "\u8BF7\u6C42\u6062\u590D {count} \u4E2A\u6761\u76EE",
  toolSummaryCreateSavedSearch: '\u5DF2\u521B\u5EFA\u5DF2\u5B58\u641C\u7D22 "{name}"',
  toolSummaryUpdateSavedSearch: '\u5DF2\u66F4\u65B0\u5DF2\u5B58\u641C\u7D22 "{name}"',
  toolSummaryDeleteSavedSearch: '\u5DF2\u5220\u9664\u5DF2\u5B58\u641C\u7D22 "{name}"',
  toolSummaryScholarlySave: '\u5DF2\u5C06\u5B66\u672F\u7ED3\u679C "{title}" \u4FDD\u5B58\u5230 Zotero',
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
  toolOmittedPassages: "\u53E6\u6709 {count} \u6761\u539F\u6587\u7247\u6BB5\u672A\u5728\u6B64\u5217\u51FA\u3002",
  toolInspect: "\u68C0\u67E5\u8C03\u7528",
  toolSearchRunning: "\u6B63\u5728\u68C0\u7D22 Zotero \u6587\u732E\u5E93\u2026",
  toolRetrieveRunning: "\u6B63\u5728\u68C0\u7D22\u539F\u6587\u7247\u6BB5\u2026",
  toolExportRunning: "\u6B63\u5728\u5BFC\u51FA\u5F15\u6587\u2026",
  toolSummaryFound: "\u627E\u5230 {count} \u7BC7\u6587\u732E",
  toolSummaryFoundWithNotes: "\u627E\u5230 {count} \u7BC7\u6587\u732E (+{notes} \u6761\u7B14\u8BB0)",
  toolSummaryEvidence: "\u63D0\u53D6 {count} \u6761\u539F\u6587\u7247\u6BB5",
  toolSummaryExport: "\u5BFC\u51FA {format} ({count} \u7BC7)",
  toolSummaryItem: "{title} ({year})",
  toolSummaryChildren: "{count} \u4E2A\u5B50\u5BF9\u8C61",
  toolSummaryAttachment: "\u9644\u4EF6: {title}",
  toolSummaryCreateNote: '\u5DF2\u521B\u5EFA\u7B14\u8BB0 "{title}"',
  toolSummaryBatchItems: "\u8BF7\u6C42\u65B0\u5EFA {creates} \u9879\u3001\u66F4\u65B0 {updates} \u9879\u3001\u79FB\u5165\u56DE\u6536\u7AD9 {deletes} \u9879",
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
  statusLocalApiAddress: "\u672C\u5730 API \u5730\u5740",
  libraryPanel: "\u6587\u732E\u9762\u677F\u5BFC\u822A",
  librarySelectLibrary: "\u6587\u732E\u5E93",
  librarySearchLabel: "\u641C\u7D22",
  librarySearchPlaceholder: "\u641C\u7D22\u6807\u9898\u3001\u4F5C\u8005\u3001\u5E74\u4EFD\u2026",
  librarySearchModeLabel: "\u6A21\u5F0F",
  librarySearchModeMetadata: "\u6807\u9898/\u4F5C\u8005",
  librarySearchModeEverything: "\u5168\u6587",
  libraryEverythingHint: "\u68C0\u7D22 PDF \u6B63\u6587\uFF0C\u4F9D\u8D56 Zotero \u672C\u5730\u7D22\u5F15",
  librarySortLabel: "\u6392\u5E8F",
  librarySortAsc: "\u5347\u5E8F",
  librarySortDesc: "\u964D\u5E8F",
  librarySortDateModified: "\u4FEE\u6539\u65F6\u95F4",
  librarySortDateAdded: "\u6DFB\u52A0\u65F6\u95F4",
  librarySortDate: "\u51FA\u7248\u65E5\u671F",
  librarySortTitle: "\u6807\u9898",
  librarySortCreator: "\u4F5C\u8005",
  libraryStatusLabel: "\u8FDE\u63A5",
  libraryConnected: "\u5DF2\u8FDE\u63A5",
  libraryOffline: "\u672A\u8FDE\u63A5",
  libraryAllItems: "\u5168\u90E8\u6761\u76EE",
  libraryPublications: "\u6211\u7684\u51FA\u7248\u7269",
  libraryTrash: "\u56DE\u6536\u7AD9",
  libraryCollections: "\u96C6\u5408",
  libraryNoCollections: "\u6682\u65E0\u96C6\u5408",
  librarySavedSearches: "\u4FDD\u5B58\u7684\u641C\u7D22",
  libraryNoSavedSearches: "\u6682\u65E0\u4FDD\u5B58\u7684\u641C\u7D22",
  libraryItemList: "\u6761\u76EE\u5217\u8868",
  libraryLoading: "\u52A0\u8F7D\u4E2D\u2026",
  libraryEmptyList: "\u6B64\u8303\u56F4\u6682\u65E0\u6761\u76EE",
  libraryNoMatches: "\u6CA1\u6709\u5339\u914D\u5F53\u524D\u7B5B\u9009\u7684\u6761\u76EE",
  libraryRangeOfTotal: "\u7B2C {start}\u2013{end} \u6761\uFF0C\u5171 {total} \u6761",
  libraryPagePrev: "\u4E0A\u4E00\u9875",
  libraryPageNext: "\u4E0B\u4E00\u9875",
  libraryRetry: "\u91CD\u8BD5",
  libraryFilters: "\u7B5B\u9009",
  libraryFilterTypes: "\u6761\u76EE\u7C7B\u578B",
  libraryFilterTags: "\u6807\u7B7E",
  libraryTagMatch: "\u6807\u7B7E\u5339\u914D",
  libraryTagAll: "\u5305\u542B\u5168\u90E8\u6807\u7B7E",
  libraryTagAny: "\u5305\u542B\u4EFB\u4E00\u6807\u7B7E",
  libraryYearFrom: "\u8D77\u59CB\u5E74\u4EFD\uFF08\u542B\uFF09",
  libraryYearTo: "\u7ED3\u675F\u5E74\u4EFD\uFF08\u542B\uFF09",
  libraryYearLabel: "\u5E74\u4EFD",
  libraryYearFromShort: "\u8D77\u59CB",
  libraryYearToShort: "\u7ED3\u675F",
  libraryFilterRemove: "\u79FB\u9664 {label}",
  libraryTagRemove: "\u79FB\u9664\u6807\u7B7E {tag}",
  librarySearchTags: "\u641C\u7D22\u6807\u7B7E",
  libraryLoadMore: "\u52A0\u8F7D\u66F4\u591A",
  libraryYearRangeInvalid: "\u8D77\u59CB\u5E74\u4EFD\u4E0D\u80FD\u665A\u4E8E\u7ED3\u675F\u5E74\u4EFD",
  libraryAnnotationPage: "\u7B2C {page} \u9875",
  libraryAttachmentFilter: "\u9644\u4EF6\u6761\u4EF6",
  libraryFilterAny: "\u4E0D\u9650",
  libraryHasAttachment: "\u6709\u9644\u4EF6",
  libraryNoAttachment: "\u65E0\u9644\u4EF6",
  libraryClearFilters: "\u6E05\u9664\u7B5B\u9009",
  librarySearchConditions: "\u4FDD\u5B58\u7684\u6761\u4EF6",
  libraryInvalidPage: "\u5206\u9875\u6E38\u6807\u65E0\u6548",
  libraryOfflineNote: "Zotero \u672A\u8FDE\u63A5\uFF0C\u9762\u677F\u5DF2\u6682\u505C\u68C0\u7D22\u3002\u8BF7\u786E\u8BA4 Zotero \u6B63\u5728\u8FD0\u884C\u540E\u70B9\u51FB\u5237\u65B0\u3002",
  libraryInspector: "\u6761\u76EE\u8BE6\u60C5",
  libraryNoSelection: "\u9009\u62E9\u4E00\u4E2A\u6761\u76EE\u67E5\u770B\u8BE6\u60C5",
  libraryAskInChat: "\u63D0\u95EE",
  libraryAddToChat: "\u52A0\u5165\u5BF9\u8BDD",
  libraryExpand: "\u5C55\u5F00",
  libraryCollapse: "\u6536\u8D77",
  libraryInfoTitle: "\u4FE1\u606F",
  libraryAskTemplate: "\u8BF7\u56F4\u7ED5\u6587\u732E\u300A{title}\u300B\uFF08{ref}\uFF09\u56DE\u7B54\u6211\u7684\u95EE\u9898\uFF1A",
  libraryAskPrompt: 'Please refer to the paper "{title}" ({ref}) and answer questions based on its contents.',
  libraryCiteLine: "\u300A{title}\u300B\uFF08{ref}\uFF09",
  libraryMetaType: "\u7C7B\u578B",
  libraryMetaCreators: "\u4F5C\u8005",
  libraryMetaDate: "\u65E5\u671F",
  libraryMetaVenue: "\u6765\u6E90",
  libraryMetaDoi: "DOI",
  libraryMetaUrl: "\u94FE\u63A5",
  libraryMetaCollections: "\u6240\u5C5E\u96C6\u5408",
  libraryMetaTags: "\u6807\u7B7E",
  libraryMetaExtra: "\u9644\u52A0",
  libraryMetaAbstract: "\u6458\u8981",
  libraryMetaNote: "\u7B14\u8BB0",
  libraryAbstractTruncated: "\u5185\u5BB9\u8FC7\u957F\uFF0C\u5DF2\u622A\u65AD\u663E\u793A\u3002",
  libraryNotesTitle: "\u7B14\u8BB0\uFF08{count}\uFF09",
  libraryAttachmentsTitle: "\u9644\u4EF6\uFF08{count}\uFF09",
  libraryAnnotationsTitle: "\u6807\u6CE8\uFF08{count}\uFF09",
  libraryAnnotationPageBadge: "P. {page}",
  libraryCitationMenu: "\u5BFC\u51FA\u5F15\u7528",
  libraryMoreActions: "\u66F4\u591A\u64CD\u4F5C",
  libraryCopyQuote: "\u590D\u5236\u5F15\u6587",
  libraryCopyNote: "\u590D\u5236\u7B14\u8BB0",
  libraryCopyCitation: "\u590D\u5236\u5F15\u7528",
  libraryCopyCitationDone: "\u5DF2\u590D\u5236\u5F15\u7528",
  libraryCopyBibtex: "BibTeX",
  libraryCopyBibtexDone: "\u5DF2\u590D\u5236 BibTeX",
  libraryCopyMoreFormats: "\u66F4\u591A\u683C\u5F0F",
  libraryCopyBibliography: "\u53C2\u8003\u6587\u732E\u8868",
  libraryCopyBibliographyDone: "\u5DF2\u590D\u5236\u53C2\u8003\u6587\u732E\u8868",
  libraryCopyBiblatex: "BibLaTeX",
  libraryCopyBiblatexDone: "\u5DF2\u590D\u5236 BibLaTeX",
  libraryCopyRis: "RIS",
  libraryCopyRisDone: "\u5DF2\u590D\u5236 RIS",
  libraryCopyCsljson: "CSL-JSON",
  libraryCopyCsljsonDone: "\u5DF2\u590D\u5236 CSL-JSON",
  libraryCopyItemInfo: "\u590D\u5236\u6761\u76EE\u4FE1\u606F",
  libraryCopyItemInfoDone: "\u5DF2\u590D\u5236\u6761\u76EE\u4FE1\u606F",
  libraryExportPending: "\u6B63\u5728\u751F\u6210\u2026",
  libraryCopyFailed: "\u590D\u5236\u5931\u8D25\uFF1A{message}",
  libraryCopyCitationEmpty: "\u5BBF\u4E3B\u672A\u8FD4\u56DE\u5F15\u7528\u6587\u672C\u3002",
  libraryCopyClipboardUnavailable: "\u526A\u8D34\u677F\u4E0D\u53EF\u7528\u3002",
  libraryInsertQuote: "\u5F15\u7528\u5230\u5BF9\u8BDD",
  libraryInsertNote: "\u5F15\u7528\u7B14\u8BB0\u5230\u5BF9\u8BDD",
  librarySectionCollapse: "\u6536\u8D77{title}",
  librarySectionExpand: "\u5C55\u5F00{title}",
  libraryNoSessionForOpen: "\u5F53\u524D\u6CA1\u6709\u4F1A\u8BDD\uFF0C\u65E0\u6CD5\u5728\u53F3\u4FA7\u9605\u8BFB\u680F\u6253\u5F00\u672C\u5730\u9644\u4EF6\u3002"
};

// src/client/index.ts
var NS = "zotero";
var inject = [
  "locale",
  "slots",
  "remote",
  "configForms",
  "uiConversation",
  "sidebarRight",
  "sidebarRightTabs"
];
var REGISTRANT2 = ZOTERO_REMOTE_PACKAGE;
function isZoteroRegistration(_key, registration) {
  if (registration !== null && typeof registration === "object") {
    const registrant = registration.registrant;
    if (registrant === REGISTRANT2) return true;
  }
  return false;
}
function registerSharedSurfaces(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-zotero: page dictionaries");
  ctx.effect(() => () => clearLibrarySessionMemory(), "dsh-zotero: library session views");
  ctx.effect(() => {
    const resolver = (ref) => ctx.remote.zotero.resolveAttachment(ref);
    setAttachmentResolver(resolver);
    return () => {
      if (getAttachmentResolver() === resolver) {
        setAttachmentResolver(void 0);
      }
    };
  }, "dsh-zotero: attachment resolver");
  ctx.effect(() => {
    const dispatcher = async (url) => {
      try {
        const res = await ctx.remote.zotero.openProtocol(url);
        return res.ok && res.value.ok;
      } catch {
        return false;
      }
    };
    setProtocolDispatcher(dispatcher);
    return () => {
      if (getProtocolDispatcher() === dispatcher) {
        setProtocolDispatcher(void 0);
      }
    };
  }, "dsh-zotero: protocol dispatcher");
  const reporter = (report) => ctx.remote.zotero.reportClientError(report);
  ctx.effect(() => {
    setErrorReporter(reporter);
    return () => {
      if (getErrorReporter() === reporter) {
        setErrorReporter(void 0);
      }
    };
  }, "dsh-zotero: error reporter");
  ctx.effect(
    () => ctx.slots.onEntryError((key, registration, error, info) => {
      if (!isZoteroRegistration(key, registration)) return;
      reportCrashedSurface(key, error, { kind: "slotEntry", abdicated: info.abdicated }, reporter);
    }),
    "dsh-zotero: slot crash intake"
  );
  registerZoteroToolviews(ctx);
}
function registerPluginManagerSurfaces(ctx, surfaces) {
  const { card, scholarlyCard, libraryCard, probe } = surfaces;
  ctx.slots.inject(
    "plugins.bundle.activation",
    () => ctx.slots.register(
      {
        name: "plugins.bundle.activation",
        key: ZOTERO_REMOTE_PACKAGE,
        locale: NS,
        registrant: REGISTRANT2,
        inject: () => ({ probe })
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
        locale: NS,
        registrant: REGISTRANT2,
        inject: () => {
          const zoteroFace = card.inject();
          const scholarlyFace = scholarlyCard.inject();
          const libraryFace = libraryCard.inject();
          return {
            ...zoteroFace,
            hooks: {
              zoteroCard: zoteroFace.hooks.zoteroCard,
              scholarlyCard: scholarlyFace.hooks.scholarlyCard,
              libraryCard: libraryFace.hooks.libraryCard
            },
            scholarly: scholarlyFace,
            library: libraryFace
          };
        }
      },
      ZoteroSettingsSection
    )
  );
  ctx.effect(
    () => ctx.configForms.whileServed(
      [SCHOLARLY_SETTINGS_NAMESPACE],
      () => ctx.slots.inject(
        "plugins.row.config",
        () => ctx.slots.register(
          {
            name: "plugins.row.config",
            key: `${ZOTERO_REMOTE_PACKAGE}#scholarly`,
            locale: NS,
            registrant: REGISTRANT2,
            inject: () => scholarlyCard.inject()
          },
          ScholarlySettingsSection
        )
      )
    ),
    "dsh-zotero: scholarly row config"
  );
  ctx.effect(
    () => ctx.configForms.whileServed(
      [ZOTERO_LIBRARY_SETTINGS_NAMESPACE],
      () => ctx.slots.inject(
        "plugins.row.config",
        () => ctx.slots.register(
          {
            name: "plugins.row.config",
            key: `${ZOTERO_REMOTE_PACKAGE}#library`,
            locale: NS,
            registrant: REGISTRANT2,
            inject: () => libraryCard.inject()
          },
          LibrarySettingsSection
        )
      )
    ),
    "dsh-zotero: library row config"
  );
  ctx.slots.inject(
    "plugins.detail.section",
    () => ctx.slots.register(
      {
        name: "plugins.detail.section",
        id: "zotero-status",
        locale: NS,
        registrant: REGISTRANT2,
        inject: () => ({ probe })
      },
      ZoteroPluginDetailSection
    )
  );
  const diagnostics = () => ctx.remote.zotero.diagnostics();
  ctx.slots.inject(
    "plugins.detail.section",
    () => ctx.slots.register(
      {
        name: "plugins.detail.section",
        id: "zotero-diagnostics",
        locale: NS,
        registrant: REGISTRANT2,
        inject: () => ({ probe, diagnostics })
      },
      DiagnosticsCard
    )
  );
}
function registerCommandInputSurfaces(ctx) {
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
        locale: NS,
        registrant: REGISTRANT2
      },
      ZoteroCommandInputView
    )
  );
}
function registerConversationSurfaces(ctx, surfaces) {
  const { form, probe } = surfaces;
  ctx.slots.inject(
    "conversation.chat.commandview",
    () => ctx.slots.register(
      {
        name: "conversation.chat.commandview",
        key: "zotero",
        locale: NS,
        registrant: REGISTRANT2,
        inject: () => ({ probe })
      },
      ZoteroCommandCard
    )
  );
  const tabT = ctx.locale.bind(NS);
  registerGatedSurfaces(
    ctx,
    "dsh-zotero: conversation tab",
    (onChange) => watchWebEnabled(form, onChange),
    () => {
      return ctx.slots.inject(
        "conversation.view",
        () => ctx.slots.register(
          {
            name: "conversation.view",
            id: "zotero",
            order: 30,
            locale: NS,
            registrant: REGISTRANT2,
            label: () => tabT("nav"),
            // Read through the mutable binding, so a probe that arrives after
            // the tab was mounted is the one the strip actually calls.
            inject: () => ({
              status: () => probe(),
              resolveAttachment: (ref) => ctx.remote.zotero.resolveAttachment(ref),
              // The tab owns the Session identity and the workspace root it
              // resolves against (`useSessions`), so it builds the whole
              // address and hands the entry a ready URL. This fiber cannot do
              // it: on the browser side the `ctx.sessions` Context key carries
              // the host `SessionStore`, not the client `ISessions` catalog.
              openResource: (url, options) => ctx.sidebarRight.openResource(url, options)
            })
          },
          SourcesTab
        )
      );
    }
  );
}
function sidebarEnabledOf(form, libraryForm, key) {
  const snapshot = libraryForm.getSnapshot();
  const ownSwitchOn = snapshot.status !== "ready" || snapshot.value?.[key] !== false;
  return webEnabledOf(form) && ownSwitchOn;
}
function registerLibraryPanelSurfaces(ctx, surfaces) {
  const { form, libraryForm, probe } = surfaces;
  const panelT = ctx.locale.bind(NS);
  const plane = createLibraryDataPlane({
    collectionPath: (request) => ctx.remote.zotero.collectionPath(request),
    browse: (request) => ctx.remote.zotero.browse(request),
    search: (request) => ctx.remote.zotero.search(request),
    item: (request) => ctx.remote.zotero.item(request),
    childPage: (request) => ctx.remote.zotero.childPage(request),
    export: (request) => ctx.remote.zotero.export(request)
  });
  const refreshBindings = /* @__PURE__ */ new Map();
  const refreshKey = (sessionId, tabId) => JSON.stringify([sessionId, tabId]);
  const bindRefresh = (sessionId, tabId, refresh) => {
    const key = refreshKey(sessionId, tabId);
    refreshBindings.set(key, refresh);
    return () => {
      if (refreshBindings.get(key) === refresh) refreshBindings.delete(key);
    };
  };
  const panelFace = () => ({
    bindRefresh,
    status: () => probe(),
    collectionPath: (request) => plane.collectionPath(request),
    browse: (request) => plane.browse(request),
    search: (request) => plane.search(request),
    item: (request) => plane.item(request),
    childPage: (request) => plane.childPage(request),
    invalidate: plane.invalidate,
    setInstance: plane.setInstance,
    export: (request) => plane.export(request),
    write: (request) => ctx.remote.zotero.write(request),
    resolveAttachment: (ref) => ctx.remote.zotero.resolveAttachment(ref),
    openResource: (url) => ctx.sidebarRight.openResource(url)
  });
  const mountRight = () => {
    const TAB_ID = `${ZOTERO_REMOTE_PACKAGE}#library`;
    const TAB_KIND = "zotero-library";
    const disposeTabDef = ctx.sidebarRightTabs?.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => panelT("tabLibrary"),
      guide: [
        {
          id: "zotero-library-guide",
          order: 25,
          title: () => panelT("libraryGuideTitle"),
          description: () => panelT("libraryGuideDesc"),
          icon: ZoteroLibraryIcon
        }
      ]
    });
    const disposeTabBody = ctx.slots.inject(
      "sidebar.right.pane.tab",
      () => ctx.slots.register(
        {
          name: "sidebar.right.pane.tab",
          key: TAB_ID,
          locale: NS,
          registrant: REGISTRANT2,
          inject: panelFace
        },
        ZoteroLibraryPanel
      )
    );
    const disposeTabTitle = ctx.slots.inject(
      "sidebar.right.pane.tab.title",
      () => ctx.slots.register(
        {
          name: "sidebar.right.pane.tab.title",
          key: TAB_ID,
          locale: NS,
          registrant: REGISTRANT2
        },
        () => panelT("tabLibrary")
      )
    );
    const disposeTabMenu = ctx.slots.inject(
      "sidebar.right.tab.menu.item",
      () => ctx.slots.register(
        {
          name: "sidebar.right.tab.menu.item",
          id: `${REGISTRANT2}.library.menu`,
          order: 200,
          locale: NS,
          registrant: REGISTRANT2,
          inject: () => ({
            onRefresh: (sessionId, tabId) => {
              const refresh = refreshBindings.get(refreshKey(sessionId, tabId));
              if (refresh) refresh();
              else plane.invalidate();
            }
          })
        },
        ZoteroLibraryMenu
      )
    );
    const disposeInputButton = ctx.slots.inject(
      "conversation.input.left",
      () => ctx.slots.register(
        {
          name: "conversation.input.left",
          id: `${REGISTRANT2}.composer.button`,
          order: 80,
          locale: NS,
          registrant: REGISTRANT2,
          inject: () => ({ onOpen: () => ctx.sidebarRight.openTab(TAB_KIND) })
        },
        ZoteroComposerSlot
      )
    );
    const disposeDeliverableAction = ctx.slots.inject(
      "deliverables.file.actions",
      () => ctx.slots.register(
        {
          name: "deliverables.file.actions",
          id: `${REGISTRANT2}.deliverables.action`,
          locale: NS,
          registrant: REGISTRANT2,
          inject: () => ({ onOpenLibrary: () => ctx.sidebarRight.openTab(TAB_KIND) })
        },
        DeliverableZoteroAction
      )
    );
    return () => {
      disposeDeliverableAction();
      disposeInputButton();
      disposeTabMenu();
      disposeTabTitle();
      disposeTabBody();
      refreshBindings.clear();
      disposeTabDef?.();
    };
  };
  ctx.effect(
    () => ctx.configForms.whileServed([ZOTERO_LIBRARY_SETTINGS_NAMESPACE], () => {
      const right = gatedMount(mountRight);
      const sync = () => {
        right.sync(sidebarEnabledOf(form, libraryForm, "rightSidebarEnabled"));
      };
      const unsubscribeForm = form.subscribe(sync);
      const unsubscribeLibrary = libraryForm.subscribe(sync);
      sync();
      return () => {
        unsubscribeForm();
        unsubscribeLibrary();
        right.dispose();
      };
    }),
    "dsh-zotero: library right-sidebar surface"
  );
}
function registerUi(ctx) {
  registerSharedSurfaces(ctx);
  registerCommandInputSurfaces(ctx);
  const form = ctx.configForms.get(ZOTERO_SETTINGS_NAMESPACE);
  const scholarlyForm = ctx.configForms.get(SCHOLARLY_SETTINGS_NAMESPACE);
  const libraryForm = ctx.configForms.get(
    ZOTERO_LIBRARY_SETTINGS_NAMESPACE
  );
  const card = new ZoteroCardController(form);
  const scholarlyCard = new ScholarlyFormController(scholarlyForm);
  const libraryCard = new LibraryFormController(libraryForm);
  ctx.effect(
    () => () => {
      card.dispose();
      scholarlyCard.dispose();
      libraryCard.dispose();
    },
    "dsh-zotero: card forms"
  );
  let inFlightProbe;
  const probe = () => {
    if (inFlightProbe !== void 0) return inFlightProbe;
    const task = ctx.remote.zotero.status().finally(() => {
      if (inFlightProbe === task) inFlightProbe = void 0;
    });
    inFlightProbe = task;
    return task;
  };
  const surfaces = {
    form,
    card,
    scholarlyCard,
    libraryForm,
    libraryCard,
    probe
  };
  registerPluginManagerSurfaces(ctx, surfaces);
  registerConversationSurfaces(ctx, surfaces);
  registerLibraryPanelSurfaces(ctx, surfaces);
}
async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(ZOTERO_REMOTE);
  const ui = ctx.inject(
    [
      "remote.zotero",
      "locale",
      "slots",
      "configForms",
      "uiConversation",
      "sidebarRight",
      "sidebarRightTabs"
    ],
    registerUi
  );
  try {
    await ui;
  } catch (error) {
    await ui.dispose();
    await disposeRemote();
    throw error;
  }
  return async () => {
    await ui.dispose();
    await disposeRemote();
  };
}
return module.exports; } });
//# sourceMappingURL=client.js.map
