import { sequelize } from "./db.js";
import { AdminUser } from "./AdminUser.js";
import { Account } from "./Account.js";
import { JournalEntry } from "./JournalEntry.js";
import { JournalLine } from "./JournalLine.js";
import { Setting } from "./Setting.js";
import { Migration } from "./Migration.js";
import { PeriodClose } from "./PeriodClose.js";
import { AuditLog } from "./AuditLog.js";
import { Contact } from "./Contact.js";
import { Invoice } from "./Invoice.js";
import { InvoiceLine } from "./InvoiceLine.js";
import { Payment } from "./Payment.js";
import { BankReconciliation } from "./BankReconciliation.js";

JournalEntry.hasMany(JournalLine, { foreignKey: "journal_entry_id", as: "lines", onDelete: "CASCADE" });
JournalLine.belongsTo(JournalEntry, { foreignKey: "journal_entry_id", onDelete: "CASCADE" });
// RESTRICT: an account that already has journal lines can only be deactivated, never deleted.
Account.hasMany(JournalLine, { foreignKey: "account_id", onDelete: "RESTRICT" });
JournalLine.belongsTo(Account, { foreignKey: "account_id", as: "account", onDelete: "RESTRICT" });
// RESTRICT: an entry cannot be deleted while a reversal still points at it.
JournalEntry.belongsTo(JournalEntry, { foreignKey: "reversal_of_id", as: "reversalOf", onDelete: "RESTRICT" });
PeriodClose.belongsTo(JournalEntry, { foreignKey: "journal_entry_id", onDelete: "RESTRICT" });
PeriodClose.belongsTo(Account, { foreignKey: "retained_earnings_account_id", onDelete: "RESTRICT" });

// Sales and purchases: documents keep their journal entries; RESTRICT stops the ledger side from
// disappearing underneath a posted invoice, bill or payment.
Invoice.belongsTo(Contact, { foreignKey: "contact_id", as: "contact", onDelete: "RESTRICT" });
Contact.hasMany(Invoice, { foreignKey: "contact_id", onDelete: "RESTRICT" });
Invoice.hasMany(InvoiceLine, { foreignKey: "invoice_id", as: "lines", onDelete: "CASCADE" });
InvoiceLine.belongsTo(Invoice, { foreignKey: "invoice_id", onDelete: "CASCADE" });
InvoiceLine.belongsTo(Account, { foreignKey: "account_id", as: "account", onDelete: "RESTRICT" });
Invoice.belongsTo(JournalEntry, { foreignKey: "journal_entry_id", as: "entry", onDelete: "RESTRICT" });
Invoice.belongsTo(JournalEntry, { foreignKey: "void_entry_id", as: "voidEntry", onDelete: "RESTRICT" });
Invoice.hasMany(Payment, { foreignKey: "invoice_id", as: "payments", onDelete: "RESTRICT" });
Payment.belongsTo(Invoice, { foreignKey: "invoice_id", onDelete: "RESTRICT" });
Payment.belongsTo(Account, { foreignKey: "cash_account_id", as: "cashAccount", onDelete: "RESTRICT" });
Payment.belongsTo(JournalEntry, { foreignKey: "journal_entry_id", as: "entry", onDelete: "RESTRICT" });
Payment.belongsTo(JournalEntry, { foreignKey: "void_entry_id", as: "voidEntry", onDelete: "RESTRICT" });

// Deleting a draft reconciliation simply un-ticks its lines.
BankReconciliation.belongsTo(Account, { foreignKey: "account_id", as: "account", onDelete: "RESTRICT" });
JournalLine.belongsTo(BankReconciliation, { foreignKey: "cleared_reconciliation_id", onDelete: "SET NULL" });

export {
  sequelize, AdminUser, Account, JournalEntry, JournalLine, Setting, Migration, PeriodClose, AuditLog,
  Contact, Invoice, InvoiceLine, Payment, BankReconciliation
};
