import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Setting = sequelize.define("Setting", {
  setting_id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  uuid: { type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: DataTypes.UUIDV4 },
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  value: { type: DataTypes.TEXT, defaultValue: null },
  is_json: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, {
  tableName: "setting",
  underscored: true,
  timestamps: false
});

export { sequelize };
