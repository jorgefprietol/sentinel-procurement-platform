package io.sentinel;

import static io.sentinel.Security.*;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class SecurityRouting implements WebMvcConfigurer {
  private final Store store;
  private final String origin = System.getenv("APP_ORIGIN");

  public SecurityRouting(Store store) {
    this.store = store;
    if (origin == null) throw new IllegalStateException("APP_ORIGIN required");
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(
        new HandlerInterceptor() {
          @Override
          public boolean preHandle(
              HttpServletRequest request, HttpServletResponse response, Object handler) {
            if (handler instanceof HandlerMethod method) {
              // Authorization is tied to server-owned method metadata, with private access by
              // default.
              if (!method.hasMethodAnnotation(PublicEndpoint.class)) {
                var actor = store.authenticate(SecurityFilter.token(request));
                request.setAttribute("actor", actor);
                store.limit("user:" + actor.id(), 120, 60);
              }
              if (method.hasMethodAnnotation(PostMapping.class)) {
                if (!origin.equals(request.getHeader("Origin"))
                    || !"web".equals(request.getHeader("X-Sentinel-Client")))
                  throw new Failure(403, "invalid_origin");
              }
            }
            return true;
          }
        });
  }
}
