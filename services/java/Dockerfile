FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY services/java/pom.xml .
RUN mvn -B dependency:go-offline
COPY services/java/src src
RUN mvn -B verify
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S sentinel && adduser -S -G sentinel sentinel
WORKDIR /app
COPY --from=build /src/target/sentinel-api-1.0.0.jar app.jar
USER sentinel
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=65", "-jar", "app.jar"]
