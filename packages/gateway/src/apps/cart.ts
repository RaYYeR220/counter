/**
 * Cart card for `create_cart` and `update_cart`: the lines with their
 * attributes, the shipping option in use, discount, tax and total, the PayPal
 * order id, and the shop's own words for anything that blocks checkout.
 */
export const CART_VIEW_JS = String.raw`
function counterView(ui) {
  var M = ui.model;

  function statusPill(c) {
    if (c.status === "COMPLETED") return h("span", { class: "pill ok", text: "Ordered" });
    if (c.ready_for_checkout) return h("span", { class: "pill accent", text: "Ready for checkout" });
    return h("span", { class: "pill warn", text: "Needs changes" });
  }

  function line(i) {
    var n = M.splitName(i.name || i.variant_id);
    return h(
      "li",
      { class: "line" },
      h(
        "div",
        { class: "what" },
        h("span", { class: "name", text: n.title }),
        h("span", { class: "attrs", text: n.detail ? M.cap(n.detail) : i.variant_id })
      ),
      h(
        "div",
        { class: "amt num" },
        i.line_total ? M.money(i.line_total) : "",
        h("span", { class: "each", text: i.quantity + " × " + (i.unit_price ? M.money(i.unit_price) : "") })
      )
    );
  }

  function shipping(c) {
    var opts = c.shipping_options || [];
    var sel = opts.filter(function (o) { return o.selected; })[0];
    if (!sel) return null;
    var others = opts.filter(function (o) { return !o.selected; });
    return [
      h(
        "li",
        { class: "row" },
        h(
          "span",
          { class: "k" },
          sel.name || sel.id,
          sel.estimated_delivery ? h("span", { class: "sub", text: "Arrives " + M.day(sel.estimated_delivery) }) : null
        ),
        h("span", { class: "v num", text: M.money(sel.price) })
      ),
      others.map(function (o) {
        return h(
          "li",
          { class: "row muted" },
          h("span", { class: "k", text: "Also: " + (o.name || o.id) + (o.estimated_delivery ? ", arrives " + M.day(o.estimated_delivery) : "") }),
          h("span", { class: "v num", text: M.money(o.price) })
        );
      })
    ];
  }

  function totals(t) {
    function row(k, v, cls) {
      return h("li", { class: "row" + (cls ? " " + cls : "") }, h("span", { class: "k", text: k }), h("span", { class: "v num", text: v }));
    }
    var hasDiscount = t.discount && Number(t.discount) > 0;
    return h(
      "ul",
      { class: "rows" },
      t.subtotal ? row("Subtotal", M.money(t.subtotal)) : null,
      hasDiscount ? row("Discount", "−" + M.money(t.discount), "discount") : null,
      t.shipping ? row("Shipping", M.money(t.shipping)) : null,
      t.tax ? row("Tax", M.money(t.tax)) : null,
      row("Total", M.money(t.total), "total")
    );
  }

  function where(a) {
    if (!a) return "";
    return [a.admin_area_2, [a.admin_area_1, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }

  function render(c, issues) {
    var to = where(c.shipping_address);
    ui.mount(
      h(
        "article",
        { class: "card", "aria-label": "Cart at " + M.shopName(c.shop) },
        h(
          "header",
          { class: "sec head" },
          h("div", null, h("p", { class: "eyebrow", text: M.shopName(c.shop) + " · Cart" }), h("h1", { class: "title num", text: M.money(c.totals && c.totals.total) })),
          statusPill(c)
        ),
        h("section", { class: "sec", "aria-label": "Items" }, h("ul", { class: "rows" }, (c.items || []).map(line))),
        shipping(c) ? h("section", { class: "sec", "aria-label": "Shipping" }, h("p", { class: "label", text: to ? "Shipping to " + to : "Shipping" }), h("ul", { class: "rows" }, shipping(c))) : null,
        h("section", { class: "sec", "aria-label": "Totals" }, totals(c.totals || {})),
        issues.length ? h("section", { class: "sec" }, h("ul", { class: "issues", role: "status" }, issues.map(function (t) { return h("li", { text: t }); }))) : null,
        h(
          "footer",
          { class: "sec" },
          h("p", { class: "meta" }, c.paypal_order_id ? ["PayPal order ", h("span", { class: "mono", text: c.paypal_order_id })] : "No PayPal order yet"),
          h("p", { class: "meta", text: "PayPal holds the payment until the shop ships." })
        )
      )
    );
  }

  return {
    onResult: function (result) {
      var sc = (result && result.structuredContent) || {};
      if (result && result.isError) {
        ui.fail("The shop could not update this cart", (sc.error && sc.error.message) || M.textOf(result), M.issues(result));
        return;
      }
      if (!sc.cart_id && !sc.items) {
        ui.fail("Nothing to show", M.textOf(result));
        return;
      }
      render(sc, M.issues(result));
    }
  };
}
`;
