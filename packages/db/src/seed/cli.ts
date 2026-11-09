// pnpm --filter @counter/db seed
// Upserts the demo catalog into the database at DATABASE_URL.
import { createDb } from "../client";
import { seedCatalog } from "./seed";

const result = await seedCatalog(createDb());
console.log(`Seeded ${result.shops} shops and ${result.variants} variants`);
