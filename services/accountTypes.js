export class AccountingValidationError extends Error {}

export const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset", normalBalance: "debit" },
  { value: "liability", label: "Liability", normalBalance: "credit" },
  { value: "equity", label: "Equity", normalBalance: "credit" },
  { value: "revenue", label: "Revenue", normalBalance: "credit" },
  { value: "expense", label: "Expense", normalBalance: "debit" }
];

export function isAccountType(value) {
  return ACCOUNT_TYPES.some((t) => t.value === value);
}

export function defaultNormalBalance(type) {
  return ACCOUNT_TYPES.find((t) => t.value === type).normalBalance;
}

export function accountTypeLabel(type) {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;
}

// Amounts are compared in integer cents so floating point never decides whether an entry balances.
export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return NaN;
  }
  return Math.round(n * 100);
}
