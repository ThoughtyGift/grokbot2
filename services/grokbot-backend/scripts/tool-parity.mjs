/**
 * Local tools vs the original's 54, by real name.
 *
 * Counts three groups separately because they mean different things: names invented here,
 * names taken from the original's ClientSideToolV2 enum, and names taken from the
 * original's browser MCP provider (which is NOT part of the 54).
 */
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("docs/extracted/tool-catalog.json", "utf8"));
const original = catalog.tools.map((t) => t.name);

const LOCAL = {
  invented: ["echo", "time", "reverse", "upper", "count", "calc"],
  box: ["run_terminal_command_v2", "read_file_v2", "list_dir_v2", "glob_file_search", "ripgrep_raw_search"],
  browser: [
    "browser_navigate", "browser_snapshot", "browser_take_screenshot", "browser_click",
    "browser_mouse_click_xy", "browser_type", "browser_fill", "browser_select_option",
    "browser_press_key", "browser_scroll", "browser_drag", "browser_get_bounding_box",
    "browser_highlight", "browser_evaluate", "browser_tabs", "browser_cdp",
  ],
};

const inCatalog = (n) => original.includes(n);
const all = [...LOCAL.invented, ...LOCAL.box, ...LOCAL.browser];
const overlap = all.filter(inCatalog);

console.log(`local tools defined in code : ${all.length}`);
console.log(`  invented here             : ${LOCAL.invented.length}  (${LOCAL.invented.filter(inCatalog).length} exist in the original)`);
console.log(`  box, real names           : ${LOCAL.box.length}  (${LOCAL.box.filter(inCatalog).length} exist in the original)`);
console.log(`  browser, real names       : ${LOCAL.browser.length}  (${LOCAL.browser.filter(inCatalog).length} exist in the 54 — browser is a separate MCP surface)`);
console.log(`\noverlap with the original's ${original.length}: ${overlap.length}  -> ${overlap.join(", ")}`);

// What is actually offered right now depends on configuration, not on what exists.
const boxOn = Boolean(process.env.GROKBOT2_BOX_EXEC_URL);
const browserOn = Boolean(process.env.GROKBOT2_BROWSER_CDP);
const active = [...LOCAL.invented, ...(boxOn ? LOCAL.box : []), ...(browserOn ? LOCAL.browser : [])];
console.log(`\noffered to the model right now: ${active.length}  (box=${boxOn ? "on" : "OFF"}, browser=${browserOn ? "on" : "OFF"})`);

console.log(`\nthe original's ${original.length}, minus what we cover:`);
const missing = original.filter((n) => !overlap.includes(n));
const GROUPS = {
  "repo/IDE only (no box use)": /semsearch|ripgrep_search$|^edit|^new_edit|^reapply|^delete_file|^save_file|^read_chunk|^read_with|^read_lints|^fix_lints|^go_to_def|^search_symbols|^semantic|^glob_file_search$|^read_project|^update_project|^get_project|^get_symbols|^fetch_rules|^undo_edit|^apply_agent_diff|^create_rm_files|^add_test|^delete_test|^get_tests|^run_test|^report_bugfix|^add_ui_step|^spec$|^model$/,
  "git / PR / CI": /^commit|^push|^create_branch|^checkout_branch|^update_branch|^create_pr|^fetch_pull_request|^babysit_pr|^fix_merge|^connect_scm/,
  "agent orchestration": /^task|^await|^background_composer|^switch_mode|^create_plan|^todo_|^knowledge_base|^deep_search|^reflect|^send_to_user|^ai_attribution/,
  "MCP": /mcp/,
  "media / desktop": /^computer_use|^record_screen|^generate_image|^create_diagram/,
  "web": /^web_search|^web_fetch/,
  "user interaction": /^ask_question/,
};
for (const [label, re] of Object.entries(GROUPS)) {
  const hit = missing.filter((n) => re.test(n));
  if (hit.length) console.log(`  ${String(hit.length).padStart(2)}  ${label.padEnd(28)} ${hit.slice(0, 6).join(", ")}${hit.length > 6 ? " …" : ""}`);
}
const other = missing.filter((n) => !Object.values(GROUPS).some((re) => re.test(n)));
if (other.length) console.log(`  ${String(other.length).padStart(2)}  ${"other".padEnd(28)} ${other.join(", ")}`);
