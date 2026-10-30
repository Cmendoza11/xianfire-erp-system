import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Money received against a sales invoice, or paid against a supplier bill.
export const Payment = sequelize.define("Payment", {
  payment_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  invoice_id: { type: DataTypes.INTEGER, allowNull: false },
  payment_date: { type: DataTypes.DATEONLY, allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  cash_account_id: { type: DataTypes.INTEGER, allowNull: false },
  reference: { type: DataTypes.STRING, defaultValue: null },
  status: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: "posted",
    validate: { isIn: [["posted", "void"]] }
  },
  journal_entry_id: { type: DataTypes.INTEGER, allowNull: false },
  void_entry_id: { type: DataTypes.INTEGER, defaultValue: null },
  created_by: { type: DataTypes.INTEGER, defaultValue: null }
}, {
  tableName: "payment",
  underscored: true
});

export { sequelize };
