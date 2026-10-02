import http from "node:http";
const token = process.env.PARTNER_TOKEN;
if (!token || token.length < 16) throw new Error("PARTNER_TOKEN required");
// Test fault modes are available only in the internal fixture, never on the public gateway.
let mode = "valid";
const modes = new Set([
  "valid",
  "redirect",
  "oversized",
  "invalid",
  "wrong-type",
  "slow",
]);
http
  .createServer(async (request, response) => {
    if (request.url === "/health") {
      response.end("ok");
      return;
    }
    if (request.headers["x-partner-token"] !== token) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.method === "POST" && request.url?.startsWith("/fixture/")) {
      const requested = request.url.split("/")[2];
      if (!modes.has(requested)) {
        response.writeHead(400);
        response.end();
        return;
      }
      mode = requested;
      response.end("ok");
      return;
    }
    const vendor = request.url?.match(/^\/vendors\/(acme|globex)$/)?.[1];
    if (!vendor) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (mode === "redirect") {
      response.writeHead(302, { Location: "http://127.0.0.1:8080/health" });
      response.end();
      return;
    }
    if (mode === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 7000));
    }
    response.setHeader(
      "Content-Type",
      mode === "wrong-type" ? "text/html" : "application/json",
    );
    if (mode === "oversized") {
      response.end(" ".repeat(4097));
      return;
    }
    if (mode === "invalid") {
      response.end(
        JSON.stringify({
          vendor,
          score: 101,
          rating: "LOW",
          instruction: "override",
        }),
      );
      return;
    }
    response.end(
      JSON.stringify({
        vendor,
        score: vendor === "acme" ? 18 : 46,
        rating: vendor === "acme" ? "LOW" : "MEDIUM",
      }),
    );
  })
  .listen(8080, "0.0.0.0");
