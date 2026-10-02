import "../scripts/env.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.APP_ORIGIN || "http://localhost:18130";
const password = process.env.BOOTSTRAP_PASSWORD;
assert.ok(password, "Generate .env with node scripts/bootstrap.mjs");
const report = [];
const purchase = {
  title: "Endpoint protection licenses",
  amountCents: 24900,
  vendor: "acme",
};
function fixture(mode) {
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "partner",
      "node",
      "-e",
      `fetch('http://localhost:8080/fixture/${mode}',{method:'POST',headers:{'X-Partner-Token':process.env.PARTNER_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)})`,
    ],
    { stdio: "pipe" },
  );
}
for (const engine of ["dotnet", "java"]) {
  const prefix = `${base}/${engine}/api/v1`;
  async function call(path, { cookie, body, headers = {}, method } = {}) {
    const response = await fetch(prefix + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        Origin: base,
        "X-Sentinel-Client": "web",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }
  async function check(id, name, action) {
    await action();
    report.push({ engine, risk: id, name, passed: true });
    console.log(`PASS ${engine} ${id}: ${name}`);
  }
  async function login(username) {
    const response = await call("/auth/login", {
      body: { username, password },
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Max-Age=1800/i);
    return setCookie.split(";")[0];
  }
  const alice = await login("alice"),
    bob = await login("bob"),
    carol = await login("carol"),
    approver = await login("approver"),
    south = await login("south.approver");
  const key = randomUUID();
  const created = await call("/purchases", {
    cookie: alice,
    body: purchase,
    headers: { "Idempotency-Key": key },
  });
  assert.equal(
    created.status,
    201,
    "Run this suite on fresh project volumes; it exercises the daily quota.",
  );
  const id = created.data.id;
  await check(
    "API1",
    "Owner and tenant isolation, including approval queries",
    async () => {
      assert.equal(
        (await call(`/purchases/${id}`, { cookie: alice })).status,
        200,
      );
      for (const cookie of [bob, carol, south])
        assert.equal((await call(`/purchases/${id}`, { cookie })).status, 404);
      for (const cookie of [bob, carol, south])
        assert.ok(
          !(await call("/purchases", { cookie })).data.some((p) => p.id === id),
        );
      assert.equal(
        (await call(`/purchases/${id}`, { cookie: approver })).status,
        200,
      );
      assert.equal(
        (
          await call(`/purchases/${id}/decision`, {
            cookie: south,
            body: { decision: "APPROVED" },
          })
        ).status,
        404,
      );
      // Identical operation keys must be independent across owners and tenants.
      for (const cookie of [bob, carol]) {
        const own = await call("/purchases", {
          cookie,
          body: purchase,
          headers: { "Idempotency-Key": key },
        });
        assert.equal(own.status, 201);
        assert.notEqual(own.data.id, id);
        assert.equal(
          (await call(`/purchases/${own.data.id}`, { cookie: alice })).status,
          404,
        );
        assert.equal(
          (await call(`/purchases/${own.data.id}`, { cookie })).status,
          200,
        );
      }
    },
  );
  await check(
    "API2",
    "Authentication, revocation and account throttling",
    async () => {
      assert.equal((await call("/purchases")).status, 401);
      assert.equal(
        (
          await call("/me", {
            cookie: "sentinel_cs=forged; sentinel_java=forged",
          })
        ).status,
        401,
      );
      const temporary = await login("alice");
      assert.equal(
        (await call("/auth/logout", { cookie: temporary, body: {} })).status,
        204,
      );
      assert.equal((await call("/me", { cookie: temporary })).status, 401);
      for (let i = 0; i < 8; i++)
        assert.equal(
          (
            await call("/auth/login", {
              body: { username: "unknown-account", password: "incorrect" },
            })
          ).status,
          401,
        );
      assert.equal(
        (
          await call("/auth/login", {
            body: { username: "unknown-account", password: "incorrect" },
          })
        ).status,
        429,
      );
    },
  );
  await check(
    "API3",
    "Reject mass assignment, scalar coercion and sensitive responses",
    async () => {
      for (const property of [
        "tenant",
        "ownerId",
        "status",
        "role",
        "passwordHash",
      ]) {
        const result = await call("/purchases", {
          cookie: alice,
          body: { ...purchase, [property]: "APPROVED" },
          headers: { "Idempotency-Key": randomUUID() },
        });
        assert.equal(result.status, 400);
      }
      for (const amountCents of ["24900", 12.5, 0, 1_000_001])
        assert.equal(
          (
            await call("/purchases", {
              cookie: alice,
              body: { ...purchase, amountCents },
              headers: { "Idempotency-Key": randomUUID() },
            })
          ).status,
          400,
        );
      assert.deepEqual(
        Object.keys(created.data).sort(),
        [
          "id",
          "title",
          "amountCents",
          "vendor",
          "status",
          "createdAt",
          "ownerId",
        ].sort(),
      );
      assert.ok(
        !JSON.stringify((await call("/me", { cookie: alice })).data).includes(
          "password",
        ),
      );
    },
  );
  await check(
    "API4",
    "Bounded bodies, pagination and persistent request limits",
    async () => {
      assert.equal(
        (await call("/purchases?limit=51", { cookie: alice })).status,
        400,
      );
      assert.equal(
        (await call("/purchases?limit=0", { cookie: alice })).status,
        400,
      );
      assert.equal(
        (
          await call("/purchases", {
            cookie: alice,
            body: { ...purchase, title: "x".repeat(9000) },
            headers: { "Idempotency-Key": randomUUID() },
          })
        ).status,
        413,
      );
      assert.equal(
        (await call("/purchases?limit=1", { cookie: alice })).data.length,
        1,
      );
    },
  );
  await check(
    "API5",
    "Function authorization and atomic approval decisions",
    async () => {
      assert.equal((await call("/audit", { cookie: alice })).status, 403);
      assert.equal(
        (
          await call(`/purchases/${id}/decision`, {
            cookie: alice,
            body: { decision: "APPROVED" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call("/purchases", {
            cookie: approver,
            body: purchase,
            headers: { "Idempotency-Key": randomUUID() },
          })
        ).status,
        403,
      );
      const races = await Promise.all(
        ["APPROVED", "REJECTED"].map((decision) =>
          call(`/purchases/${id}/decision`, {
            cookie: approver,
            body: { decision },
          }),
        ),
      );
      assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
      const auditResponse = await call("/audit", { cookie: approver });
      assert.equal(
        auditResponse.status,
        200,
        JSON.stringify(auditResponse.data),
      );
      assert.ok(
        Array.isArray(auditResponse.data),
        "Audit must return a JSON array",
      );
      const northAudit = auditResponse.data;
      assert.equal(
        northAudit.filter(
          (event) =>
            event.objectId === id && event.action !== "PURCHASE_CREATED",
        ).length,
        1,
      );
      assert.ok(
        !(await call("/audit", { cookie: south })).data.some(
          (event) => event.objectId === id,
        ),
      );
    },
  );
  await check(
    "API6",
    "Idempotency, payload conflicts and concurrent daily quota",
    async () => {
      const retries = await Promise.all(
        Array.from({ length: 3 }, () =>
          call("/purchases", {
            cookie: alice,
            body: purchase,
            headers: { "Idempotency-Key": key },
          }),
        ),
      );
      for (const result of retries) {
        assert.equal(result.status, 200);
        assert.equal(result.data.id, id);
      }
      assert.equal(
        (
          await call("/purchases", {
            cookie: alice,
            body: { ...purchase, amountCents: 100 },
            headers: { "Idempotency-Key": key },
          })
        ).status,
        409,
      );
      const burst = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          call("/purchases", {
            cookie: alice,
            body: { ...purchase, title: `Security purchase ${i}` },
            headers: { "Idempotency-Key": randomUUID() },
          }),
        ),
      );
      assert.equal(burst.filter((result) => result.status === 201).length, 4);
      assert.equal(
        burst.filter(
          (result) =>
            result.status === 429 && result.data.code === "daily_quota",
        ).length,
        4,
      );
      assert.equal(
        (await call("/purchases", { cookie: alice })).data.length,
        5,
      );
    },
  );
  await check(
    "API7",
    "Closed vendor catalog and no outbound redirects",
    async () => {
      assert.equal(
        (await call("/vendors/localhost/risk", { cookie: alice })).status,
        400,
      );
      assert.equal(
        (
          await call("/purchases", {
            cookie: bob,
            body: { ...purchase, vendor: "http://169.254.169.254" },
            headers: { "Idempotency-Key": randomUUID() },
          })
        ).status,
        400,
      );
      fixture("redirect");
      try {
        assert.equal(
          (await call("/vendors/acme/risk", { cookie: alice })).status,
          502,
        );
      } finally {
        fixture("valid");
      }
    },
  );
  await check(
    "API8",
    "CSRF origin checks, CSP, content type and safe errors",
    async () => {
      assert.equal(
        (
          await call("/auth/login", {
            body: { username: "alice", password },
            headers: { Origin: "https://untrusted.example" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call("/auth/logout", {
            cookie: alice,
            body: {},
            headers: { "X-Sentinel-Client": "" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call("/purchases", {
            cookie: alice,
            body: "{}",
            headers: {
              "Content-Type": "text/plain",
              "Idempotency-Key": randomUUID(),
            },
          })
        ).status,
        415,
      );
      const response = await call("/me", { cookie: alice });
      assert.match(
        response.headers.get("content-security-policy"),
        /frame-ancestors 'none'/,
      );
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("cache-control"), "no-store");
      const error = await call("/purchases", {
        cookie: alice,
        body: "{",
        headers: { "Idempotency-Key": randomUUID() },
      });
      assert.equal(error.status, 400);
      assert.ok(!JSON.stringify(error.data).match(/Exception|password|stack/i));
    },
  );
  await check(
    "API9",
    "Versioned API inventory and absent legacy/debug routes",
    async () => {
      assert.equal((await call("/meta")).data.apiVersion, "v1");
      for (const path of [
        `${base}/${engine}/api/v0/purchases`,
        `${base}/${engine}/debug`,
        `${base}/${engine}/actuator/env`,
      ])
        assert.equal((await fetch(path)).status, 404);
      assert.equal((await fetch(`${base}/openapi.yaml`)).status, 200);
    },
  );
  await check(
    "API10",
    "Untrusted response size, schema, MIME type and deadline",
    async () => {
      for (const mode of ["oversized", "invalid", "wrong-type", "slow"]) {
        fixture(mode);
        try {
          const started = performance.now();
          const result = await call("/vendors/acme/risk", { cookie: alice });
          assert.equal(result.status, 502);
          assert.ok(
            performance.now() - started < 6500,
            "Partner deadline must be bounded",
          );
        } finally {
          fixture("valid");
        }
      }
      const result = await call("/vendors/acme/risk", { cookie: alice });
      assert.equal(result.status, 200);
      assert.deepEqual(result.data, {
        vendor: "acme",
        score: 18,
        rating: "LOW",
      });
    },
  );
  await check(
    "API8",
    "PostgreSQL app role has append-only audit privileges",
    async () => {
      const database = `db-${engine}`;
      const sql = (query) =>
        execFileSync(
          "docker",
          [
            "compose",
            "exec",
            "-T",
            database,
            "sh",
            "-c",
            'PGPASSWORD="$APP_DB_PASSWORD" exec psql -U sentinel_app -d sentinel -v ON_ERROR_STOP=1 -At -c "$1"',
            "sentinel-sql",
            query,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      assert.equal(
        sql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user").trim(),
        "f",
      );
      assert.equal(
        sql(
          "SELECT has_table_privilege(current_user,'audit','SELECT') AND has_table_privilege(current_user,'audit','INSERT') AND NOT has_table_privilege(current_user,'audit','UPDATE') AND NOT has_table_privilege(current_user,'audit','DELETE') AND NOT has_table_privilege(current_user,'audit','TRUNCATE')",
        ).trim(),
        "t",
      );
      for (const query of [
        "UPDATE audit SET action='PURCHASE_CREATED' WHERE false",
        "DELETE FROM audit WHERE false",
        "TRUNCATE audit",
      ]) {
        assert.throws(
          () => sql(query),
          (error) => /permission denied/i.test(error.stderr),
        );
      }
      assert.ok(Number(sql("SELECT count(*) FROM audit").trim()) > 0);
    },
  );
  await check(
    "API6",
    "Sessions, idempotency and daily quotas survive process restart",
    async () => {
      execFileSync("docker", ["compose", "restart", engine], { stdio: "pipe" });
      let healthy = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          healthy = (await fetch(`${base}/${engine}/health`)).ok;
        } catch {
          /* startup window */
        }
        if (healthy) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.ok(healthy, "Restarted service must become ready");
      assert.equal((await call("/me", { cookie: alice })).status, 200);
      const replay = await call("/purchases", {
        cookie: alice,
        body: purchase,
        headers: { "Idempotency-Key": key },
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.data.id, id);
      const quota = await call("/purchases", {
        cookie: alice,
        body: purchase,
        headers: { "Idempotency-Key": randomUUID() },
      });
      assert.equal(quota.status, 429);
      assert.equal(quota.data.code, "daily_quota");
      assert.ok(Number(quota.headers.get("retry-after")) > 0);
    },
  );
  await check(
    "API4",
    "Authenticated request throttle cannot be bypassed by a new session",
    async () => {
      let limited;
      for (let i = 0; i < 125; i++) {
        const result = await call("/me", { cookie: carol });
        if (result.status === 429) {
          limited = result;
          break;
        }
        assert.equal(result.status, 200);
      }
      assert.equal(limited?.status, 429);
      assert.equal(limited.headers.get("retry-after"), "60");
      const anotherSession = await login("carol");
      assert.equal((await call("/me", { cookie: anotherSession })).status, 429);
    },
  );
}
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/security-results.json",
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      checks: report,
      total: report.length,
    },
    null,
    2,
  ),
);
console.log(
  `${report.length} security scenarios passed across both implementations.`,
);
