import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

// Customers (sales invoices) and suppliers (bills) share one table, told apart by `type`.
export const Contact = sequelize.define("Contact", {
  contact_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: { isIn: [["customer", "supplier"]] }
  },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, defaultValue: null },
  phone: { type: DataTypes.STRING(50), defaultValue: null },
  address: { type: DataTypes.TEXT, defaultValue: null },
  tin: { type: DataTypes.STRING(30), defaultValue: null },
  status: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1 }
}, {
  tableName: "contact",
  underscored: true,
  indexes: [{ name: "IDX_CONTACT_TYPE", fields: ["type"] }]
});

export { sequelize };
