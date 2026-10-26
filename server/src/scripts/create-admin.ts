/**
 * Create (or reset) a Super Admin account.
 *   Interactive:      npm run create-admin
 *   Non-interactive:  ADMIN_USERNAME=admin ADMIN_PASSWORD='...' ADMIN_NAME='مدير النظام' npm run create-admin
 */
import readline from "node:readline/promises";
import { prisma } from "../db.js";
import { hashPassword, passwordProblems } from "../lib/security.js";
import { ensureDefaults } from "../services/settings.js";

async function ask(rl: readline.Interface, q: string, def?: string) {
  const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
  return a || def || "";
}

async function main() {
  await ensureDefaults();
  let username = process.env.ADMIN_USERNAME ?? "";
  let password = process.env.ADMIN_PASSWORD ?? "";
  let displayName = process.env.ADMIN_NAME ?? "";
  if (!username || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    username = await ask(rl, "اسم المستخدم (لاتيني)", "admin");
    displayName = await ask(rl, "الاسم الظاهر", "مدير النظام");
    password = await ask(rl, "كلمة المرور (10 أحرف على الأقل، حروف وأرقام)");
    rl.close();
  }
  username = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("اسم المستخدم غير صالح");
  const problem = passwordProblems(password);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role: "SUPER_ADMIN", isActive: true, failedLogins: 0, lockedUntil: null },
    create: { username, displayName: displayName || "مدير النظام", passwordHash, role: "SUPER_ADMIN" },
  });
  console.log(`✔ تم إنشاء/تحديث مدير النظام: ${user.username}`);
}

main()
  .catch((e) => {
    console.error(`✘ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
