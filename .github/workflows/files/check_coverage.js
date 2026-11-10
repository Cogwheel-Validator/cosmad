import { readFileSync } from 'node:fs';
const file = readFileSync("./coverage/coverage-summary.json");

function tryReadingCoverage() {
  try {
    const js = JSON.parse(file);
    const total = js.total;
    const lines = total.lines.pct;
    const statements = total.statements.pct;
    const functions = total.functions.pct;
    const branches = total.branches.pct;
    const pct = (lines+statements+functions+branches) / 4;
    if (pct < 70) {
      console.log("Expected at least 70% coverage, got: ", pct, "%");
      return 1;
    }
    console.log("Coverage is at expected percentage, got: ", pct, "%");
    return 0;

  } catch(e) {
    console.log(e);
    return 1;
  }
}

tryReadingCoverage();
