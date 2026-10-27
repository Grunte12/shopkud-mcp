// Replay the identical real extension/MCP workflow suite with the portable transport.
process.env.SHOPKUD_TEST_TRANSPORT="websocket";
require("./mcp-extension.cjs");
