import { cpSync } from "node:fs";

cpSync("src/reporting/assets", "dist/reporting/assets", { recursive: true });
