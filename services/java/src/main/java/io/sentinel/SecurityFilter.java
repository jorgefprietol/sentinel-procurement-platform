package io.sentinel;

import static io.sentinel.Security.*;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class SecurityFilter extends OncePerRequestFilter {
  private final Store store;
  private final String origin = System.getenv("APP_ORIGIN");

  public SecurityFilter(Store store) {
    this.store = store;
    if (origin == null) throw new IllegalStateException("APP_ORIGIN required");
  }

  static String token(HttpServletRequest request) {
    if (request.getCookies() != null)
      for (var c : request.getCookies())
        if (c.getName().equals("sentinel_java")) return c.getValue();
    return null;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cache-Control", "no-store");
    try {
      if (request.getContentLengthLong() > 8192) throw new Failure(413, "body_too_large");
      if (request.getQueryString() != null && request.getQueryString().length() > 512)
        throw new Failure(400, "invalid_query");
      if (request.getMethod().equals("POST")
          && (!origin.equals(request.getHeader("Origin"))
              || !"web".equals(request.getHeader("X-Sentinel-Client"))))
        throw new Failure(403, "invalid_origin");
      var path = request.getRequestURI();
      if (path.equals("/api/v1/auth/login")) store.limit("login-global", 50, 60);
      else if (path.startsWith("/api/v1/") && !path.equals("/api/v1/meta")) {
        var actor = store.authenticate(token(request));
        request.setAttribute("actor", actor);
        store.limit("user:" + actor.id(), 120, 60);
      }
      chain.doFilter(request, response);
    } catch (Failure e) {
      error(response, e.status, e.getMessage());
    }
  }

  static void error(HttpServletResponse response, int status, String code) throws IOException {
    response.setStatus(status);
    response.setContentType("application/json");
    if (status == 429) response.setHeader("Retry-After", "60");
    JSON.writeValue(
        response.getOutputStream(), Map.of("code", code, "traceId", UUID.randomUUID().toString()));
  }
}
