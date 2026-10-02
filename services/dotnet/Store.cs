using System.Security.Cryptography;
using System.Text.Json;
using Npgsql;

namespace Sentinel;

public sealed class Store(NpgsqlDataSource source)
{
    private static NpgsqlCommand Command(
        NpgsqlConnection connection,
        string sql,
        params object[] values
    )
    {
        var command = new NpgsqlCommand(sql, connection);
        foreach (var value in values)
            command.Parameters.Add(new NpgsqlParameter { Value = value });
        return command;
    }

    public async Task Seed(string password)
    {
        await using var connection = await source.OpenConnectionAsync();
        foreach (
            var user in new[]
            {
                ("alice", "north", "REQUESTER"),
                ("bob", "north", "REQUESTER"),
                ("carol", "south", "REQUESTER"),
                ("approver", "north", "APPROVER"),
                ("south.approver", "south", "APPROVER"),
            }
        )
        {
            await using var exists = Command(
                connection,
                "SELECT EXISTS (SELECT 1 FROM users WHERE username=$1)",
                user.Item1
            );
            if (await exists.ExecuteScalarAsync() is true)
                continue;
            await using var command = Command(
                connection,
                "INSERT INTO users VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO NOTHING",
                Guid.NewGuid(),
                user.Item2,
                user.Item1,
                user.Item3,
                Security.PasswordHash(password)
            );
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task<bool> Healthy()
    {
        await using var c = await source.OpenConnectionAsync();
        await using var cmd = Command(c, "SELECT 1");
        return await cmd.ExecuteScalarAsync() is not null;
    }

    public async Task Limit(string key, int maximum, int seconds)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var cleanup = Command(
            c,
            "DELETE FROM rate_buckets WHERE expires_at < now() - interval '1 hour'"
        );
        await cleanup.ExecuteNonQueryAsync();
        await using var cmd = Command(
            c,
            "INSERT INTO rate_buckets VALUES ($1,1,now()+make_interval(secs=>$2)) ON CONFLICT (bucket_key) DO UPDATE SET count=CASE WHEN rate_buckets.expires_at<=now() THEN 1 ELSE rate_buckets.count+1 END, expires_at=CASE WHEN rate_buckets.expires_at<=now() THEN EXCLUDED.expires_at ELSE rate_buckets.expires_at END RETURNING count",
            key,
            seconds
        );
        if (Convert.ToInt32(await cmd.ExecuteScalarAsync()) > maximum)
            throw new ApiError(429, "rate_limited");
    }

    public async Task<string> Login(Login login)
    {
        if (
            login.Username is null
            || login.Password is null
            || login.Username.Length > 80
            || login.Password.Length > 256
        )
            throw new ApiError(400, "invalid_body");
        await Limit("login-account:" + Security.Hash(login.Username.ToLowerInvariant()), 8, 60);
        await using var c = await source.OpenConnectionAsync();
        Guid? id = null;
        string? stored = null;
        await using (
            var cmd = Command(
                c,
                "SELECT id,password_hash FROM users WHERE username=$1",
                login.Username
            )
        )
        await using (var r = await cmd.ExecuteReaderAsync())
            if (await r.ReadAsync())
            {
                id = r.GetGuid(0);
                stored = r.GetString(1);
            }
        // Run the same KDF for unknown accounts to avoid an early-return timing oracle.
        var valid = Security.Verify(login.Password, stored ?? DummyHash);
        if (!valid || id is null)
            throw new ApiError(401, "invalid_credentials");
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        await using var clean = Command(c, "DELETE FROM sessions WHERE expires_at < now()");
        await clean.ExecuteNonQueryAsync();
        await using var insert = Command(
            c,
            "INSERT INTO sessions VALUES ($1,$2,now()+interval '30 minutes')",
            Security.Hash(token),
            id.Value
        );
        await insert.ExecuteNonQueryAsync();
        return token;
    }

    private static readonly string DummyHash = Security.PasswordHash("unavailable-account");

    public async Task<Actor> Authenticate(string? token)
    {
        if (token is null || token.Length != 64)
            throw new ApiError(401, "unauthenticated");
        await using var c = await source.OpenConnectionAsync();
        await using var cmd = Command(
            c,
            "SELECT u.id,u.tenant,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
            Security.Hash(token)
        );
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync())
            throw new ApiError(401, "unauthenticated");
        return new Actor(r.GetGuid(0), r.GetString(1), r.GetString(2), r.GetString(3));
    }

