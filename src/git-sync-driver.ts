/** Invoked only by Git; stdout is reserved for errors/status from replay. */
import { readFileSync, writeFileSync } from "fs";
import { mergeNotes } from "./event-merge.js";
import { replayJournal } from "./event-journal.js";

try {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "merge" && args.length === 3) {
    const [base, ours, theirs] = args;
    const result = mergeNotes(readFileSync(base, "utf8"), readFileSync(ours, "utf8"), readFileSync(theirs, "utf8"));
    writeFileSync(ours, result.content);
    process.exitCode = result.clean ? 0 : 1;
  } else if (mode === "replay" && args.length === 1) {
    replayJournal(args[0]);
  } else throw new Error("Invalid AgentLog Git driver arguments");
} catch (error) {
  console.error(`[agentlog] ${error}`);
  process.exitCode = 1;
}
