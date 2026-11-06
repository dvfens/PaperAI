// Retention enforcement: securely deletes stored documents whose retention period has ended.
// Run from cron (e.g. hourly):  npm run cleanup
// (The server also runs this opportunistically; Arkiv entities expire on their own at the same time.)
import { purgeExpired } from "@/server/services/documents";

const n = await purgeExpired(true);
console.log(`Purged ${n} expired document(s).`);
process.exit(0);
