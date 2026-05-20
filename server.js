import express from "express";

const app = express();

const FALLBACK_PAGE =
  "https://ir-netlify.github.io/NETLIFY/new/new.html";

const BLOCKED_HEADERS = [
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
];

const constructDestUrl = (domain, path, query) => {
  if (
    domain.startsWith("http://") ||
    domain.startsWith("https://")
  ) {
    return `${domain}${path}${query}`;
  }

  const isHttps =
    !domain.includes(":") ||
    domain.includes(":443") ||
    /^s\d+\./.test(domain);

  return `${isHttps ? "https://" : "http://"}${domain}${path}${query}`;
};

app.use(express.raw({
  type: "*/*",
  limit: "100mb",
}));

app.use(async (req, res) => {
  try {
    const destHost = req.headers["x-host"];

    // fallback page
    if (req.path === "/" && !destHost) {
      const wsCheck =
        (req.headers["upgrade"] || "").toLowerCase();

      if (wsCheck !== "websocket") {
        const fallbackRes = await fetch(FALLBACK_PAGE);

        const html = await fallbackRes.text();

        res.setHeader(
          "content-type",
          "text/html; charset=UTF-8"
        );

        return res.send(html);
      }
    }

    if (!destHost) {
      return res
        .status(400)
        .send("Invalid Request: Missing target host.");
    }

    const query = req.originalUrl.includes("?")
      ? "?" + req.originalUrl.split("?")[1]
      : "";

    const finalUrl = constructDestUrl(
      destHost,
      req.path,
      query
    );

    const proxyHeaders = {};

    let clientAddress = null;

    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();

      if (
        BLOCKED_HEADERS.includes(lowerKey) ||
        lowerKey.startsWith("x-nf-") ||
        lowerKey.startsWith("x-netlify-") ||
        lowerKey === "x-host"
      ) {
        continue;
      }

      if (lowerKey === "x-real-ip") {
        clientAddress = value;
        continue;
      }

      if (lowerKey === "x-forwarded-for") {
        if (!clientAddress) {
          clientAddress = value;
        }
        continue;
      }

      proxyHeaders[lowerKey] = value;
    }

    if (clientAddress) {
      proxyHeaders["x-forwarded-for"] =
        clientAddress;
    }

    const fetchConfig = {
      method: req.method,
      headers: proxyHeaders,
      redirect: "manual",
    };

    if (
      req.method !== "GET" &&
      req.method !== "HEAD"
    ) {
      fetchConfig.body = req.body;
    }

    const serverRes = await fetch(
      finalUrl,
      fetchConfig
    );

    res.status(serverRes.status);

    serverRes.headers.forEach((value, key) => {
      if (
        key.toLowerCase() !==
        "transfer-encoding"
      ) {
        res.setHeader(key, value);
      }
    });

    const buffer = Buffer.from(
      await serverRes.arrayBuffer()
    );

    res.send(buffer);

  } catch (err) {
    console.error(err);

    res
      .status(502)
      .send("Gateway Error: Connection Failed");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Proxy server running on port ${PORT}`
  );
});
