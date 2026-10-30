import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const JournalLine = sequelize.define("JournalLine", {
  accounting_journal_line_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  journal_entry_id: { type: DataTypes.INTEGER, allowNull: false },
  account_id: { type: DataTypes.INTEGER, allowNull: false },
  description: { type: DataTypes.STRING, defaultValue: null },
  debit: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  credit: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  sort_order: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
  // Set when the line was ticked as cleared in a bank reconciliation.
  cleared_reconciliation_id: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "accounting_journal_line",
  underscored: true,
  timestamps: false,
  indexes: [
    { name: "IDX_ACCOUNTING_JOURNAL_LINE_ENTRY", fields: ["journal_entry_id"] },
    { name: "IDX_ACCOUNTING_JOURNAL_LINE_ACCOUNT", fields: ["account_id"] }
  ]
});

export { sequelize };
