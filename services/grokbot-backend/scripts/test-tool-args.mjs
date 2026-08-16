/** Unit test for tool argument parsing — models quote args inconsistently. */
import { unquote } from "../src/tools.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
};

check('double quotes', unquote('"."'), ".");
check('single quotes', unquote("'notes.txt'"), "notes.txt");
check('backticks', unquote("`src`"), "src");
check('bare value untouched', unquote("notes.txt"), "notes.txt");
check('inner quotes kept', unquote('"say \\"hi\\""'), 'say \\"hi\\"');
check('unbalanced left kept', unquote('"notes.txt'), '"notes.txt');
check('unbalanced right kept', unquote('notes.txt"'), 'notes.txt"');
check('whitespace trimmed', unquote('  "a"  '), "a");
check('empty string', unquote(""), "");
check('lone quote char', unquote('"'), '"');
check('quoted shell command', unquote('"ls -la | head"'), "ls -la | head");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
