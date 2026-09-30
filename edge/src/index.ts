// Edge gate in front of the Go API on Vercel.
//
// Every service in this deployment runs on a free plan with no payment method,
// so abuse can never be billed; it can only use up an allowance. Vercel's free
// plan stops a project for the rest of its 30-day window when that happens, so
// this Worker caps the traffic that can reach it: per client IP, and in total
// per UTC day. Hitting either cap only fails requests until 00:00 UTC, when
// Cloudflare's own free quotas reset as well.
import { DurableObject } from 'cloudflare:workers'

type Usage = { day: string; count: number }

/** Counts the day's proxied API requests. There is a single global instance. */
export class Budget extends DurableObject<Env> {
  /** Spends one request from today's allowance, or returns false once it is gone. */
  async take(limit: number): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10)
    const usage = await this.ctx.storage.get<Usage>('usage')
    const count = usage?.day === day ? usage.count : 0
    if (count >= limit) return false
    await this.ctx.storage.put('usage', { day, count: count + 1 })
    return true
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    // run_worker_first only sends /api/* here; anything else is an asset.
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    if (!(await env.IP_LIMITER.limit({ key: ip })).success) {
      return error(429, 'アクセスが集中しています。少し待ってからやり直してください')
    }
    const budget = env.BUDGET.get(env.BUDGET.idFromName('global'))
    if (!(await budget.take(Number(env.DAILY_API_LIMIT)))) {
      return error(503, '本日の受付上限に達しました。明日 9:00 以降に再度お試しください')
    }

    const headers = new Headers(request.headers)
    headers.delete('Host')
    return origin(env, url.pathname + url.search, { method: request.method, headers, body: request.body })
  },

  async scheduled(_controller, env) {
    const res = await origin(env, '/readyz', { method: 'GET' })
    if (!res.ok) throw new Error(`readiness probe failed: HTTP ${res.status}`)
  },
} satisfies ExportedHandler<Env>

/** Calls the Vercel origin, which refuses requests without the shared secret. */
function origin(env: Env, path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-Origin-Auth', env.ORIGIN_SECRET)
  return fetch(new URL(path, env.ORIGIN_URL), { ...init, headers, redirect: 'manual' })
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}
