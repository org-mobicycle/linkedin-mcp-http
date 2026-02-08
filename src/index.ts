/**
 * linkedin-mcp-http - HTTP MCP Server for LinkedIn (Cloudflare Workers)
 *
 * This MCP server provides tools for formatting and posting content to LinkedIn.
 * It supports personal accounts and company pages (organizations).
 * Tokens are stored as Cloudflare Secrets for secure access.
 */

import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

interface Env {
  MCP_AGENT: DurableObjectNamespace<LinkedInMcpAgent>
  LINKEDIN_TOKEN_PERSONAL?: string
  LINKEDIN_TOKEN_MOBICYCLE?: string
  LINKEDIN_TOKEN_MOBICYCLE_PRODUCTIONS?: string
  API_VERSION?: string
}

interface Account {
  label: string
  authorUrn: string
  scope: string
}

const ACCOUNTS: Record<string, Account> = {
  personal: {
    label: "Rose Scott (Personal)",
    authorUrn: "urn:li:person:TiOsO5-QU5",
    scope: "w_member_social",
  },
  mobicycle: {
    label: "MobiCycle (Company)",
    authorUrn: "urn:li:organization:94952386",
    scope: "w_organization_social",
  },
  "mobicycle-productions": {
    label: "MobiCycle Productions (Company)",
    authorUrn: "urn:li:organization:105189353",
    scope: "w_organization_social",
  },
}

const ACCOUNT_KEYS = Object.keys(ACCOUNTS) as [string, ...string[]]
const accountSchema = z.enum(ACCOUNT_KEYS)

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadToken(env: Env, accountKey: string): Promise<{ access_token: string; [k: string]: unknown }> {
  const acct = ACCOUNTS[accountKey]
  if (!acct) throw new Error(`Unknown account: ${accountKey}. Options: ${Object.keys(ACCOUNTS).join(", ")}`)

  // Map account key to secret name
  const secretMap: Record<string, string | undefined> = {
    personal: env.LINKEDIN_TOKEN_PERSONAL,
    mobicycle: env.LINKEDIN_TOKEN_MOBICYCLE,
    'mobicycle-productions': env.LINKEDIN_TOKEN_MOBICYCLE_PRODUCTIONS,
  }

  const token = secretMap[accountKey]
  if (!token) {
    throw new Error(`No token configured for account: ${accountKey}. Set the LINKEDIN_TOKEN_${accountKey.toUpperCase().replace('-', '_')} secret.`)
  }

  // Tokens can be stored as JSON strings with metadata, or just the access token
  try {
    const parsed = JSON.parse(token)
    if (parsed.access_token) {
      return parsed
    }
  } catch {
    // Not JSON, treat as raw access token
  }

  return { access_token: token }
}

function apiHeaders(token: string, apiVersion: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": apiVersion,
  }
}

async function apiRequest(method: string, url: string, token: string, apiVersion: string, body?: unknown) {
  const opts: RequestInit = { method, headers: apiHeaders(token, apiVersion) }
  if (body) opts.body = JSON.stringify(body)

  const res = await fetch(url, opts)
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`LinkedIn API ${res.status}: ${text}`)
  }

  if (!text) return { _status: res.status, _headers: Object.fromEntries(res.headers.entries()) }
  try { return JSON.parse(text) } catch { return { _raw: text } }
}

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] })
const err = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true as const })

// ── Durable Object Agent ────────────────────────────────────────────────────

export class LinkedInMcpAgent extends McpAgent<Env> {
  server = new McpServer({ name: 'linkedin-mcp-http', version: '1.0.0' })

