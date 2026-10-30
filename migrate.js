/*
    MIT License

    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */

import mysql from "mysql2/promise";
import inquirer from "inquirer";
import { dbConfig } from "./models/db.js";
import { sequelize, Account, Migration } from "./models/index.js";

// Default chart of accounts (Philippine small business), seeded once on first migration.
const DEFAULT_ACCOUNTS = [
  ["1000", "Cash on Hand", "asset", "debit", "Petty cash and undeposited collections"],
  ["1010", "Cash in Bank", "asset", "debit", "Company bank accounts"],
  ["1100", "Accounts Receivable", "asset", "debit", "Amounts owed by customers"],
  ["1200", "Merchandise Inventory", "asset", "debit", "Goods held for sale"],
  ["1300", "Prepaid Expenses", "asset", "debit", "Expenses paid in advance"],
  ["1400", "Input VAT", "asset", "debit", "VAT paid on purchases"],
  ["1500", "Office Equipment", "asset", "debit", "Computers, furniture and equipment"],
  ["1510", "Accumulated Depreciation - Office Equipment", "asset", "credit", "Contra asset account"],
  ["2000", "Accounts Payable", "liability", "credit", "Amounts owed to suppliers"],
  ["2100", "Accrued Expenses", "liability", "credit", "Expenses incurred but not yet paid"],
  ["2200", "Output VAT Payable", "liability", "credit", "VAT collected on sales"],
  ["2300", "Withholding Tax Payable", "liability", "credit", "Taxes withheld for remittance to BIR"],
  ["2400", "SSS, PhilHealth and Pag-IBIG Payable", "liability", "credit", "Government contributions payable"],
  ["2500", "Loans Payable", "liability", "credit", "Bank loans"],
  ["3000", "Owner's Capital", "equity", "credit", "Owner investments"],
  ["3100", "Owner's Drawings", "equity", "debit", "Owner withdrawals"],
  ["3200", "Retained Earnings", "equity", "credit", "Accumulated profits"],
  ["4000", "Sales Revenue", "revenue", "credit", "Revenue from sale of goods"],
  ["4100", "Sales Returns and Allowances", "revenue", "debit", "Contra revenue account"],
  ["4200", "Sales Discounts", "revenue", "debit", "Contra revenue account"],
  ["4500", "Other Income", "revenue", "credit", "Interest and miscellaneous income"],
  ["5000", "Cost of Goods Sold", "expense", "debit", "Cost of merchandise sold"],
  ["6000", "Salaries and Wages Expense", "expense", "debit", null],
  ["6100", "Rent Expense", "expense", "debit", null],
  ["6200", "Utilities Expense", "expense", "debit", null],
  ["6300", "Shipping and Delivery Expense", "expense", "debit", null],
  ["6400", "Marketing and Advertising Expense", "expense", "debit", null],
  ["6500", "Depreciation Expense", "expense", "debit", null],
  ["6600", "Office Supplies Expense", "expense", "debit", null],
  ["6700", "Bank Charges", "expense", "debit", null]
];

const CHECK_CONSTRAINTS = [
  ["accounting_account", "ACCOUNTING_ACCOUNT_TYPE_CHECK",
    "CHECK (`type` IN ('asset', 'liability', 'equity', 'revenue', 'expense'))"],
  ["accounting_account", "ACCOUNTING_ACCOUNT_NORMAL_BALANCE_CHECK",
    "CHECK (`normal_balance` IN ('debit', 'credit'))"],
  ["accounting_journal_line", "ACCOUNTING_JOURNAL_LINE_AMOUNT_CHECK",
    "CHECK ((`debit` > 0 AND `credit` = 0) OR (`credit` > 0 AND `debit` = 0))"],
  ["accounting_journal_entry", "ACCOUNTING_JOURNAL_ENTRY_TYPE_CHECK",
    "CHECK (`entry_type` IN ('manual', 'reversal', 'closing', 'invoice', 'bill', 'receipt', 'disbursement'))"],
  ["accounting_account", "ACCOUNTING_ACCOUNT_CASH_FLOW_CHECK",
    "CHECK (`cash_flow_category` IN ('operating', 'investing', 'financing'))"],
  ["admin_user", "ADMIN_USER_ROLE_CHECK",
    "CHECK (`role` IN ('admin', 'accountant', 'viewer'))"],
  ["invoice", "INVOICE_AMOUNTS_CHECK",
    "CHECK (`total` > 0 AND `amount_paid` >= 0 AND `amount_paid` <= `total`)"],
  ["payment", "PAYMENT_AMOUNT_CHECK", "CHECK (`amount` > 0)"]
];

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    { replacements: [table, column] }
  );
  return rows.length > 0;
}

