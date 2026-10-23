import { readFileSync } from "node:fs";
import {
  validatePuzzleGraph,
  validatePuzzleSchema,
  type PuzzleDocument,
} from "../packages/content-compiler/src/index.js";

const schema = JSON.parse(
  readFileSync(
    new URL("../schemas/puzzle-graph.schema.json", import.meta.url),
    "utf8",
  ),
) as object;
const document = JSON.parse(
  readFileSync(
    new URL(
      "../content/episodes/light-the-last-lighthouse/episode.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as PuzzleDocument;
const forPublication = process.argv.includes("--publish");
const schemaResult = validatePuzzleSchema(schema, document);
const graphResult = schemaResult.valid
  ? validatePuzzleGraph(document, { forPublication })
  : { valid: false, errors: ["schema_validation_failed"] };
const errors = [...schemaResult.errors, ...graphResult.errors];
if (errors.length > 0) {
  console.error(JSON.stringify({ valid: false, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      valid: true,
      mode: forPublication ? "publication-preflight" : "draft-development",
      notice:
        "Graph/fallback validation only; assets, signatures, and release evidence require separate verification.",
    }),
  );
}
