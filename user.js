import bcrypt from "bcryptjs";
import { parseArgs } from "node:util";
import { sequelize, AdminUser } from "./models/index.js";

const USAGE = `
Admin user commands

  npm run user:create -- --name "Juan Dela Cruz" --email admin@example.com --password secret123
  npm run user:changePassword -- --email admin@example.com --password newsecret123
`;

const MIN_PASSWORD_LENGTH = 8;

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    name: { type: "string", short: "n" },
    email: { type: "string", short: "e" },
    password: { type: "string", short: "p" }
  }
});

function fail(message) {
  console.error(`❌ ${message}`);
  console.log(USAGE);
  process.exit(1);
}

const email = (values.email ?? "").trim();
const password = values.password ?? "";
if (!email) fail("Email is required");
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`Invalid password. Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
}

try {
  if (command === "create") {
    const name = (values.name ?? "").trim();
    if (!name) fail("Full name is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Invalid email format");
    const hashed = await bcrypt.hash(password, 10);
    // Same email again updates that user, so this also works as a reset tool.
    const existing = await AdminUser.findOne({ where: { email } });
    if (existing) {
      await existing.update({ full_name: name, password: hashed });
    } else {
      await AdminUser.create({ full_name: name, email, password: hashed });
    }
    console.log("✅ Admin user created successfully");
  } else if (command === "changePassword") {
    const user = await AdminUser.findOne({ where: { email } });
    if (!user) fail("User not found");
    await user.update({ password: await bcrypt.hash(password, 10) });
    console.log("✅ Password is updated successfully");
  } else {
    fail(`Unknown command "${command ?? ""}"`);
  }
} catch (err) {
  console.error("❌ Error:", err.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
