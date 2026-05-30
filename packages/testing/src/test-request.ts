import type { Express } from "express";
import http from "http";

export interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  text: string;
}

export interface TestRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  user?: { id: string; email?: string; role?: string };
}

function injectToServer(
  app: Express,
  method: string,
  path: string,
  opts: TestRequestOptions = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const bodyStr = opts.body != null ? JSON.stringify(opts.body) : undefined;

      const reqHeaders: Record<string, string> = {
        "content-type": "application/json",
        ...opts.headers,
      };

      if (bodyStr) {
        reqHeaders["content-length"] = Buffer.byteLength(bodyStr).toString();
      }

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          method: method.toUpperCase(),
          path,
          headers: reqHeaders,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let body: any;
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[] | undefined>,
              body,
              text,
            });
          });
        },
      );

      req.on("error", (err) => {
        server.close();
        reject(err);
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

export function createTestRequest(app: Express) {
  return {
    get: (path: string, opts?: TestRequestOptions) => injectToServer(app, "GET", path, opts),
    post: (path: string, opts?: TestRequestOptions) => injectToServer(app, "POST", path, opts),
    put: (path: string, opts?: TestRequestOptions) => injectToServer(app, "PUT", path, opts),
    patch: (path: string, opts?: TestRequestOptions) => injectToServer(app, "PATCH", path, opts),
    delete: (path: string, opts?: TestRequestOptions) => injectToServer(app, "DELETE", path, opts),
  };
}
