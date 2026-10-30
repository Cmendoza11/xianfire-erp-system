import hbs from "hbs";

const moneyFormatter = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatMoney(value) {
  return moneyFormatter.format(Number(value ?? 0));
}

export function formatSignedMoney(value) {
  const n = Number(value ?? 0);
  return n < 0 ? `(${moneyFormatter.format(Math.abs(n))})` : moneyFormatter.format(n);
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : dateTimeFormatter.format(d);
}

export function registerHelpers() {
  hbs.registerHelper("formatDateTime", formatDateTime);
  hbs.registerHelper("formatMoney", formatMoney);
  hbs.registerHelper("formatSignedMoney", formatSignedMoney);
  hbs.registerHelper("eq", (a, b) => String(a) === String(b));
  hbs.registerHelper("gt", (a, b) => Number(a) > Number(b));
  hbs.registerHelper("lowercase", (value) => String(value ?? "").toLowerCase());
  // The last argument Handlebars passes is its options object, so it is dropped.
  hbs.registerHelper("concat", (...args) => args.slice(0, -1).join(""));
  // Embeds data for page scripts; escaping "<" stops a value such as "</script>" from closing the tag.
  hbs.registerHelper(
    "json",
    (value) => new hbs.handlebars.SafeString(JSON.stringify(value ?? null).replace(/</g, "\\u003c"))
  );
}
