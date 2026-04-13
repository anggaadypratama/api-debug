import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { logger } from "hono/logger";
import { cloneRawRequest } from "hono/request";
import { streamSSE } from "hono/streaming";
import type { FC } from "hono/jsx";

const app = new Hono();
let clients: Set<(data: string) => void> = new Set();

const Layout: FC<{ title: string; uuid: string; children?: any }> = (props) => {
  return (
    <html>
      <head>
        <title>{props.title}</title>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          const eventSource = new EventSource("/sse");
          eventSource.onmessage = (event) => {
            const log = JSON.parse(event.data);
            console.log(log);
            const container = document.getElementById("log-container");
            if (!container) return;
            const entry = document.createElement("pre");
            entry.style.borderBottom = "1px solid #ccc";
            entry.style.padding = "10px";
            entry.style.backgroundColor = "#f9f9f9";
            entry.textContent = JSON.stringify(log, null, 2);
            container.prepend(entry);
          };
        `,
          }}
        />
      </head>
      <body
        style={{ fontFamily: "sans-serif", padding: "20px", lineHeight: "1.6" }}
      >
        {props.children}
      </body>
    </html>
  );
};

app.use(logger());

app.get("/", (c) => {
  let uuid = getCookie(c, "device_id");

  if (!uuid) {
    uuid = crypto.randomUUID();
    setCookie(c, "device_id", uuid, {
      path: "/",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "Lax",
    });
  }

  return c.html(
    <Layout title={`API Test Logger - ${uuid}`} uuid={uuid}>
      <h1>Live API Request Logs</h1>
      <div
        style={{
          background: "#eef",
          padding: "10px",
          borderRadius: "5px",
          marginBottom: "20px",
        }}
      >
        <strong>Device ID / UUID:</strong> <code>{uuid}</code>
        <p style={{ fontSize: "0.8em", color: "#666" }}>
          Gunakan ID ini untuk kirim request ke: <code>/debug/{uuid}</code>
        </p>
      </div>
      <div id="log-container"></div>
    </Layout>,
  );
});

app.all("/debug/:device_id", async (c) => {
  const deviceId = c.req.param("device_id");
  const uuid = getCookie(c, "device_id");

  if (deviceId !== uuid) {
    return c.text("Unauthorized");
  }

  const req = await cloneRawRequest(c.req);
  const body = req.method === "GET" ? null : await req.json();

  const log = {
    deviceId,
    timestamp: new Date().toISOString(),
    info: {
      method: req.method,
      url: req.url,
      headers: (() => {
        const h: Record<string, string> = {};
        req.headers.forEach((v, k) => (h[k] = v));
        return h;
      })(),
    },
    body,
  };

  clients.forEach((client) => client(JSON.stringify(log)));

  return c.text("Debug");
});

app.get("/sse", async (c) => {
  return streamSSE(c, async (stream) => {
    const id = getCookie(c, "device_id");

    const cb = (data: string) =>
      id &&
      stream.writeSSE({
        data,
      });

    clients.add(cb);

    stream.onAbort(() => {
      clients.delete(cb);
    });

    while (true) {
      await stream.sleep(1000);
    }
  });
});

export default app;
