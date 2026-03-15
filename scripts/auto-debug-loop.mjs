#!/usr/bin/env node

import { parseCliArgs, runAutoDebugLoop } from "./lib/auto-debug-loop-core.mjs";

const options = parseCliArgs(process.argv.slice(2));
const report = runAutoDebugLoop(options);

console.log(JSON.stringify(report, null, 2));

if (report.finalStatus === "issues_detected" || report.finalStatus === "manual_review_required") {
  process.exitCode = 1;
}
