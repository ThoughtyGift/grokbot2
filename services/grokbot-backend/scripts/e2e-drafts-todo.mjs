/**
 * Drafts and the checklist, through the tool layer.
 *
 * Drafts are display-only by the renderer's own contract, so this asserts the ENTRY shape
 * rather than any send: getting `draft.to` / `draft.target` wrong is the failure mode that
 * looks fine in the backend and renders as nothing in the app.
 */
import { runToolForTest } from "../src/chat.ts";
const agentId = process.argv[2] ?? "agent-11";
const show = (label, v) => console.log(`${label.padEnd(14)} ${String(v).replace(/\s+/g, " ").slice(0, 110)}`);

show("email_draft", await runToolForTest(agentId, "email_draft", JSON.stringify({
  to: ["sep@cinai.tv"], subject: "Bao cao sang", body: "Da xong 3 viec." })));
show("slack_draft", await runToolForTest(agentId, "slack_draft", JSON.stringify({
  target: "#general", body: "Deploy xong roi nhe." })));
show("email bad", await runToolForTest(agentId, "email_draft", "{}"));
show("create_plan", await runToolForTest(agentId, "create_plan", JSON.stringify({
  title: "Ke hoach", steps: ["Doc log", "Sua bug", "Chay test"] })));
show("todo_read", await runToolForTest(agentId, "todo_read", ""));
show("todo_write", await runToolForTest(agentId, "todo_write", JSON.stringify([
  { text: "Doc log", done: true }, { text: "Sua bug", done: false }])));
