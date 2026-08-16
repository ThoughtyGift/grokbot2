/**
 * web_search / web_fetch and the directory tree renderer.
 *
 * The HTML→markdown conversion is tested offline against fixed input: hitting the live web
 * for that would test the network, not the converter. Two live probes at the end confirm
 * the search and fetch paths still work end to end, and say so plainly when the network is
 * unavailable rather than failing the suite for it.
 */
import { htmlToMarkdown, webSearch, webFetch } from "../src/web.ts";
import { renderTree } from "../src/tools.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = typeof want === "function" ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)?.slice(0, 160)}`}`);
};

console.log("htmlToMarkdown");
check("title becomes an h1", htmlToMarkdown("<title>Hi</title><p>x</p>"), (s) => s.startsWith("# Hi"));
check("headings keep their level", htmlToMarkdown("<h2>Sub</h2>"), (s) => s.includes("## Sub"));
check("links keep the href", htmlToMarkdown('<a href="https://e.com">E</a>'), (s) => s.includes("[E](https://e.com)"));
check("list items become bullets", htmlToMarkdown("<ul><li>one</li><li>two</li></ul>"), (s) => /- one[\s\S]*- two/.test(s));
check("script content is dropped", htmlToMarkdown("<script>SECRET</script><p>ok</p>"), (s) => !s.includes("SECRET"));
check("style content is dropped", htmlToMarkdown("<style>.a{color:red}</style><p>ok</p>"), (s) => !s.includes("color:red"));
check("nav is dropped", htmlToMarkdown("<nav>MENU</nav><p>body</p>"), (s) => !s.includes("MENU"));
check("entities are decoded", htmlToMarkdown("<p>a &amp; b &lt;c&gt; &#39;d&#39;</p>"), (s) => s.includes("a & b <c> 'd'"));
check("numeric hex entities decode", htmlToMarkdown("<p>&#x2014;</p>"), (s) => s.includes("—"));
check("code becomes inline code", htmlToMarkdown("<p><code>npm i</code></p>"), (s) => s.includes("`npm i`"));
check("pre becomes a fence", htmlToMarkdown("<pre>line</pre>"), (s) => s.includes("```"));
check("no runs of blank lines", htmlToMarkdown("<p>a</p><p></p><p></p><p>b</p>"), (s) => !/\n{3,}/.test(s));
check("empty input does not throw", htmlToMarkdown(""), (s) => typeof s === "string");

console.log("\nrenderTree");
const tree = {
  abs_path: "/root/workspace",
  children_dirs: [
    { abs_path: "/root/workspace/src", children_dirs: [], children_files: [{ name: "app.ts", size: 30 }], children_were_processed: true, num_files: 1 },
    { abs_path: "/root/workspace/deep", children_dirs: [], children_files: [], children_were_processed: false, num_files: 0 },
  ],
  children_files: [{ name: "README.md", size: 12 }],
  children_were_processed: true,
  num_files: 1,
};
const out = renderTree(tree);
check("root path is shown", out, (s) => s.startsWith("/root/workspace/"));
check("nested file appears", out, (s) => s.includes("app.ts"));
check("root file appears", out, (s) => s.includes("README.md"));
check("directories are marked", out, (s) => s.includes("src/"));
// An unexplored branch must not read as an empty one, or the agent stops looking.
check("unexplored branch is flagged", out, (s) => /deep\/\s+…chưa mở/.test(s));
check("nesting is indented", out, (s) => /\n\s{4}app\.ts/.test(s));
check("missing node does not throw", renderTree(undefined), (s) => typeof s === "string");

console.log("\nweb_fetch — argument handling (no network)");
check("rejects a non-http scheme", (await webFetch("file:///etc/passwd")).error, (e) => /http/i.test(e));
check("rejects a bare word", (await webFetch("hello")).error, (e) => e.length > 0);
check("never throws on bad input", await webFetch("ftp://x").then(() => true).catch(() => false), true);

console.log("\nlive probes (network)");
try {
  const r = await webFetch("https://example.com");
  check("fetches a real page", r.markdown, (s) => /example/i.test(s));
  check("reports no error", r.error, "");
  const s = await webSearch("hermes agent nous research");
  check("search returns references", s.references.length > 0, true);
  check("references carry a url", s.references[0]?.url ?? "", (u) => /^https?:/.test(u));
  check("references carry a title", s.references[0]?.title ?? "", (t) => t.length > 0);
} catch (e) {
  console.log(`  skip  network unavailable (${String(e?.message ?? e).slice(0, 60)})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
