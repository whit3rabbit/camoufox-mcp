import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Camoufox } from "camoufox-js";
import chalk from "chalk";

// Define the tool that will be exposed by the MCP server.
const BROWSE_TOOL: Tool = {
  name: "browse",
  description: "Launches a stealth browser, navigates to a URL, and returns the full HTML page content. Uses Camoufox to spoof browser fingerprints.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to navigate to. Must be a fully qualified URL (e.g., 'https://example.com')."
      },
      os: {
        type: "string",
        description: "Optional OS to spoof. Can be 'windows', 'macos', or 'linux'.",
        enum: ["windows", "macos", "linux"]
      }
    },
    required: ["url"],
  },
};

class CamoufoxServer {
  // The main logic for handling the 'browse' tool call.
  public async browseUrl(input: unknown): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    const args = input as { url: string; os?: 'windows' | 'macos' | 'linux' };
    let browser;

    try {
      console.error(chalk.blue(`[Camoufox] Launching browser to browse: ${args.url}`));
      
      // Launch Camoufox. 'headless: 'virtual'' is crucial for running in a Docker container.
      browser = await Camoufox({
        os: args.os, // Pass the 'os' argument if provided
        headless: 'virtual', // Use a virtual display (Xvfb)
      });

      const page = await browser.newPage();
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      const pageContent = await page.content(); // Get the full HTML content

      console.error(chalk.green(`[Camoufox] Successfully retrieved content from ${args.url}.`));

      return {
        content: [{
          type: "text",
          text: pageContent // Return the HTML content
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`[Camoufox] Error during browsing: ${errorMessage}`));
      return {
        content: [{
          type: "text",
          text: `Failed to browse URL ${args.url}. Error: ${errorMessage}`
        }],
        isError: true
      };
    } finally {
      if (browser) {
        console.error(chalk.blue('[Camoufox] Closing browser.'));
        await browser.close();
      }
    }
  }
}

// Initialize the MCP server and the Camoufox handler
const server = new Server(
  {
    name: "camoufox-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const camoufoxServer = new CamoufoxServer();

// Register the request handler for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [BROWSE_TOOL],
}));

// Register the request handler for calling a tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "browse") {
    return camoufoxServer.browseUrl(request.params.arguments);
  }

  return {
    content: [{
      type: "text",
      text: `Unknown tool: ${request.params.name}`
    }],
    isError: true
  };
});

// Main function to start the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(chalk.yellow("Camoufox MCP Server is running on stdio..."));
}

runServer().catch((error) => {
  console.error(chalk.red("Fatal error running server:", error));
  process.exit(1);
});