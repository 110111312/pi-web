import * as http from "node:http";
import type { BridgeEvent } from "../types.js";
import type {
  WsConnectionHandler,
  WsConnectionHandlerFactory,
} from "../server.js";

export const waitForAsyncWork = (ms = 100) =>
  new Promise(resolve => setTimeout(resolve, ms));

export const requestText = (
  url: string,
  options?: http.RequestOptions & { cookies?: Record<string, string> },
): Promise<{
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const opts: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options?.method ?? "GET",
      headers: {} as Record<string, string>,
    };
    if (options?.cookies) {
      (opts.headers as Record<string, string>)["Cookie"] = Object.entries(
        options.cookies,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }
    if (options?.headers) {
      Object.assign(opts.headers as Record<string, string>, options.headers);
    }
    const request = http.request(opts, response => {
      let body = "";
      response.on("data", chunk => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body,
          headers: response.headers,
        });
      });
    });
    request.on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy();
      reject(new Error("request timeout"));
    });
    request.end();
  });

export const createMockHandler = (): WsConnectionHandler => ({
  dispose: () => {},
});

export const createMockHandlerFactory = (
  handlers: WsConnectionHandler[],
): WsConnectionHandlerFactory => {
  return _ctx => {
    const handler = createMockHandler();
    handlers.push(handler);
    return handler;
  };
};

export const collectEvents = (events: BridgeEvent[]) => (event: BridgeEvent) =>
  events.push(event);