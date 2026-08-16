import { callMcpTool, closeMcp } from "../src/mcp.ts";
console.log("read_graph      :", (await callMcpTool(JSON.stringify({server:"memory",tool_name:"read_graph",tool_args:{}}))).slice(0,160));
console.log("create_entities :", (await callMcpTool(JSON.stringify({server:"memory",tool_name:"create_entities",tool_args:{entities:[{name:"grokbot2",entityType:"project",observations:["MCP wired end to end"]}]}}))).slice(0,200));
console.log("search_nodes    :", (await callMcpTool(JSON.stringify({server:"memory",tool_name:"search_nodes",tool_args:{query:"grokbot2"}}))).slice(0,240));
closeMcp();
