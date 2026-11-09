/**
 * The view model the cards render from, as browser JavaScript. It reads only
 * the tool result (and the call's arguments) the host hands the card; it never
 * reaches the network. Kept in plain ES2017 so it runs in every host's webview
 * and can be evaluated in tests as-is.
 *
 * Written as a string because it ships inside the card's HTML. Do not use
 * template literals or `${` in it.
 */
export const APP_MODEL_JS = String.raw`
function counterModel() {
  function money(v) {
    return "$" + (v === undefined || v === null || v === "" ? "0.00" : String(v));
  }

  function day(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
    var d = new Date(iso + "T00:00:00Z");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }

  // "Speckled mug (Sage, 12 oz)" -> product name and the variant's attribute values.
  function splitName(name) {
    var s = typeof name === "string" ? name.trim() : "";
    var m = /^(.*\S)\s*\(([^()]+)\)$/.exec(s);
    return m ? { title: m[1], detail: m[2] } : { title: s, detail: "" };
  }

  // "sage, 12 oz" -> "Sage, 12 oz": shops often store attribute values in lower case.
  function cap(values) {
    return String(values || "")
      .split(", ")
      .map(function (v) { return v.charAt(0).toUpperCase() + v.slice(1); })
      .join(", ");
  }

  function safeUrl(u) {
    if (typeof u !== "string" || !u) return null;
    try {
      var url = new URL(u);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function shopName(slug) {
    var small = { and: 1, of: 1, the: 1, "&": 1 };
    return String(slug || "")
      .split("-")
      .filter(Boolean)
      .map(function (w, i) { return i > 0 && small[w] ? w : w.charAt(0).toUpperCase() + w.slice(1); })
      .join(" ");
  }

  function stockLabel(v) {
    if (!v.purchasable) return "Not sold on its own";
    if (!v.in_stock) return "Sold out";
    if (v.lead_time_days > 0) return "Made to order, ships in about " + v.lead_time_days + " days";
    if (v.stock <= 3) return "Only " + v.stock + " left";
    return v.stock + " in stock";
  }

  function canBuy(v) {
    return !!(v && v.in_stock && v.purchasable);
  }

  function pickVariant(p, requested) {
    var vs = (p && p.variants) || [];
    var want = typeof requested === "string" ? requested.trim().toUpperCase() : "";
    for (var i = 0; i < vs.length; i++) if (want && String(vs[i].variant_id).toUpperCase() === want) return vs[i];
    for (var j = 0; j < vs.length; j++) if (canBuy(vs[j])) return vs[j];
    return vs[0];
  }

  function variantLabel(p, v) {
    var order = (p && p.attributes_order) || [];
    var attrs = (v && v.attributes) || {};
    var out = [];
    order.forEach(function (k) { if (attrs[k]) out.push(attrs[k]); });
    Object.keys(attrs).forEach(function (k) { if (order.indexOf(k) < 0 && attrs[k]) out.push(attrs[k]); });
    return out.length ? out.map(cap).join(" · ") : String((v && v.variant_id) || "");
  }

  function textOf(result) {
    return ((result && result.content) || [])
      .filter(function (c) { return c && c.type === "text" && c.text; })
      .map(function (c) { return c.text; })
      .join("\n");
  }

  function issues(result) {
    var sc = (result && result.structuredContent) || {};
    var list = sc.validation_issues || (sc.cart && sc.cart.validation_issues) || (sc.error && sc.error.issues) || [];
    return list
      .map(function (i) { return (i && (i.user_message || i.message)) || ""; })
      .filter(Boolean);
  }

  // One state for the approval card, from either checkout or order_status.
  function checkoutState(result, args) {
    var a = args || {};
    var sc = (result && result.structuredContent) || {};
    var cart = sc.cart || null;
    var s = {
      kind: "blocked",
      shop: (cart && cart.shop) || sc.shop || a.shop || "",
      cartId: (cart && cart.cart_id) || sc.cart_id || a.cart_id || "",
      total: cart && cart.totals ? cart.totals.total : undefined,
      paypalOrderId: sc.paypal_order_id || (cart && cart.paypal_order_id) || null,
      cart: cart,
      issues: issues(result),
      message: typeof sc.message === "string" ? sc.message : "",
      paymentStatus: sc.payment_status || null,
      approveUrl: null,
      orderNumber: null,
      reviewUrl: null
    };
    if (result && result.isError) {
      s.kind = "error";
      s.message = (sc.error && sc.error.message) || textOf(result) || "The shop could not answer.";
      return s;
    }
    var status = sc.payment_status;
    if (sc.completed === true || status === "COMPLETED") {
      s.kind = "done";
      s.orderNumber = sc.order_number || null;
      s.reviewUrl = safeUrl(sc.order_review_page);
    } else if (sc.needs_approval === true || status === "AWAITING_APPROVAL") {
      s.kind = "approve";
      s.approveUrl = safeUrl(sc.approve_url);
    } else if (status === "APPROVED") {
      s.kind = "finish";
    }
    return s;
  }

  return {
    money: money,
    day: day,
    splitName: splitName,
    cap: cap,
    safeUrl: safeUrl,
    shopName: shopName,
    stockLabel: stockLabel,
    canBuy: canBuy,
    pickVariant: pickVariant,
    variantLabel: variantLabel,
    textOf: textOf,
    issues: issues,
    checkoutState: checkoutState
  };
}
`;
