import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Account = sequelize.define("Account", {
  accounting_account_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  name: { type: DataTypes.STRING, allowNull: false },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { isIn: [["asset", "liability", "equity", "revenue", "expense"]] }
  },
  normal_balance: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { isIn: [["debit", "credit"]] }
  },
  description: { type: DataTypes.TEXT, defaultValue: null },
  status: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1 },
  // Cash and bank accounts: receive payments, drive the cash flow statement, can be reconciled.
  is_cash: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // Where cash movements against this account land on the cash flow statement.
  cash_flow_category: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: "operating",
    validate: { isIn: [["operating", "investing", "financing"]] }
  }
}, {
  tableName: "accounting_account",
  underscored: true
});

export { sequelize };
