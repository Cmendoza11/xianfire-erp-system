import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const JournalEntry = sequelize.define("JournalEntry", {
  accounting_journal_entry_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  entry_date: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: DataTypes.NOW },
  reference: { type: DataTypes.STRING, defaultValue: null },
  description: { type: DataTypes.TEXT, allowNull: false },
  created_by: { type: DataTypes.INTEGER, defaultValue: null },
  // manual: posted by a user; reversal: cancels reversal_of_id; closing: fiscal year closing entry;
  // invoice / bill / receipt / disbursement: posted automatically from sales and purchases.
  entry_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: "manual",
    validate: { isIn: [["manual", "reversal", "closing", "invoice", "bill", "receipt", "disbursement"]] }
  },
  reversal_of_id: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "accounting_journal_entry",
  underscored: true,
  updatedAt: false,
  indexes: [
    { name: "IDX_ACCOUNTING_JOURNAL_ENTRY_DATE", fields: ["entry_date"] }
  ]
});

export { sequelize };
