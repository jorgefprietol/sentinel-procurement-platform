import { existsSync, readFileSync } from "node:fs";
const path = new URL("../.env", import.meta.url);
if (existsSync(path))
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2];
  }
