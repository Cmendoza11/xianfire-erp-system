import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Journal lines ticked as cleared point here through accounting_journal_line.cleared_reconciliation_id.
export const BankReconciliation = sequelize.define("BankReconciliation", {
  bank_reconciliation_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  account_id: { type: DataTypes.INTEGER, allowNull: false },
  statement_date: { type: DataTypes.DATEONLY, allowNull: false },
  statement_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: "draft",
    validate: { isIn: [["draft", "completed"]] }
  },
  completed_by: { type: DataTypes.INTEGER, defaultValue: null },
  completed_at: { type: DataTypes.DATE, defaultValue: null },
  created_by: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "bank_reconciliation",
  underscored: true,
  updatedAt: false
});

export { sequelize };
