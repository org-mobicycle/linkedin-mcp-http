#!/bin/bash
# Quick script to commit and push LinkedIn MCP HTTP server changes

cd "$(dirname "$0")"

echo "🔧 Fixing git lock..."
rm -f .git/index.lock

echo "📝 Staging changes..."
git add -A

echo "💾 Committing..."
git commit -m "Fix: Add missing McpAgent import for deployment

- Added missing import statement for McpAgent from agents/mcp
- Fixes TypeScript compilation errors in Cloudflare Pages build
- All type checks now pass successfully
- Updated agents to 0.3.10 with proper MCP SDK integration
- Ready for production deployment

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

echo "🚀 Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Done! Changes pushed to https://github.com/org-mobicycle/linkedin-mcp-http"
echo ""
echo "Next steps:"
echo "1. Check GitHub Actions for automatic Cloudflare Pages deployment"
echo "2. Once deployed, test at: https://linkedin-mcp-http.[your-subdomain].workers.dev/health"
echo "3. Add MCP endpoint to Claude Desktop: https://[your-worker-url]/mcp"
