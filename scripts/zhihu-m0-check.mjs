import { readFile } from "node:fs/promises";
import { normalizeCollectionPage } from "../src/zhihu-m0.mjs";

const file = process.argv[2];
if (!file) throw new Error("pass the path to a local capture fixture");
const result = normalizeCollectionPage(JSON.parse(await readFile(file, "utf8")));
const counts = result.items.reduce((groups, item) => {
  (groups[item.status] ??= []).push(item);
  return groups;
}, {});

console.log(JSON.stringify({
  fixture: file,
  status: result.status,
  sampleCount: result.items.length,
  nextPage: result.nextPage,
  itemStatuses: Object.fromEntries(Object.entries(counts).map(([status, items]) => [status, items.length])),
  contentPersisted: false,
  credentialsPersisted: false,
}, null, 2));
