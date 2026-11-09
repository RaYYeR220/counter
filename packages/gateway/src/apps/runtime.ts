/**
 * Browser side of the MCP Apps bridge (ext-apps protocol 2026-01-26), written
 * by hand so each card stays a few kilobytes: JSON-RPC 2.0 over postMessage
 * with the host window, the same messages the ext-apps `App` class sends.
 *
 *   View -> Host  ui/initialize, ui/notifications/initialized,
 *                 ui/notifications/size-changed, tools/call, ui/open-link,
 *                 ui/message, ui/update-model-context
 *   Host -> View  ui/notifications/tool-input, ui/notifications/tool-result,
 *                 ui/notifications/tool-cancelled,
 *                 ui/notifications/host-context-changed, ping,
 *                 ui/resource-teardown
 *
 * Written as strings because they ship inside the card's HTML. Do not use
 * template literals or `${` in the browser code; the one substitution below is
 * the protocol version.
 */
export const APP_PROTOCOL_VERSION = "2026-01-26";

export const APP_BRIDGE_JS = String.raw`
function counterBridge(appName, handlers) {
  var parentWin = window.parent;
  var embedded = !!parentWin && parentWin !== window;
  var seq = 0;
  var pending = {};
  var bridge = { embedded: embedded, ready: false, hostCaps: {}, hostInfo: null, context: {} };

  function post(msg) {
    if (embedded) parentWin.postMessage(msg, "*");
  }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      if (!embedded) {
        reject(new Error("Open this in a chat client to continue."));
        return;
      }
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    });
  }
  function notify(method, params) {
    post({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  function applyContext(ctx) {
    if (!ctx || typeof ctx !== "object") return;
    for (var k in ctx) bridge.context[k] = ctx[k];
    var root = document.documentElement;
    if (ctx.theme === "light" || ctx.theme === "dark") {
      root.setAttribute("data-theme", ctx.theme);
      root.style.colorScheme = ctx.theme;
    }
    var vars = ctx.styles && ctx.styles.variables;
    if (vars && typeof vars === "object") {
      for (var name in vars) {
        if (/^--[a-z0-9-]+$/.test(name) && typeof vars[name] === "string") root.style.setProperty(name, vars[name]);
      }
    }
    var fonts = ctx.styles && ctx.styles.css && ctx.styles.css.fonts;
    if (typeof fonts === "string" && fonts && !document.getElementById("host-fonts")) {
      var st = document.createElement("style");
      st.id = "host-fonts";
      st.textContent = fonts;
      document.head.appendChild(st);
    }
    var inset = ctx.safeAreaInsets;
    if (inset && typeof inset === "object") {
      ["top", "right", "bottom", "left"].forEach(function (side) {
        if (typeof inset[side] === "number") root.style.setProperty("--safe-" + side, inset[side] + "px");
      });
    }
  }

  window.addEventListener("message", function (e) {
    if (!embedded || e.source !== parentWin) return;
    var m = e.data;
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return;

    if (typeof m.method !== "string") {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      if (m.error) p.reject(new Error((m.error && m.error.message) || "The request failed."));
      else p.resolve(m.result);
      return;
    }

    if (m.id !== undefined && m.id !== null) {
      if (m.method === "ping" || m.method === "ui/resource-teardown") {
        post({ jsonrpc: "2.0", id: m.id, result: {} });
      } else {
        post({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
      }
      return;
    }

    var params = m.params || {};
    if (m.method === "ui/notifications/tool-input") {
      if (handlers.onInput) handlers.onInput(params.arguments || {});
    } else if (m.method === "ui/notifications/tool-result") {
      if (handlers.onResult) handlers.onResult(params);
    } else if (m.method === "ui/notifications/tool-cancelled") {
      if (handlers.onCancel) handlers.onCancel(params.reason);
    } else if (m.method === "ui/notifications/host-context-changed") {
      applyContext(params);
    }
  });

  // Tell the host how tall the card is, the way the ext-apps App does.
  function watchSize() {
    var queued = false;
    var lastW = 0;
    var lastH = 0;
    function measure() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var root = document.documentElement;
        var prev = root.style.height;
        root.style.height = "max-content";
        var height = Math.ceil(root.getBoundingClientRect().height);
        root.style.height = prev;
        var width = Math.ceil(window.innerWidth);
        if (width !== lastW || height !== lastH) {
          lastW = width;
          lastH = height;
          notify("ui/notifications/size-changed", { width: width, height: height });
        }
      });
    }
    measure();
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(measure);
      ro.observe(document.documentElement);
      ro.observe(document.body);
    }
  }

  bridge.callTool = function (name, args) {
    return request("tools/call", { name: name, arguments: args || {} });
  };
  bridge.canCallTools = function () {
    return !!bridge.hostCaps.serverTools;
  };
  bridge.canMessage = function () {
    return !!bridge.hostCaps.message;
  };
  // Hands a link to the host. Returns false when the host cannot open it, so the
  // link's own target=_blank can be used instead.
  bridge.openLink = function (url) {
    if (bridge.hostCaps.openLinks) {
      return request("ui/open-link", { url: url }).then(
        function (r) { return !(r && r.isError); },
        function () { return false; }
      );
    }
    var oa = window.openai;
    if (oa && typeof oa.openExternal === "function") {
      try {
        oa.openExternal({ href: url });
        return Promise.resolve(true);
      } catch (e) {
        return Promise.resolve(false);
      }
    }
    return Promise.resolve(false);
  };
  bridge.handlesLinks = function () {
    var oa = window.openai;
    return !!bridge.hostCaps.openLinks || !!(oa && typeof oa.openExternal === "function");
  };
  bridge.sendMessage = function (text) {
    return request("ui/message", { role: "user", content: [{ type: "text", text: text }] });
  };
  bridge.updateContext = function (text) {
    if (!bridge.hostCaps.updateModelContext) return Promise.resolve(null);
    return request("ui/update-model-context", { content: [{ type: "text", text: text }] }).catch(function () {
      return null;
    });
  };

  if (embedded) {
    request("ui/initialize", {
      appInfo: { name: "counter-" + appName, version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline"] },
      protocolVersion: "${APP_PROTOCOL_VERSION}"
    }).then(
      function (r) {
        r = r || {};
        bridge.hostCaps = r.hostCapabilities || {};
        bridge.hostInfo = r.hostInfo || null;
        applyContext(r.hostContext || {});
        bridge.ready = true;
        notify("ui/notifications/initialized", {});
        watchSize();
        if (handlers.onReady) handlers.onReady();
      },
      function () {
        if (handlers.onReady) handlers.onReady();
      }
    );
  }
  return bridge;
}
`;

/** Tiny element builder. Text always goes in as text nodes, never as HTML. */
export const APP_DOM_JS = String.raw`
function h(tag, props) {
  var el = document.createElement(tag);
  if (props) {
    for (var k in props) {
      var v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = String(v);
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (var i = 2; i < arguments.length; i++) put(el, arguments[i]);
  return el;
}
function put(el, c) {
  if (c === undefined || c === null || c === false) return;
  if (Array.isArray(c)) {
    for (var i = 0; i < c.length; i++) put(el, c[i]);
    return;
  }
  el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
}
function mount(root, node) {
  while (root.firstChild) root.removeChild(root.firstChild);
  put(root, node);
}
`;
