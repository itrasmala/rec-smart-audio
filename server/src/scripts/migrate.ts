/** Apply pending database migrations (also done automatically at server start). */
import { config } from "../config.js";
import { applyMigrations } from "../db.js";

applyMigrations()
  .then((done) => {
    console.log(done.length ? `✔ applied: ${done.join(", ")}` : "✔ database is up to date");
    process.exit(0);
  })
  .catch((err) => {
    console.error(`✘ ${err instanceof Error ? err.message : err}`, config.dbDir ?? "");
    process.exit(1);
  });
