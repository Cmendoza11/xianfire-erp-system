const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, "0");

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Returns the date when it is a real YYYY-MM-DD calendar date, otherwise null.
export function parseDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fiscalYearStart(date, startMonth) {
  const [year, month] = date.split("-").map(Number);
  return `${month >= startMonth ? year : year - 1}-${pad(startMonth)}-01`;
}

export function nextFiscalYearStart(start) {
  const [year, month] = start.split("-").map(Number);
  return `${year + 1}-${pad(month)}-01`;
}

export function fiscalYearEnd(start) {
  return addDays(nextFiscalYearStart(start), -1);
}

// "FY 2026" for calendar fiscal years, "FY 2025-2026" when the year spans two calendar years.
export function fiscalYearLabel(start) {
  const startYear = Number(start.slice(0, 4));
  return start.slice(5, 7) === "01" ? `FY ${startYear}` : `FY ${startYear}-${startYear + 1}`;
}
