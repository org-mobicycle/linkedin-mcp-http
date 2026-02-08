# LinkedIn MCP HTTP Server

HTTP MCP server for LinkedIn posting and management, deployed on Cloudflare Workers with Durable Objects.

## Features

- ✅ Post text content to LinkedIn (personal & company pages)
- ✅ Share article URLs with custom previews
- ✅ Format posts with visual hierarchy
- ✅ List and manage multiple accounts
- ✅ Token management via Cloudflare KV
- ✅ Validate token health and expiry
- ✅ List, get, and delete posts

## Supported Accounts

- **Personal**: Rose Scott (urn:li:person:TiOsO5-QU5)
- **MobiCycle**: MobiCycle Technologies (urn:li:organization:94952386)
- **MobiCycle Productions**: MobiCycle Productions (urn:li:organization:105189353)

## Tools

### Core Tools

| Tool | Description |
|------|-------------|
| `linkedin_post` | Post text content to LinkedIn |
| `linkedin_post_article` | Share article URL with commentary |
| `linkedin_format_post` | Format post with title, body, CTA, hashtags |
| `linkedin_list_organizations` | List manageable company pages |

### Management Tools

| Tool | Description |
|------|-------------|
| `linkedin_validate_token` | Check token validity and expiry |
| `linkedin_get_profile` | Get profile information |
| `linkedin_list_posts` | List recent posts |
| `linkedin_get_post` | Get single post details |
| `linkedin_delete_post` | Delete a post |
| `linkedin_status` | Show server and account status |

## Installation

```bash
cd /path/to/linkedin
npm install
```

## Development

```bash
npm run dev
```

## Deployment

```bash
npm run deploy
```

Make sure you have:
1. Cloudflare account configured
2. KV namespace created: `linkedin_tokens_kv`
3. Durable Object migrations applied

## Token Storage

Tokens stored in Cloudflare KV:
- `token:personal`
- `token:mobicycle`
- `token:mobicycle-productions`

## MCP Configuration

```json
{
  "mcpServers": {
    "linkedin": {
      "type": "http",
      "url": "https://your-worker.workers.dev/mcp"
    }
  }
}
```

## Status

✅ Ready to deploy
✅ All tools implemented
✅ Multi-account support
