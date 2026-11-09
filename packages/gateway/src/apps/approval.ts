/**
 * Approval card for `checkout` and `order_status`. While PayPal waits on the
 * buyer it offers "Approve in PayPal" (the host opens approve_url) and, once
 * they are back, "I approved — finish the order", which asks the host to call
 * `checkout` again for the same cart. Then it shows the order number and the
 * shop's order page, or the shop's own words when the cart cannot be bought.
 */
export const APPROVAL_VIEW_JS = String.raw`
function counterView(ui) {
  var M = ui.model;
  var B = ui.bridge;
  var args = {};
  var state = null;
  var busy = false;
  var asked = false;
  var note = "";
  var noteTone = "";

  function icon(d) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  }
  var LOCK = "M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z";
  var CHECK = "M3.5 8.5l3 3 6-7";
  var OUT = "M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5";

  function lines(cart) {
    var items = (cart && cart.items) || [];
    var shown = items.slice(0, 3).map(function (i) {
      var n = M.splitName(i.name || i.variant_id);
      return h(
        "li",
        { class: "row" },
        h("span", { class: "k" }, i.quantity + " × " + n.title, n.detail ? h("span", { class: "sub", text: M.cap(n.detail) }) : null),
        h("span", { class: "v num", text: i.line_total ? M.money(i.line_total) : "" })
      );
    });
    if (items.length > 3) shown.push(h("li", { class: "row muted" }, h("span", { class: "k", text: "and " + (items.length - 3) + " more" })));
    return shown.length ? h("ul", { class: "rows" }, shown) : null;
  }

  function header(s, title, pill) {
    return h(
      "header",
      { class: "sec head" },
      h("div", null, h("p", { class: "eyebrow", text: M.shopName(s.shop) + " · Checkout" }), h("h1", { class: "title", text: title })),
      pill
    );
  }

  function amount(s) {
    var c = s.cart;
    var discount = c && c.totals && c.totals.discount && Number(c.totals.discount) > 0 ? c.totals.discount : null;
    return h(
      "section",
      { class: "sec" },
      h("p", { class: "label", text: "Total" }),
      h("p", { class: "amount num", text: M.money(s.total) }),
      discount ? h("p", { class: "meta num", text: "Includes " + M.money(discount) + " off" }) : null,
      lines(c)
    );
  }

  function issueList(s, tone) {
    return s.issues.length
      ? h("ul", { class: "issues" + (tone ? " " + tone : ""), role: "status" }, s.issues.map(function (t) { return h("li", { text: t }); }))
      : null;
  }

  function footer(s, extra) {
    return h(
      "footer",
      { class: "sec" },
      extra || null,
      h("p", { class: "note" }, icon(LOCK), "PayPal holds the payment until the shop ships."),
      s.paypalOrderId ? h("p", { class: "meta" }, "PayPal order ", h("span", { class: "mono", text: s.paypalOrderId })) : null
    );
  }

  function statusLine() {
    return h("p", { class: "status" + (noteTone ? " " + noteTone : ""), role: "status", "aria-live": "polite", text: note });
  }

  function openLink(url, e) {
    if (!B.handlesLinks()) return; // the link's own target=_blank opens it
    e.preventDefault();
    B.openLink(url).then(function (ok) {
      if (!ok && !window.open(url, "_blank", "noopener")) {
        note = "Open this link to approve: " + url;
        noteTone = "warn";
        render();
      }
    });
  }

  function approveButton(s) {
    if (!s.approveUrl) return h("span", { class: "btn primary", "aria-disabled": "true", text: "Approve in PayPal" });
    return h(
      "a",
      {
        class: "btn primary",
        href: s.approveUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        onclick: function (e) {
          openLink(s.approveUrl, e);
          if (!noteTone) {
            note = "Approve in PayPal, then come back and finish the order here.";
            render();
          }
        }
      },
      "Approve in PayPal",
      icon(OUT)
    );
  }

  function finishButton(s, label, primary) {
    return h("button", {
      type: "button",
      class: "btn" + (primary ? " primary" : ""),
      disabled: busy || asked || !s.shop || !s.cartId,
      "aria-busy": busy ? "true" : null,
      text: busy ? "Finishing the order…" : label,
      onclick: finish
    });
  }

  function askInChat() {
    var s = state;
    var text = "I approved the PayPal payment. Please finish the order for cart " + s.cartId + " at " + s.shop + ".";
    if (B.canMessage()) {
      B.sendMessage(text).then(
        function () { asked = true; note = "Asked in the chat to finish the order."; noteTone = ""; render(); },
        function () { note = "Tell the chat you approved the payment, and it will finish the order."; noteTone = ""; render(); }
      );
    } else {
      note = "Tell the chat you approved the payment, and it will finish the order.";
      noteTone = "";
      render();
    }
  }

  function finish() {
    var s = state;
    if (busy || !s) return;
    if (!B.canCallTools()) {
      askInChat();
      return;
    }
    busy = true;
    note = "";
    noteTone = "";
    render();
    B.callTool("checkout", { shop: s.shop, cart_id: s.cartId }).then(
      function (result) {
        busy = false;
        var next = M.checkoutState(result, { shop: s.shop, cart_id: s.cartId });
        if (next.kind === "approve") {
          note = "PayPal has not recorded your approval yet. Approve in PayPal, then try again.";
          noteTone = "warn";
        }
        state = next;
        render();
        var text = M.textOf(result);
        if (text) B.updateContext(text);
      },
      function () {
        busy = false;
        askInChat();
      }
    );
  }

  // The tool's own message is written for the agent; the card speaks to the buyer.
  function blockedReason(s) {
    if (s.issues.length) return "The shop needs a change to this cart first:";
    if (s.paymentStatus === "UNKNOWN") return "PayPal does not show a payment for this cart yet.";
    if (s.paymentStatus === "NOT_STARTED") return "This cart has no PayPal order yet.";
    return "This cart cannot be checked out yet.";
  }

  function render() {
    var s = state;
    var view;
    if (s.kind === "approve") {
      view = [
        header(s, "Approve the payment", h("span", { class: "pill warn", text: "Awaiting approval" })),
        amount(s),
        s.issues.length ? h("section", { class: "sec" }, issueList(s)) : null,
        h(
          "section",
          { class: "sec" },
          h("div", { class: "actions" }, approveButton(s), finishButton(s, "I approved — finish the order", false)),
          statusLine()
        ),
        footer(s)
      ];
    } else if (s.kind === "finish") {
      view = [
        header(s, "Payment approved", h("span", { class: "pill accent", text: "Approved" })),
        amount(s),
        h("section", { class: "sec" }, h("div", { class: "actions" }, finishButton(s, "Finish the order", true)), statusLine()),
        footer(s)
      ];
    } else if (s.kind === "done") {
      view = [
        h(
          "header",
          { class: "sec head" },
          h(
            "div",
            null,
            h("p", { class: "eyebrow", text: M.shopName(s.shop) + " · Order placed" }),
            h("p", { class: "order-no", text: s.orderNumber || "Order placed" }),
            h("p", { class: "meta num", text: "Total " + M.money(s.total) })
          ),
          h("span", { class: "done-mark" }, icon(CHECK))
        ),
        s.cart && (s.cart.items || []).length ? h("section", { class: "sec" }, lines(s.cart)) : null,
        s.reviewUrl
          ? h(
              "section",
              { class: "sec" },
              h(
                "div",
                { class: "actions" },
                h(
                  "a",
                  {
                    class: "btn",
                    href: s.reviewUrl,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    onclick: function (e) { openLink(s.reviewUrl, e); }
                  },
                  "View order",
                  icon(OUT)
                )
              ),
              statusLine()
            )
          : null,
        footer(s)
      ];
    } else if (s.kind === "error") {
      view = [
        header(s, "Checkout did not go through", null),
        h("section", { class: "sec" }, h("p", { class: "empty", text: s.message }), s.issues.length ? h("div", { class: "gap" }, issueList(s, "bad")) : null),
        footer(s)
      ];
    } else {
      view = [
        header(s, "Not ready to check out", h("span", { class: "pill warn", text: "Needs changes" })),
        h("section", { class: "sec" }, h("p", { class: "empty", text: blockedReason(s) }), s.issues.length ? h("div", { class: "gap" }, issueList(s)) : null),
        s.total ? amount(s) : null,
        footer(s)
      ];
    }
    ui.mount(h("article", { class: "card", "aria-label": "Checkout" }, view));
  }

  return {
    onInput: function (a) {
      args = a || {};
    },
    onResult: function (result) {
      state = M.checkoutState(result, args);
      asked = false;
      note = "";
      noteTone = "";
      render();
    }
  };
}
`;