    public async Task Logout(string token)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var cmd = Command(
            c,
            "DELETE FROM sessions WHERE token_hash=$1",
            Security.Hash(token)
        );
        await cmd.ExecuteNonQueryAsync();
    }

    private const string Projection = "id,title,amount_cents,vendor,status,created_at,owner_id";

    private static object Purchase(NpgsqlDataReader r) =>
        new
        {
            id = r.GetGuid(0),
            title = r.GetString(1),
            amountCents = r.GetInt64(2),
            vendor = r.GetString(3),
            status = r.GetString(4),
            createdAt = r.GetDateTime(5).ToUniversalTime(),
            ownerId = r.GetGuid(6),
        };

    public async Task<List<object>> List(Actor actor, int limit)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var cmd = Command(
            c,
            $"SELECT {Projection} FROM purchases WHERE tenant=$1 AND ($2='APPROVER' OR owner_id=$3) ORDER BY created_at DESC,id LIMIT $4",
            actor.Tenant,
            actor.Role,
            actor.Id,
            limit
        );
        await using var r = await cmd.ExecuteReaderAsync();
        var rows = new List<object>();
        while (await r.ReadAsync())
            rows.Add(Purchase(r));
        return rows;
    }

    public async Task<object> Get(Actor actor, Guid id)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var cmd = Command(
            c,
            $"SELECT {Projection} FROM purchases WHERE id=$1 AND tenant=$2 AND ($3='APPROVER' OR owner_id=$4)",
            id,
            actor.Tenant,
            actor.Role,
            actor.Id
        );
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync() ? Purchase(r) : throw new ApiError(404, "not_found");
    }

    public async Task<(Guid Id, bool Replay)> Create(Actor actor, CreatePurchase purchase, Guid key)
    {
        Security.Validate(purchase);
        if (actor.Role != "REQUESTER")
            throw new ApiError(403, "forbidden");
        var fingerprint = Security.Hash(JsonSerializer.Serialize(purchase));
        await using var c = await source.OpenConnectionAsync();
        await using var tx = await c.BeginTransactionAsync();
        await using (
            var guard = Command(c, "SELECT id FROM users WHERE id=$1 FOR UPDATE", actor.Id)
        )
            await guard.ExecuteScalarAsync();
        await using (
            var prior = Command(
                c,
                "SELECT id,fingerprint FROM purchases WHERE owner_id=$1 AND idempotency_key=$2",
                actor.Id,
                key
            )
        )
        await using (var r = await prior.ExecuteReaderAsync())
        {
            if (await r.ReadAsync())
            {
                var existingId = r.GetGuid(0);
                if (r.GetString(1) != fingerprint)
                    throw new ApiError(409, "idempotency_conflict");
                await r.DisposeAsync();
                await tx.CommitAsync();
                return (existingId, true);
            }
        }
        await using (
            var count = Command(
                c,
                "SELECT count(*) FROM purchases WHERE owner_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
                actor.Id
            )
        )
            if (Convert.ToInt64(await count.ExecuteScalarAsync()) >= 5)
                throw new ApiError(429, "daily_quota");
        var id = Guid.NewGuid();
        await using (
            var insert = Command(
                c,
                "INSERT INTO purchases(id,tenant,owner_id,title,amount_cents,vendor,idempotency_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
                id,
                actor.Tenant,
                actor.Id,
                purchase.Title.Trim(),
                purchase.AmountCents,
                purchase.Vendor,
                key,
                fingerprint
            )
        )
            await insert.ExecuteNonQueryAsync();
        await Audit(c, actor, "PURCHASE_CREATED", id);
        await tx.CommitAsync();
        return (id, false);
    }

    public async Task Decide(Actor actor, Guid id, string decision)
    {
        Security.Approver(actor);
        if (decision is not ("APPROVED" or "REJECTED"))
            throw new ApiError(400, "invalid_decision");
        await using var c = await source.OpenConnectionAsync();
        await using var tx = await c.BeginTransactionAsync();
        await using (
            var cmd = Command(
                c,
                "SELECT owner_id,status FROM purchases WHERE id=$1 AND tenant=$2 FOR UPDATE",
                id,
                actor.Tenant
            )
        )
        await using (var r = await cmd.ExecuteReaderAsync())
        {
            if (!await r.ReadAsync())
                throw new ApiError(404, "not_found");
            if (r.GetGuid(0) == actor.Id)
                throw new ApiError(403, "self_approval");
            if (r.GetString(1) != "PENDING")
                throw new ApiError(409, "already_decided");
        }
        await using (
            var update = Command(
                c,
                "UPDATE purchases SET status=$1 WHERE id=$2 AND tenant=$3",
                decision,
                id,
                actor.Tenant
            )
        )
            await update.ExecuteNonQueryAsync();
        await Audit(c, actor, "PURCHASE_" + decision, id);
        await tx.CommitAsync();
    }

    private static async Task Audit(NpgsqlConnection c, Actor actor, string action, Guid id)
    {
        await using var cmd = Command(
            c,
            "INSERT INTO audit(tenant,actor,action,object_id) VALUES($1,$2,$3,$4)",
            actor.Tenant,
            actor.Username,
            action,
            id
        );
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<List<object>> AuditList(Actor actor)
    {
        Security.Approver(actor);
        await using var c = await source.OpenConnectionAsync();
        await using var cmd = Command(
            c,
            "SELECT id,actor,action,object_id,created_at FROM audit WHERE tenant=$1 ORDER BY id DESC LIMIT 50",
            actor.Tenant
        );
        await using var r = await cmd.ExecuteReaderAsync();
        var rows = new List<object>();
        while (await r.ReadAsync())
            rows.Add(
                new
                {
                    id = r.GetInt64(0),
                    actor = r.GetString(1),
                    action = r.GetString(2),
                    objectId = r.GetGuid(3),
                    createdAt = r.GetDateTime(4).ToUniversalTime(),
                }
            );
        return rows;
    }
}
