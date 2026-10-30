import { QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";
import { getDocumentBook } from "./invoiceService.js";
import { getControlAccounts } from "./settingService.js";

const cents = (value) => Math.round(Number(value ?? 0) * 100);

async function accountMovement(accountId, from, to) {
  const [row] = await sequelize.query(
    `SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
     FROM accounting_journal_line l
     INNER JOIN accounting_journal_entry e ON e.accounting_journal_entry_id = l.journal_entry_id
     WHERE l.account_id = ? AND e.entry_date BETWEEN ? AND ? AND e.entry_type <> 'closing'`,
    { replacements: [accountId, from, to], type: QueryTypes.SELECT }
  );
  return { debit: cents(row.debit), credit: cents(row.credit) };
}

// VAT for a period. The VAT amounts come from the ledger (so manual adjustments count); the
// sales and purchase bases come from the invoices and bills issued in the period.
export async function getVatSummary({ from, to }) {
  const controls = await getControlAccounts();
  const output = await accountMovement(controls.outputVat.accounting_account_id, from, to);
  const input = await accountMovement(controls.inputVat.accounting_account_id, from, to);
  const outputVat = output.credit - output.debit;
  const inputVat = input.debit - input.credit;
  const sales = await getDocumentBook("invoice", { from, to });
  const purchases = await getDocumentBook("bill", { from, to });
  const payable = outputVat - inputVat;
  return {
    outputVatAccount: `${controls.outputVat.code} - ${controls.outputVat.name}`,
    inputVatAccount: `${controls.inputVat.code} - ${controls.inputVat.name}`,
    vatableSales: sales.totals.vatable,
    nonVatSales: sales.totals.nonVat,
    totalSales: sales.totals.subtotal,
    vatablePurchases: purchases.totals.vatable,
    nonVatPurchases: purchases.totals.nonVat,
    totalPurchases: purchases.totals.subtotal,
    outputVat: outputVat / 100,
    inputVat: inputVat / 100,
    vatPayable: payable / 100,
    isExcessInput: payable < 0
  };
}
