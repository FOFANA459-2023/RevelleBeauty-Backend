import { Container, getContainer } from '@cloudflare/containers';

/**
 * Cloudflare Containers wrapper for the Express API.
 *
 * Workers cannot run this server directly (raw Postgres TCP, sharp native
 * binaries, a long-lived listener). Containers can: the image built from
 * ./Dockerfile runs the real Node process, and this Worker forwards every
 * request to it.
 *
 * Secrets are NOT hardcoded here. They are set with `wrangler secret put`
 * and forwarded into the container process below.
 */

interface Env {
  API_CONTAINER: DurableObjectNamespace<ApiContainer>;
  [key: string]: unknown;
}

/** Env keys forwarded from the Worker into the container process. */
const FORWARDED = [
  'NODE_ENV',
  'FRONTEND_URL',
  'CORS_ORIGINS',
  'DATABASE_URL',
  'STORAGE_DRIVER',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CURRENCY',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_JWT_SECRET',
  'ADMIN_SESSION_HOURS',
] as const;

export class ApiContainer extends Container<Env> {
  /** Must match EXPOSE / PORT in the Dockerfile. */
  defaultPort = 4000;

  /**
   * Idle shutdown. The container cold-starts on the next request and reruns
   * migrations (forward-only, so that is safe). Raise this if cold starts
   * become noticeable to shoppers.
   */
  sleepAfter = '15m';

  override onStart(): void {
    console.log('revelle api container started');
  }

  override onError(error: unknown): Response {
    console.error('container error', error);
    return Response.json(
      { error: { code: 'container_error', message: 'API unavailable' } },
      { status: 502 },
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Pass through the configured environment (secrets included) so the
    // Express process sees exactly what it expects.
    const envVars: Record<string, string> = {};
    for (const key of FORWARDED) {
      const value = env[key];
      if (typeof value === 'string' && value !== '') envVars[key] = value;
    }

    // A single shared instance: the app is stateless, and one instance keeps
    // the Postgres connection pool warm. Scale by raising max_instances in
    // wrangler.jsonc and sharding this id.
    const container = getContainer(env.API_CONTAINER, 'revelle-api');
    return container.fetch(request, { envVars });
  },
};
