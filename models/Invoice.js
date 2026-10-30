import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// kind "invoice" is a sales invoice (accounts receivable); kind "bill" is a supplier bill (payable).
export const Invoice = sequelize.define("Invoice", {
  invoice_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  kind: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [["invoice", "bill"]] } },
  contact_id: { type: DataTypes.INTEGER, allowNull: false },
  issue_date: { type: DataTypes.DATEONLY, allowNull: false },
  due_date: { type: DataTypes.DATEONLY, allowNull: false },
  reference: { type: DataTypes.STRING, defaultValue: null },
  memo: { type: DataTypes.TEXT, defaultValue: null },
  vat_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  vat_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  amount_paid: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: "open",
    validate: { isIn: [["open", "paid", "void"]] }
  },
  journal_entry_id: { type: DataTypes.INTEGER, allowNull: false },
  void_entry_id: { type: DataTypes.INTEGER, defaultValue: null },
  voided_on: { type: DataTypes.DATEONLY, defaultValue: null },
  created_by: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "invoice",
  underscored: true,
  indexes: [
    { name: "IDX_INVOICE_KIND_STATUS", fields: ["kind", "status"] },
    { name: "IDX_INVOICE_ISSUE_DATE", fields: ["issue_date"] }
  ]
});

export { sequelize };
