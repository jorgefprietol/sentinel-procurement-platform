package io.sentinel;

import static io.sentinel.Security.*;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.*;
import org.springframework.stereotype.Component;

@Component
public class Partner {
  private final HttpClient client =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(2))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();
  private final String token = required("PARTNER_TOKEN");

  public Map<String, Object> risk(String vendor) {
    if (!Set.of("acme", "globex").contains(vendor)) throw new Failure(400, "invalid_vendor");
    try {
      var request =
          HttpRequest.newBuilder(URI.create("http://partner:8080/vendors/" + vendor))
              .timeout(Duration.ofSeconds(3))
              .header("X-Partner-Token", token)
              .GET()
              .build();
      // BodyHandlers.ofByteArray would buffer untrusted data before checking its size.
      var future = client.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream());
      var response = future.get(3, TimeUnit.SECONDS);
      try (var stream = response.body()) {
        if (response.statusCode() != 200
            || !response
                .headers()
                .firstValue("Content-Type")
                .orElse("")
                .split(";")[0]
                .equals("application/json")) throw new Failure(502, "partner_unavailable");
        var reader =
            CompletableFuture.supplyAsync(
                () -> {
                  try {
                    return stream.readNBytes(4097);
                  } catch (Exception e) {
                    throw new CompletionException(e);
                  }
                });
        byte[] bytes;
        try {
          bytes = reader.get(3, TimeUnit.SECONDS);
        } finally {
          reader.cancel(true);
        }
        if (bytes.length > 4096) throw new Failure(502, "invalid_partner_response");
        var root = JSON.readTree(bytes);
        if (!root.isObject()
            || root.size() != 3
            || !root.path("vendor").asText().equals(vendor)
            || !root.path("score").isIntegralNumber()
            || !root.path("score").canConvertToInt()
            || root.path("score").intValue() < 0
            || root.path("score").intValue() > 100
            || !Set.of("LOW", "MEDIUM", "HIGH").contains(root.path("rating").asText()))
          throw new Failure(502, "invalid_partner_response");
        return Map.of(
            "vendor",
            vendor,
            "score",
            root.path("score").intValue(),
            "rating",
            root.path("rating").asText());
      }
    } catch (Failure e) {
      throw e;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new Failure(502, "partner_unavailable");
    } catch (Exception e) {
      throw new Failure(502, "partner_unavailable");
    }
  }
}
