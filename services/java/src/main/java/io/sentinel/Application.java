package io.sentinel;

import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class Application {
  public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
  }

  @Bean
  CommandLineRunner seed(Store store) {
    return args -> {
      if ("true".equals(System.getenv("BOOTSTRAP_ENABLED")))
        store.seed(Security.required("BOOTSTRAP_PASSWORD"));
    };
  }
}