  async init() {
    const apiVersion = this.env.API_VERSION || "202503"

    // ── Tool: Post ──────────────────────────────────────────────────────────
    this.server.tool(
      "linkedin_post",
      "Create a LinkedIn text post. Defaults to personal account.",
      {
        content: z.string().max(3000).describe("Post text (max 3000 chars)"),
        account: accountSchema.default("personal").describe("Which account to post to"),
        visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC").describe("Post visibility"),
      },
      async ({ content, account, visibility }) => {
        try {
          const acct = ACCOUNTS[account]
          const creds = await loadToken(this.env, account)

          const postData = {
            author: acct.authorUrn,
            commentary: content,
            visibility,
            distribution: {
              feedDistribution: "MAIN_FEED",
              targetEntities: [],
              thirdPartyDistributionChannels: [],
            },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false,
          }

          const result = await apiRequest("POST", "https://api.linkedin.com/rest/posts", creds.access_token, apiVersion, postData)
          const postId = result._headers?.["x-restli-id"] || result._headers?.["location"] || "created"

          return json({ success: true, account: acct.label, postId, chars: content.length, visibility })
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: Post with Article ─────────────────────────────────────────────
    this.server.tool(
      "linkedin_post_article",
      "Create a LinkedIn post with an article link (URL card preview)",
      {
        content: z.string().max(3000).describe("Post text (max 3000 chars)"),
        article_url: z.string().url().describe("URL of the article to share"),
        article_title: z.string().optional().describe("Custom title for the article card"),
        article_description: z.string().optional().describe("Custom description for the article card"),
        account: accountSchema.default("personal"),
        visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC"),
      },
      async ({ content, article_url, article_title, article_description, account, visibility }) => {
        try {
          const acct = ACCOUNTS[account]
          const creds = await loadToken(this.env, account)

          const postData: Record<string, unknown> = {
            author: acct.authorUrn,
            commentary: content,
            visibility,
            distribution: {
              feedDistribution: "MAIN_FEED",
              targetEntities: [],
              thirdPartyDistributionChannels: [],
            },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false,
            content: {
              article: {
                source: article_url,
                ...(article_title ? { title: article_title } : {}),
                ...(article_description ? { description: article_description } : {}),
              },
            },
          }

          const result = await apiRequest("POST", "https://api.linkedin.com/rest/posts", creds.access_token, apiVersion, postData)
          const postId = result._headers?.["x-restli-id"] || result._headers?.["location"] || "created"

          return json({ success: true, account: acct.label, postId, articleUrl: article_url, chars: content.length })
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: Format Post ───────────────────────────────────────────────────
    this.server.tool(
      "linkedin_format_post",
      "Format text into a structured LinkedIn post with visual hierarchy",
      {
        title: z.string().describe("Main headline"),
        content: z.string().describe("Main body content"),
        hashtags: z.string().optional().describe("Hashtags to append"),
        cta: z.string().optional().describe("Call-to-action text"),
      },
      async ({ title, content, hashtags, cta }) => {
        const parts = [`${title}\n`, content]
        if (cta) parts.push(`\n${cta}`)
        if (hashtags) parts.push(`\n---\n${hashtags}`)

        const formatted = parts.join("\n")
        return json({ formatted, chars: formatted.length, withinLimit: formatted.length <= 3000 })
      }
    )

    // ── Tool: Validate Token ────────────────────────────────────────────────
    this.server.tool(
      "linkedin_validate_token",
      "Check if an access token is valid and show expiry info",
      {
        account: accountSchema.default("personal").describe("Which account to check"),
      },
      async ({ account }) => {
        try {
          const creds = await loadToken(this.env, account)
          const acct = ACCOUNTS[account]
          const profile = await apiRequest("GET", "https://api.linkedin.com/v2/userinfo", creds.access_token, apiVersion)

          const info: Record<string, unknown> = {
            valid: true,
            account: acct.label,
            name: profile.name || `${profile.given_name} ${profile.family_name}`,
            email: profile.email || "not available",
            scope: creds.scope || acct.scope,
          }

          if (creds.generated_at && creds.expires_in) {
            const generatedMs = new Date(creds.generated_at as string).getTime()
            const expiresAt = new Date(generatedMs + (creds.expires_in as number) * 1000)
            info.expiresAt = expiresAt.toISOString()
            info.daysLeft = Math.round((expiresAt.getTime() - Date.now()) / 86400000)
          }

          return json(info)
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: Get Profile ───────────────────────────────────────────────────
    this.server.tool(
      "linkedin_get_profile",
      "Get LinkedIn profile info for the authenticated user",
      {
        account: accountSchema.default("personal").describe("Which account"),
      },
      async ({ account }) => {
        try {
          const creds = await loadToken(this.env, account)
          const profile = await apiRequest("GET", "https://api.linkedin.com/v2/userinfo", creds.access_token, apiVersion)
          return json(profile)
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: List Posts ────────────────────────────────────────────────────
    this.server.tool(
      "linkedin_list_posts",
      "List recent posts from a LinkedIn account with metadata",
      {
        account: accountSchema.default("personal").describe("Which account"),
        count: z.number().min(1).max(50).default(10).describe("How many posts to retrieve"),
      },
      async ({ account, count }) => {
        try {
          const acct = ACCOUNTS[account]
          const creds = await loadToken(this.env, account)

          const url = `https://api.linkedin.com/rest/posts?author=${encodeURIComponent(acct.authorUrn)}&count=${count}`
          const result = await apiRequest("GET", url, creds.access_token, apiVersion)

          if (!result.elements || result.elements.length === 0) {
            return json({ posts: [], account: acct.label })
          }

          const posts = result.elements.map((post: any) => ({
            id: post.id,
            text: (post.commentary || "").substring(0, 300),
            created: post.createdAt ? new Date(post.createdAt).toISOString() : null,
            visibility: post.visibility,
            lifecycleState: post.lifecycleState,
            hasContent: !!post.content,
          }))

          return json({ account: acct.label, total: posts.length, posts })
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: Get Post ──────────────────────────────────────────────────────
    this.server.tool(
      "linkedin_get_post",
      "Get a single LinkedIn post by its URN with full details",
      {
        post_id: z.string().describe("The post URN (e.g. urn:li:share:1234)"),
        account: accountSchema.default("personal").describe("Which account"),
      },
      async ({ post_id, account }) => {
        try {
          const creds = await loadToken(this.env, account)
          const url = `https://api.linkedin.com/rest/posts/${encodeURIComponent(post_id)}`
          const post = await apiRequest("GET", url, creds.access_token, apiVersion)
          return json(post)
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: Delete Post ───────────────────────────────────────────────────
    this.server.tool(
      "linkedin_delete_post",
      "Delete a LinkedIn post by its URN",
      {
        post_id: z.string().describe("The post URN (e.g. urn:li:share:1234)"),
        account: accountSchema.default("personal").describe("Which account"),
      },
      async ({ post_id, account }) => {
        try {
          const creds = await loadToken(this.env, account)
          const url = `https://api.linkedin.com/rest/posts/${encodeURIComponent(post_id)}`
          await apiRequest("DELETE", url, creds.access_token, apiVersion)
          return json({ success: true, deleted: post_id })
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: List Organizations ────────────────────────────────────────────
    this.server.tool(
      "linkedin_list_organizations",
      "List companies/organizations you can manage and post on behalf of",
      {
        account: accountSchema.default("personal").describe("Which account to query with"),
      },
      async ({ account }) => {
        try {
          const creds = await loadToken(this.env, account)
          const result = await apiRequest(
            "GET",
            "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee",
            creds.access_token,
            apiVersion
          )

          if (!result.elements || result.elements.length === 0) {
            return json({ organizations: [], message: "No manageable organizations found." })
          }

          const orgs = result.elements.map((acl: any) => ({
            organizationUrn: acl.organization,
            role: acl.role,
          }))

          return json({ organizations: orgs })
        } catch (e) { return err(e) }
      }
    )

    // ── Tool: Status ────────────────────────────────────────────────────────
    this.server.tool(
      "linkedin_status",
      "Show server configuration and account token status",
      {},
      async () => {
        const accounts: Record<string, unknown> = {}
        const secretMap: Record<string, string | undefined> = {
          personal: this.env.LINKEDIN_TOKEN_PERSONAL,
          mobicycle: this.env.LINKEDIN_TOKEN_MOBICYCLE,
          'mobicycle-productions': this.env.LINKEDIN_TOKEN_MOBICYCLE_PRODUCTIONS,
        }

        for (const [key, acct] of Object.entries(ACCOUNTS)) {
          try {
            const token = secretMap[key]
            if (!token) {
              accounts[key] = { label: acct.label, status: "no_secret_configured", authorUrn: acct.authorUrn }
              continue
            }

            // Try to parse as JSON to get metadata
            let tokenData: any = { access_token: token }
            try {
              const parsed = JSON.parse(token)
              if (parsed.access_token) {
                tokenData = parsed
              }
            } catch {
              // Not JSON, just use as raw token
            }

            const info: Record<string, unknown> = {
              label: acct.label,
              status: "token_present",
              scope: tokenData.scope || acct.scope,
              authorUrn: acct.authorUrn,
            }

            if (tokenData.generated_at && tokenData.expires_in) {
              const expiresAt = new Date(new Date(tokenData.generated_at).getTime() + tokenData.expires_in * 1000)
              info.expiresAt = expiresAt.toISOString()
              info.daysLeft = Math.round((expiresAt.getTime() - Date.now()) / 86400000)
            }

            accounts[key] = info
          } catch {
            accounts[key] = { label: acct.label, status: "error_reading_secret" }
          }
        }

        return json({
          server: "linkedin-mcp-http",
          version: "1.0.0",
          apiEndpoint: "https://api.linkedin.com/rest/posts",
          apiVersion,
          storage: "Cloudflare Secrets",
          accounts,
        })
      }
    )
  }
}

// ── Cloudflare Worker Entry Point ───────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // MCP endpoint
    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      const id = env.MCP_AGENT.idFromName(url.searchParams.get('sessionId') || 'default')
      return env.MCP_AGENT.get(id).fetch(request)
    }

    // Health check endpoint
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({
        name: 'linkedin-mcp-http',
        version: '1.0.0',
        status: 'healthy',
        mcp_endpoint: '/mcp',
        storage: 'Cloudflare Secrets',
        tools: [
          'linkedin_post',
          'linkedin_post_article',
          'linkedin_format_post',
          'linkedin_validate_token',
          'linkedin_get_profile',
          'linkedin_list_posts',
          'linkedin_get_post',
          'linkedin_delete_post',
          'linkedin_list_organizations',
          'linkedin_status'
        ],
        accounts: Object.keys(ACCOUNTS)
      })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
}
