/**
 * Env-reading primitives. Deliberately its OWN module, not part of flags.ts:
 * `lib/config/flags` is mocked by several suites, and a low-level module
 * importing from it inherits every one of those mocks — `chain.ts` reaching
 * here for `firstSet` blew up five unrelated v4-discovery tests with
 * "firstSet is not a function", because their mock replaces the whole module.
 *
 * Nothing mocks this file, and nothing should.
 */

/**
 * First value that is actually SET — `undefined` and `""` both skipped.
 *
 * `??` is wrong for any NEXT_PUBLIC_ read. The CI workflow passes a build-arg
 * for every such var whether or not the repo Variable exists, and
 * Dockerfile.prod's `ENV X=$X` turns an unset one into the EMPTY STRING, which
 * is not nullish. `"" ?? fallback` is `""`, so a fallback written right there
 * in the source never runs — the client bundle shipped `http:[""]` as the
 * chain's RPC url, verified by grepping a real build rather than reasoned about.
 */
export const firstSet = (...vals: (string | undefined)[]) =>
  vals.find((v) => v !== undefined && v !== "");
