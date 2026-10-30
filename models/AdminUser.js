import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const AdminUser = sequelize.define("AdminUser", {
  admin_user_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  full_name: { type: DataTypes.STRING, defaultValue: null },
  // admin: everything; accountant: all bookkeeping, no users/settings/closing; viewer: read-only.
  role: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: "admin",
    validate: { isIn: [["admin", "accountant", "viewer"]] }
  }
}, {
  tableName: "admin_user",
  underscored: true
});

export { sequelize };
