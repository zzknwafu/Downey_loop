import { compareExperiments } from "./domain/comparison.js";
import { buildSampleExperiments } from "./domain/sample-data.js";

const { baseline, candidate } = buildSampleExperiments();
const comparison = compareExperiments(baseline, candidate);

console.log(JSON.stringify(comparison, null, 2));
