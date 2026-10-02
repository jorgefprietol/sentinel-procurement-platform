package io.sentinel;

import java.util.Map;
import java.util.UUID;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class Errors {
  @ExceptionHandler(Security.Failure.class)
  ResponseEntity<Map<String, String>> failure(Security.Failure e) {
    var builder = ResponseEntity.status(e.status);
    if (e.status == 429) {
      var now = java.time.Instant.now();
      var midnight =
          java.time.LocalDate.now(java.time.ZoneOffset.UTC)
              .plusDays(1)
              .atStartOfDay(java.time.ZoneOffset.UTC)
              .toInstant();
      builder.header(
          "Retry-After",
          e.getMessage().equals("daily_quota")
              ? Long.toString(java.time.Duration.between(now, midnight).getSeconds() + 1)
              : "60");
    }
    return builder.body(Map.of("code", e.getMessage(), "traceId", UUID.randomUUID().toString()));
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  ResponseEntity<Map<String, String>> invalid() {
    return ResponseEntity.badRequest().body(Map.of("code", "invalid_body"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, String>> generic(Exception e) {
    if (e instanceof org.springframework.web.servlet.resource.NoResourceFoundException)
      return ResponseEntity.status(404).body(Map.of("code", "not_found"));
    if (e instanceof org.springframework.web.HttpRequestMethodNotSupportedException)
      return ResponseEntity.status(405).body(Map.of("code", "method_not_allowed"));
    var trace = UUID.randomUUID().toString();
    LoggerFactory.getLogger(Errors.class)
        .error("Request failed with {}, trace {}", e.getClass().getSimpleName(), trace);
    return ResponseEntity.internalServerError()
        .body(Map.of("code", "internal_error", "traceId", trace));
  }
}
