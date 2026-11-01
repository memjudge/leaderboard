/** JSON Schema check of a result payload, against memjudge's published schema. */
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/** Returns null when valid, otherwise a short description of the first problem. */
export type ResultValidator = (payload: unknown) => string | null;

export function makeResultValidator(schema: object): ResultValidator {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = ajv.compile(schema);
  return (payload) => (check(payload) ? null : ajv.errorsText(check.errors, { dataVar: "result" }));
}
