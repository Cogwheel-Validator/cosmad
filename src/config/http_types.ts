import { type } from "arktype";

// Mirrors the options of hono's `cors()` / `csrf()` middleware. Function-valued options are
// omitted since they can't be expressed in TOML.

export const CorsConfig = type({
  // Access-Control-Allow-Origin. Defaults to "*" when unset.
  "origin?": "string | string[]",
  // Access-Control-Allow-Methods. Hono default: GET, HEAD, PUT, POST, DELETE, PATCH, QUERY.
  "allowMethods?": "string[]",
  // Access-Control-Allow-Headers.
  "allowHeaders?": "string[]",
  // Access-Control-Max-Age, in seconds.
  "maxAge?": "number.integer",
  // Access-Control-Allow-Credentials.
  "credentials?": "boolean",
  // Access-Control-Expose-Headers.
  "exposeHeaders?": "string[]",
});

const SecFetchSite = type("'same-origin' | 'same-site' | 'none' | 'cross-site'");

export const CsrfConfig = type({
  // Allowed origins. Hono default: only the request's own origin.
  "origin?": "string | string[]",
  // Allowed Sec-Fetch-Site values. Hono default: only "same-origin".
  "secFetchSite?": type.or(SecFetchSite, SecFetchSite.array()),
});

export type CorsConfigType = typeof CorsConfig.infer;
export type CsrfConfigType = typeof CsrfConfig.infer;
