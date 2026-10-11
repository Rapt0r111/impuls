import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Простая проверка отслеживаемых файлов на секреты (§ 12 плана: «проверка секретов»).
// Не заменяет специализированный сканер: ловит токен бота, ключи Supabase, JWT и
// строки подключения с паролем к чужому хосту.
const rules = [
  ["токен Telegram-бота", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ["секретный ключ Supabase", /\bsb_secret_[A-Za-z0-9_-]{16,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["закрытый ключ", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "строка подключения с паролем",
    /postgres(?:ql)?:\/\/[^\s:@/]+:(?!test-only|\$|<|\*|password|пароль)[^\s@/]{6,}@(?!127\.0\.0\.1|localhost|db\.internal|db\.example|\$|<)[^\s/]+/i,
  ],
];
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(
    (file) => file && !/\.(png|jpg|jpeg|gif|webp|ico|woff2?|lock)$/i.test(file),
  );
const found = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [name, pattern] of rules)
    if (pattern.test(text)) found.push(`${file}: ${name}`);
}
if (found.length) {
  console.error(`Возможные секреты:\n${found.join("\n")}`);
  process.exit(1);
}
console.log(`Секреты не найдены (проверено файлов: ${files.length})`);
