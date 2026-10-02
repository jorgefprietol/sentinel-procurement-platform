package io.sentinel;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

public final class Security {
  private Security() {}

  public record Actor(UUID id, String tenant, String username, String role) {}

  public record Login(String username, String password) {}

  public record Purchase(String title, Long amountCents, String vendor) {}

  public record Decision(String decision) {}

  public static final class Failure extends RuntimeException {
    public final int status;

    public Failure(int status, String code) {
      super(code);
      this.status = status;
    }
  }

  static final ObjectMapper JSON =
      com.fasterxml.jackson.databind.json.JsonMapper.builder()
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
          .disable(com.fasterxml.jackson.databind.MapperFeature.ALLOW_COERCION_OF_SCALARS)
          .build();
  static final SecureRandom RANDOM = new SecureRandom();

  public static String required(String key) {
    var value = System.getenv(key);
    if (value == null || value.length() < 16)
      throw new IllegalStateException("Missing or weak " + key);
    return value;
  }

  static byte[] derive(String password, byte[] salt) {
    try {
      var spec = new PBEKeySpec(password.toCharArray(), salt, 600_000, 256);
      try {
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(spec)
            .getEncoded();
      } finally {
        spec.clearPassword();
      }
    } catch (Exception e) {
      throw new IllegalStateException("KDF unavailable", e);
    }
  }

  public static String passwordHash(String password) {
    var salt = new byte[16];
    RANDOM.nextBytes(salt);
    return Base64.getEncoder().encodeToString(salt)
        + ":"
        + Base64.getEncoder().encodeToString(derive(password, salt));
  }

  public static boolean verify(String password, String stored) {
    var parts = stored.split(":");
    return MessageDigest.isEqual(
        Base64.getDecoder().decode(parts[1]),
        derive(password, Base64.getDecoder().decode(parts[0])));
  }

  public static String hash(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public static <T> T body(HttpServletRequest request, Class<T> type) {
    if (request.getContentType() == null
        || !request.getContentType().split(";")[0].equals("application/json"))
      throw new Failure(415, "json_required");
    try {
      var bytes = request.getInputStream().readNBytes(8193);
      if (bytes.length > 8192) throw new Failure(413, "body_too_large");
      var result = JSON.readValue(bytes, type);
      if (result == null) throw new Failure(400, "invalid_body");
      return result;
    } catch (Failure e) {
      throw e;
    } catch (Exception e) {
      throw new Failure(400, "invalid_body");
    }
  }

  public static void validate(Purchase p) {
    if (p.title() == null
        || p.title().trim().length() < 3
        || p.title().trim().length() > 120
        || p.amountCents() == null
        || p.amountCents() < 1
        || p.amountCents() > 1_000_000
        || p.vendor() == null
        || !Set.of("acme", "globex").contains(p.vendor()))
      throw new Failure(400, "invalid_purchase");
  }

  public static void approver(Actor actor) {
    if (!actor.role().equals("APPROVER")) throw new Failure(403, "forbidden");
  }

  public static UUID uuid(String value) {
    try {
      var id = UUID.fromString(value);
      if (!id.toString().equalsIgnoreCase(value)) throw new IllegalArgumentException();
      return id;
    } catch (Exception e) {
      throw new Failure(400, "invalid_id");
    }
  }
}