// DDL commits implicitly in MySQL, so schema changes run outside the step's transaction.
async function addColumnIfMissing(table, column, definition, extra = []) {
  if (await columnExists(table, column)) return;
  await sequelize.query(
    `ALTER TABLE \`${table}\` ${[`ADD COLUMN \`${column}\` ${definition}`, ...extra].join(", ")}`
  );
}

const toAccountRow = ([code, name, type, normal_balance, description]) =>
  ({ code, name, type, normal_balance, description });

// One-time data steps; each runs only if its name is not yet recorded in the `migration` table.
const DATA_MIGRATIONS = [
  ["accounting-1.0.0-default-chart-of-accounts", async (transaction) => {
    await Account.bulkCreate(DEFAULT_ACCOUNTS.map(toAccountRow), { transaction, ignoreDuplicates: true });
  }],
  // Removes what the old online-store integration left behind: auto-posting source columns and the
  // Shipping Income account (kept if it was already used in an entry).
  ["accounting-1.1.0-remove-store-leftovers", async (transaction) => {
    const [columns] = await sequelize.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounting_journal_entry' AND COLUMN_NAME IN ('source_type', 'source_id', 'source_event')"
    );
    if (columns.length > 0) {
      // DDL commits implicitly in MySQL, so it runs outside the transaction.
      await sequelize.query(
        `ALTER TABLE accounting_journal_entry ${columns.map((c) => `DROP COLUMN \`${c.COLUMN_NAME}\``).join(", ")}`
      );
    }
    const shipping = await Account.findOne({ where: { code: "4300", name: "Shipping Income" }, transaction });
    if (shipping) {
      const [[{ used }]] = await sequelize.query(
        "SELECT COUNT(*) AS used FROM accounting_journal_line WHERE account_id = ?",
        { replacements: [shipping.accounting_account_id], transaction }
      );
      if (Number(used) === 0) await shipping.destroy({ transaction });
      else console.log("ℹ️  Kept account 4300 Shipping Income because it already has journal entries");
    }
  }],
  // Databases created before reversing entries and period closing existed need the new columns;
  // fresh installs already get them from sequelize.sync().
  ["accounting-1.2.0-entry-types-and-reversals", async () => {
    const [columns] = await sequelize.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounting_journal_entry' AND COLUMN_NAME IN ('entry_type', 'reversal_of_id')"
    );
    const existing = new Set(columns.map((c) => c.COLUMN_NAME));
    const changes = [];
    if (!existing.has("entry_type")) {
      changes.push("ADD COLUMN `entry_type` VARCHAR(20) NOT NULL DEFAULT 'manual'");
    }
    if (!existing.has("reversal_of_id")) {
      changes.push(
        "ADD COLUMN `reversal_of_id` INT NULL",
        "ADD CONSTRAINT `FK_ACCOUNTING_JOURNAL_ENTRY_REVERSAL_OF` FOREIGN KEY (`reversal_of_id`) REFERENCES `accounting_journal_entry` (`accounting_journal_entry_id`) ON DELETE RESTRICT ON UPDATE CASCADE"
      );
    }
    if (changes.length > 0) {
      await sequelize.query(`ALTER TABLE accounting_journal_entry ${changes.join(", ")}`);
    }
  }],
  // Roles, cash accounts, cash flow categories and bank reconciliation ticks.
  ["accounting-1.3.0-sales-purchases-banking-roles", async (transaction) => {
    await addColumnIfMissing("admin_user", "role", "VARCHAR(20) NOT NULL DEFAULT 'admin'");
    await addColumnIfMissing("accounting_account", "is_cash", "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing("accounting_account", "cash_flow_category", "VARCHAR(20) NOT NULL DEFAULT 'operating'");
    await addColumnIfMissing("accounting_journal_line", "cleared_reconciliation_id", "INT NULL", [
      "ADD CONSTRAINT `FK_JOURNAL_LINE_RECONCILIATION` FOREIGN KEY (`cleared_reconciliation_id`) REFERENCES `bank_reconciliation` (`bank_reconciliation_id`) ON DELETE SET NULL ON UPDATE CASCADE"
    ]);
    // The entry type check gets new values; it is re-added with them after the data migrations.
    const [checks] = await sequelize.query(
      "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'accounting_journal_entry' AND CONSTRAINT_NAME = 'ACCOUNTING_JOURNAL_ENTRY_TYPE_CHECK'"
    );
    if (checks.length > 0) {
      await sequelize.query("ALTER TABLE accounting_journal_entry DROP CHECK `ACCOUNTING_JOURNAL_ENTRY_TYPE_CHECK`");
    }

    // Only the default accounts are classified, and only while they still carry their default names.
    const defaults = [
      ["1000", "Cash on Hand", { is_cash: true }],
      ["1010", "Cash in Bank", { is_cash: true }],
      ["1500", "Office Equipment", { cash_flow_category: "investing" }],
      ["1510", "Accumulated Depreciation - Office Equipment", { cash_flow_category: "investing" }],
      ["2500", "Loans Payable", { cash_flow_category: "financing" }],
      ["3000", "Owner's Capital", { cash_flow_category: "financing" }],
      ["3100", "Owner's Drawings", { cash_flow_category: "financing" }]
    ];
    for (const [code, name, values] of defaults) {
      await Account.update(values, { where: { code, name }, transaction });
    }
  }]
];

const autoYes = process.argv.includes("--yes") || process.argv.includes("-y");
const { createDb } = autoYes
  ? { createDb: true }
  : await inquirer.prompt([
      { type: "confirm", name: "createDb", message: `Database '${dbConfig.database}' may not exist. Create it?`, default: true }
    ]);

try {
  if (createDb) {
    const connection = await mysql.createConnection({
      host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password
    });
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    await connection.end();
    console.log("✅ Database created (if it did not exist)");
  }

  await sequelize.authenticate();
  console.log("✅ Connected to MySQL database!");
  // No `force`: existing tables and ledger data are kept; only missing tables are created.
  await sequelize.sync();
  console.log("✅ Tables created for all models!");

  for (const [name, run] of DATA_MIGRATIONS) {
    if (await Migration.findOne({ where: { name } })) continue;
    await sequelize.transaction(async (transaction) => {
      await run(transaction);
      await Migration.create({ name }, { transaction });
    });
    console.log(`✅ Applied ${name}`);
  }

  // After the data migrations, so every column a constraint checks already exists.
  for (const [table, name, definition] of CHECK_CONSTRAINTS) {
    const [rows] = await sequelize.query(
      "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
      { replacements: [table, name] }
    );
    if (rows.length === 0) {
      await sequelize.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${definition}`);
    }
  }
  console.log("✅ Check constraints in place");
  console.log("✅ Migration completed!");
} catch (err) {
  console.error("❌ Migration failed:", err);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
