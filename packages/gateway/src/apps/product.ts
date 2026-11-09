/**
 * Product card for `get_product`: the product, its variants as chips (sold out
 * and unavailable ones disabled), and the picked variant's price, stock and
 * delivery dates. Picking a chip only changes what the card shows.
 */
export const PRODUCT_VIEW_JS = String.raw`
function counterView(ui) {
  var M = ui.model;
  var args = {};
  var product = null;
  var selected = null;

  function chip(v) {
    var buyable = M.canBuy(v);
    var why = !v.purchasable ? "Unavailable" : !v.in_stock ? "Sold out" : "";
    return h(
      "li",
      null,
      h(
        "button",
        {
          type: "button",
          class: "chip",
          disabled: !buyable,
          "aria-pressed": selected && selected.variant_id === v.variant_id ? "true" : "false",
          "aria-label": M.variantLabel(product, v) + (why ? ", " + why.toLowerCase() : ""),
          title: v.variant_id,
          "data-id": v.variant_id,
          onclick: function () {
            selected = v;
            render();
            ui.focus(function (el) { return el.getAttribute("data-id") === v.variant_id; });
          }
        },
        M.variantLabel(product, v),
        why ? h("span", { class: "soldout", text: why }) : null
      )
    );
  }

  function delivery(v) {
    var rows = (v.delivery || []).map(function (d) {
      return h(
        "li",
        { class: "row" },
        h("span", { class: "k" }, d.name || d.id, h("span", { class: "when", text: "arrives " + M.day(d.estimated_delivery) })),
        h("span", { class: "v num", text: M.money(d.price) })
      );
    });
    return rows.length ? h("ul", { class: "rows" }, rows) : h("p", { class: "empty", text: "No delivery quote for this variant." });
  }

  function flagPills(v) {
    var names = { seconds: "Seconds", made_to_order: "Made to order", limited: "Limited", decaf: "Decaf", subscription_only: "Subscription only" };
    var flags = (v.flags || []).filter(function (f) { return names[f]; });
    return flags.length
      ? h("div", { class: "flags" }, flags.map(function (f) { return h("span", { class: "pill", text: names[f] }); }))
      : null;
  }

  function render() {
    var p = product;
    var v = selected;
    var stockClass = !v ? "" : !M.canBuy(v) ? " out" : v.stock <= 3 ? " low" : "";
    var count = p.variants.length;
    ui.mount(
      h(
        "article",
        { class: "card", "aria-label": p.name },
        h(
          "header",
          { class: "sec" },
          h("p", { class: "eyebrow" }, [p.shop_name || M.shopName(p.shop), p.category ? M.cap(p.category) : ""].filter(Boolean).join(" · ")),
          h("h1", { class: "title", text: p.name }),
          p.description ? h("p", { class: "desc", text: p.description }) : null
        ),
        count > 1
          ? h(
              "section",
              { class: "sec", "aria-label": "Variants" },
              h("p", { class: "label", text: count + " variants" }),
              h("ul", { class: "chips" }, p.variants.map(chip))
            )
          : null,
        v
          ? h(
              "section",
              { class: "sec", "aria-live": "polite" },
              h(
                "div",
                { class: "facts" },
                h("span", { class: "price num", text: M.money(v.price) }),
                h("span", { class: "stock" + stockClass, text: M.stockLabel(v) })
              ),
              flagPills(v),
              h("p", { class: "label gap", text: "Delivery to a US address if ordered today" }),
              delivery(v)
            )
          : null,
        v
          ? h(
              "footer",
              { class: "sec" },
              h("p", { class: "meta" }, h("span", { class: "mono", text: v.variant_id }), p.returns_days ? " · " + p.returns_days + "-day returns" : "")
            )
          : null
      )
    );
  }

  return {
    onInput: function (a) {
      args = a || {};
    },
    onResult: function (result) {
      var sc = (result && result.structuredContent) || {};
      if (result && result.isError) {
        ui.fail("Product not found", (sc.error && sc.error.message) || M.textOf(result));
        return;
      }
      if (!sc.variants) {
        ui.fail("Nothing to show", M.textOf(result));
        return;
      }
      product = sc;
      selected = M.pickVariant(product, args.parent_id);
      render();
    }
  };
}
`;
