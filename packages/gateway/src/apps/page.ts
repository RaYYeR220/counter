import { APP_MODEL_JS } from "./model";
import { APP_BRIDGE_JS, APP_DOM_JS } from "./runtime";
import { APP_CSS } from "./styles";

/** Placeholder shown until the host sends the tool result, shaped like a card. */
const SKELETON = `<article class="card" aria-busy="true" aria-label="Loading">
<div class="sec"><span class="sk w25"></span><span class="sk tall w60"></span></div>
<div class="sec"><span class="sk w80"></span><span class="sk w60"></span><span class="sk w40"></span></div>
<div class="sec"><span class="sk w40"></span></div>
</article>`;

/** Wires the bridge, the view model and one card's view together. */
function shellJs(app: string): string {
  return String.raw`
(function () {
  var root = document.getElementById("app");
  var view = null;
  var ui = {
    model: counterModel(),
    bridge: null,
    mount: function (node) { mount(root, node); },
    focus: function (match) {
      var els = root.querySelectorAll("button, a");
      for (var i = 0; i < els.length; i++) if (match(els[i])) { els[i].focus(); return; }
    },
    fail: function (title, message, issues) {
      mount(root, h("article", { class: "card" },
        h("section", { class: "sec" },
          h("h1", { class: "title", text: title }),
          message ? h("p", { class: "desc", text: message }) : null,
          issues && issues.length ? h("ul", { class: "issues bad gap" }, issues.map(function (t) { return h("li", { text: t }); })) : null)));
    }
  };
  ui.bridge = counterBridge(${JSON.stringify(app)}, {
    onInput: function (a) { if (view && view.onInput) view.onInput(a); },
    onResult: function (r) { if (view) view.onResult(r || {}); },
    onCancel: function () { ui.fail("Cancelled", "The call stopped before it finished."); }
  });
  view = counterView(ui);
  if (!ui.bridge.embedded) {
    ui.fail("Counter", "This card shows inside a chat client that supports MCP Apps.");
  }
})();
`;
}

/** A self-contained card: inline CSS and JS, nothing loaded from anywhere. */
export function appPage(app: string, title: string, viewJs: string): string {
  const script = [APP_MODEL_JS, APP_BRIDGE_JS, APP_DOM_JS, viewJs, shellJs(app)].join("\n");
  if (/<\/script/i.test(script)) throw new Error(`The ${app} card's script must not contain a closing script tag`);
  return `<!doctype html>
<html lang="en" data-counter-app="${app}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>${APP_CSS}</style>
</head>
<body>
<main id="app">${SKELETON}</main>
<script>${script}</script>
</body>
</html>
`;
}
