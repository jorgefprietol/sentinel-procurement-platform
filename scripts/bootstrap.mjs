import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const destination = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(destination)) {
  console.log("Existing .env preserved.");
} else {
  const secret = () => randomBytes(32).toString("hex");
  writeFileSync(
    destination,
    `POSTGRES_PASSWORD=${secret()}\nAPP_DB_PASSWORD=${secret()}\nBOOTSTRAP_PASSWORD=${secret()}\nPARTNER_TOKEN=${secret()}\nWEB_PORT=18130\nAPP_ORIGIN=http://localhost:18130\nCOOKIE_SECURE=false\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Local secrets generated in .env. Read BOOTSTRAP_PASSWORD there to sign in.",
  );
}
