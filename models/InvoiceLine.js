import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const InvoiceLine = sequelize.define("InvoiceLine", {
  invoice_line_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  invoice_id: { type: DataTypes.INTEGER, allowNull: false },
  account_id: { type: DataTypes.INTEGER, allowNull: false },
  description: { type: DataTypes.STRING, defaultValue: null },
  quantity: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 1 },
  unit_price: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  sort_order: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 }
}, {
  tableName: "invoice_line",
  underscored: true,
  timestamps: false
});

export { sequelize };
