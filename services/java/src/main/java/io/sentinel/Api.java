package io.sentinel;

import static io.sentinel.Security.*;

import jakarta.servlet.http.*;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class Api {
  private final Store store;
  private final Partner partner;

  public Api(Store store, Partner partner) {
    this.store = store;
    this.partner = partner;
  }

  private Actor actor(HttpServletRequest r) {
    return (Actor) r.getAttribute("actor");
  }

  private void cookie(HttpServletResponse r, String value, int age) {
    var secure = !"false".equals(System.getenv("COOKIE_SECURE"));
    r.addHeader(
        "Set-Cookie",
        "sentinel_java="
            + value
            + "; Path=/; HttpOnly; SameSite=Strict; Max-Age="
            + age
            + (secure ? "; Secure" : ""));
  }

  @GetMapping("/health")
  Map<String, String> health() {
    if (!store.healthy()) throw new Failure(503, "unavailable");
    return Map.of("status", "UP");
  }

  @GetMapping("/api/v1/meta")
  Map<String, Object> meta() {
    return Map.of(
        "service",
        "sentinel-procurement",
        "implementation",
        "Spring Boot",
        "version",
        "1.0.0",
        "apiVersion",
        "v1",
        "controls",
        10);
  }

  @PostMapping("/api/v1/auth/login")
  Map<String, Boolean> login(HttpServletRequest r, HttpServletResponse response) {
    cookie(response, store.login(body(r, Login.class)), 1800);
    return Map.of("authenticated", true);
  }

  @PostMapping("/api/v1/auth/logout")
  ResponseEntity<Void> logout(HttpServletRequest r, HttpServletResponse response) {
    store.logout(SecurityFilter.token(r));
    cookie(response, "", 0);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/api/v1/me")
  Actor me(HttpServletRequest r) {
    return actor(r);
  }

  @GetMapping("/api/v1/purchases")
  List<Map<String, Object>> list(
      HttpServletRequest r, @RequestParam(defaultValue = "20") int limit) {
    if (limit < 1 || limit > 50) throw new Failure(400, "invalid_limit");
    return store.list(actor(r), limit);
  }

  @GetMapping("/api/v1/purchases/{id}")
  Map<String, Object> get(HttpServletRequest r, @PathVariable String id) {
    return store.get(actor(r), uuid(id));
  }

  @PostMapping("/api/v1/purchases")
  ResponseEntity<Map<String, Object>> create(HttpServletRequest r) {
    var key = r.getHeader("Idempotency-Key");
    if (key == null) throw new Failure(400, "idempotency_key_required");
    var result = store.create(actor(r), body(r, Purchase.class), uuid(key));
    return ResponseEntity.status(result.replay() ? 200 : 201)
        .body(store.get(actor(r), result.id()));
  }

  @PostMapping("/api/v1/purchases/{id}/decision")
  Map<String, Object> decision(HttpServletRequest r, @PathVariable String id) {
    var objectId = uuid(id);
    store.decide(actor(r), objectId, body(r, Decision.class).decision());
    return store.get(actor(r), objectId);
  }

  @GetMapping("/api/v1/audit")
  List<Map<String, Object>> audit(HttpServletRequest r) {
    return store.auditList(actor(r));
  }

  @GetMapping("/api/v1/vendors/{vendor}/risk")
  Map<String, Object> risk(@PathVariable String vendor) {
    return partner.risk(vendor);
  }
}
