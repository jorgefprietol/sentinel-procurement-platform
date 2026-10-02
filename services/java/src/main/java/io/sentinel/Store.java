package io.sentinel;

import static io.sentinel.Security.*;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class Store {
  private final JdbcTemplate db;
  private final TransactionTemplate transactions;
  private static final String DUMMY = passwordHash("unavailable-account");

  public Store(JdbcTemplate db, TransactionTemplate transactions) {
    this.db = db;
    this.transactions = transactions;
  }

  public void seed(String password) {
    for (var user :
        List.of(
            new String[] {"alice", "north", "REQUESTER"},
            new String[] {"bob", "north", "REQUESTER"},
            new String[] {"carol", "south", "REQUESTER"},
            new String[] {"approver", "north", "APPROVER"},
            new String[] {"south.approver", "south", "APPROVER"})) {
      db.update(
          "INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT (username) DO NOTHING",
          UUID.randomUUID(),
          user[1],
          user[0],
          user[2],
          passwordHash(password));
    }
  }

  public void limit(String key, int maximum, int seconds) {
    db.update("DELETE FROM rate_buckets WHERE expires_at < now() - interval '1 hour'");
    var count =
        db.queryForObject(
            "INSERT INTO rate_buckets VALUES (?,1,now()+make_interval(secs=>?)) ON CONFLICT"
                + " (bucket_key) DO UPDATE SET count=CASE WHEN rate_buckets.expires_at<=now() THEN"
                + " 1 ELSE rate_buckets.count+1 END, expires_at=CASE WHEN"
                + " rate_buckets.expires_at<=now() THEN EXCLUDED.expires_at ELSE"
                + " rate_buckets.expires_at END RETURNING count",
            Integer.class,
            key,
            seconds);
    if (count != null && count > maximum) throw new Failure(429, "rate_limited");
  }

  public String login(Login login) {
    if (login.username() == null
        || login.password() == null
        || login.username().length() > 80
        || login.password().length() > 256) throw new Failure(400, "invalid_body");
    limit("login-account:" + hash(login.username().toLowerCase(Locale.ROOT)), 8, 60);
    var users =
        db.query(
            "SELECT id,password_hash FROM users WHERE username=?",
            (r, n) -> Map.of("id", r.getObject(1, UUID.class), "hash", r.getString(2)),
            login.username());
    boolean valid =
        verify(login.password(), users.isEmpty() ? DUMMY : (String) users.getFirst().get("hash"));
    if (!valid || users.isEmpty()) throw new Failure(401, "invalid_credentials");
    var bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    var token = HexFormat.of().formatHex(bytes);
    db.update("DELETE FROM sessions WHERE expires_at<now()");
    db.update(
        "INSERT INTO sessions VALUES (?,?,now()+interval '30 minutes')",
        hash(token),
        users.getFirst().get("id"));
    return token;
  }

  public Actor authenticate(String token) {
    if (token == null || token.length() != 64) throw new Failure(401, "unauthenticated");
    var users =
        db.query(
            "SELECT u.id,u.tenant,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id"
                + " WHERE s.token_hash=? AND s.expires_at>now()",
            (r, n) ->
                new Actor(
                    r.getObject(1, UUID.class), r.getString(2), r.getString(3), r.getString(4)),
            hash(token));
    if (users.isEmpty()) throw new Failure(401, "unauthenticated");
    return users.getFirst();
  }

  public void logout(String token) {
    db.update("DELETE FROM sessions WHERE token_hash=?", hash(token));
  }

  public boolean healthy() {
    return Objects.equals(db.queryForObject("SELECT 1", Integer.class), 1);
  }

  private static final String PROJECTION =
      "id,title,amount_cents,vendor,status,created_at,owner_id";
  private static final RowMapper<Map<String, Object>> PURCHASE =
      (r, n) ->
          Map.of(
              "id",
              r.getObject(1, UUID.class),
              "title",
              r.getString(2),
              "amountCents",
              r.getLong(3),
              "vendor",
              r.getString(4),
              "status",
              r.getString(5),
              "createdAt",
              r.getTimestamp(6).toInstant().toString(),
              "ownerId",
              r.getObject(7, UUID.class));

  public List<Map<String, Object>> list(Actor actor, int limit) {
    return db.query(
        "SELECT "
            + PROJECTION
            + " FROM purchases WHERE tenant=? AND (?='APPROVER' OR owner_id=?) ORDER BY created_at"
            + " DESC,id LIMIT ?",
        PURCHASE,
        actor.tenant(),
        actor.role(),
        actor.id(),
        limit);
  }

  public Map<String, Object> get(Actor actor, UUID id) {
    var rows =
        db.query(
            "SELECT "
                + PROJECTION
                + " FROM purchases WHERE id=? AND tenant=? AND (?='APPROVER' OR owner_id=?)",
            PURCHASE,
            id,
            actor.tenant(),
            actor.role(),
            actor.id());
    if (rows.isEmpty()) throw new Failure(404, "not_found");
    return rows.getFirst();
  }

  public record Creation(UUID id, boolean replay) {}

  public Creation create(Actor actor, Purchase purchase, UUID key) {
    validate(purchase);
    if (!actor.role().equals("REQUESTER")) throw new Failure(403, "forbidden");
    final String fingerprint;
    try {
      fingerprint = hash(JSON.writeValueAsString(purchase));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    return transactions.execute(
        status -> {
          db.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", UUID.class, actor.id());
          var previous =
              db.query(
                  "SELECT id,fingerprint FROM purchases WHERE owner_id=? AND idempotency_key=?",
                  (r, n) -> Map.of("id", r.getObject(1, UUID.class), "fingerprint", r.getString(2)),
                  actor.id(),
                  key);
          if (!previous.isEmpty()) {
            if (!previous.getFirst().get("fingerprint").equals(fingerprint))
              throw new Failure(409, "idempotency_conflict");
            return new Creation((UUID) previous.getFirst().get("id"), true);
          }
          var count =
              db.queryForObject(
                  "SELECT count(*) FROM purchases WHERE owner_id=? AND"
                      + " created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE"
                      + " 'UTC'",
                  Long.class,
                  actor.id());
          if (count != null && count >= 5) throw new Failure(429, "daily_quota");
          var id = UUID.randomUUID();
          db.update(
              "INSERT INTO"
                  + " purchases(id,tenant,owner_id,title,amount_cents,vendor,idempotency_key,fingerprint)"
                  + " VALUES(?,?,?,?,?,?,?,?)",
              id,
              actor.tenant(),
              actor.id(),
              purchase.title().trim(),
              purchase.amountCents(),
              purchase.vendor(),
              key,
              fingerprint);
          audit(actor, "PURCHASE_CREATED", id);
          return new Creation(id, false);
        });
  }

  public void decide(Actor actor, UUID id, String decision) {
    approver(actor);
    if (decision == null || !Set.of("APPROVED", "REJECTED").contains(decision))
      throw new Failure(400, "invalid_decision");
    transactions.executeWithoutResult(
        status -> {
          var rows =
              db.query(
                  "SELECT owner_id,status FROM purchases WHERE id=? AND tenant=? FOR UPDATE",
                  (r, n) -> Map.of("owner", r.getObject(1, UUID.class), "status", r.getString(2)),
                  id,
                  actor.tenant());
          if (rows.isEmpty()) throw new Failure(404, "not_found");
          if (rows.getFirst().get("owner").equals(actor.id()))
            throw new Failure(403, "self_approval");
          if (!rows.getFirst().get("status").equals("PENDING"))
            throw new Failure(409, "already_decided");
          db.update(
              "UPDATE purchases SET status=? WHERE id=? AND tenant=?",
              decision,
              id,
              actor.tenant());
          audit(actor, "PURCHASE_" + decision, id);
        });
  }

  private void audit(Actor actor, String action, UUID id) {
    db.update(
        "INSERT INTO audit(tenant,actor,action,object_id) VALUES(?,?,?,?)",
        actor.tenant(),
        actor.username(),
        action,
        id);
  }

  public List<Map<String, Object>> auditList(Actor actor) {
    approver(actor);
    return db.query(
        "SELECT id,actor,action,object_id,created_at FROM audit WHERE tenant=? ORDER BY id DESC"
            + " LIMIT 50",
        (r, n) ->
            Map.of(
                "id",
                r.getLong(1),
                "actor",
                r.getString(2),
                "action",
                r.getString(3),
                "objectId",
                r.getObject(4, UUID.class),
                "createdAt",
                r.getTimestamp(5).toInstant().toString()),
        actor.tenant());
  }
}
