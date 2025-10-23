# Using Render MCP for Log Analysis

## What is Render MCP?

Render MCP (Model Context Protocol) is already set up in your Cursor! It lets you:
- Query logs directly from Render
- Monitor service health
- Check metrics (CPU, memory, requests)
- View deployments
- All without leaving Cursor!

## Available Commands

### 1. View Logs

**Recent Logs:**
```
Show me recent logs from Clerky
```

**Filter by Type:**
```
Show me discovery logs
Show me error logs  
Show me build logs
```

**Time-based:**
```
Show me logs from the last hour
Show me logs from the last 24 hours
```

**Specific Searches:**
```
Show me logs containing "DISCOVERY"
Show me logs containing "error" or "ERROR"
```

### 2. Service Management

**Service Status:**
```
What's the status of my Clerky service?
Show me all my Render services
```

**Service Details:**
```
Show me environment variables for Clerky
What's the current deployment status?
```

### 3. Metrics

**Resource Usage:**
```
Show me CPU usage for the last hour
Show me memory usage
Show me HTTP requests
```

**Performance:**
```
Show me response times
Show me bandwidth usage
```

### 4. Deployments

**Recent Deploys:**
```
Show me recent deployments
What's the status of the latest deploy?
```

## Practical Examples

### Debugging Discovery Errors

1. **Check if discovery ran:**
```
Show me logs containing "DISCOVERY" from the last hour
```

2. **Find specific errors:**
```
Show me error logs containing "discovery"
```

3. **Monitor in real-time:**
```
Show me live logs filtered by "discovery"
```

### Performance Monitoring

**Check if server is slow:**
```
Show me HTTP latency at 95th percentile for the last 24 hours
```

**Check resource limits:**
```
Show me CPU and memory usage
Show me CPU targets and limits
```

### Deployment Verification

**After pushing code:**
```
Show me the latest deployment status
Show me build logs from the last deployment
```

## Advanced Queries

### Filter by Multiple Criteria

**Errors during specific time:**
```javascript
{
  "resource": ["srv-ct27s4a3esus73d590b0"],
  "level": ["error"],
  "startTime": "2025-10-23T14:00:00Z",
  "endTime": "2025-10-23T15:00:00Z",
  "limit": 50
}
```

### HTTP Request Analysis

**Filter by status code:**
```
Show me HTTP 500 errors from the last hour
```

**Filter by path:**
```
Show me requests to /discoverMissingGuidelines
```

### Instance-Specific Logs

```
Show me logs from instance srv-ct27s4a3esus73d590b0-725hl
```

## Setting Up Custom MCP Server (Optional)

If you want a custom MCP server for enhanced log analysis:

### 1. Create MCP Server Config

In your Cursor settings (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "clerky-logs": {
      "command": "node",
      "args": ["scripts/mcp_log_server.js"],
      "env": {
        "RENDER_API_KEY": "your-render-api-key"
      }
    }
  }
}
```

### 2. Create Custom MCP Server

```javascript
// scripts/mcp_log_server.js
const { McpServer } = require('@modelcontextprotocol/sdk');

const server = new McpServer({
  name: 'clerky-logs',
  version: '1.0.0'
});

// Add custom tools for guideline discovery
server.addTool({
  name: 'check_discovery_status',
  description: 'Check if guideline discovery is running or completed',
  inputSchema: {
    type: 'object',
    properties: {}
  },
  handler: async () => {
    // Query Render logs
    // Return structured status
  }
});

server.start();
```

## Quick Reference

### Log Levels
- `info` - Normal operations
- `error` - Errors and exceptions
- `debug` - Detailed debugging info
- `warn` - Warnings

### Log Types
- `app` - Application logs
- `build` - Build/deployment logs
- `request` - HTTP request logs

### Your Service ID
```
srv-ct27s4a3esus73d590b0
```

### Common Filters

**Discovery logs:**
```json
{
  "text": ["discovery", "DISCOVERY"],
  "resource": ["srv-ct27s4a3esus73d590b0"]
}
```

**Errors only:**
```json
{
  "level": ["error"],
  "resource": ["srv-ct27s4a3esus73d590b0"]
}
```

**Last hour:**
```json
{
  "startTime": "2025-10-23T14:00:00Z",
  "resource": ["srv-ct27s4a3esus73d590b0"]
}
```

## Benefits of Using MCP

1. **No Dashboard Switching** - Stay in Cursor
2. **Faster Debugging** - Query logs with natural language
3. **Programmable** - Automate common checks
4. **Context-Aware** - AI understands log patterns
5. **Time-Saving** - No manual log searching

## Example Workflow

### After Deploying Discovery Fix:

1. **Check deployment:**
```
What's the latest deployment status?
```

2. **Monitor for errors:**
```
Show me any errors in the last 5 minutes
```

3. **Test discovery:**
- Run discovery from browser
- Query: `Show me discovery logs from the last minute`

4. **Verify success:**
```
Show me logs containing "Discovery complete"
```

---

**Your Render MCP is already set up and ready to use in Cursor!**

Just ask questions about your logs naturally, and I'll query Render for you.


