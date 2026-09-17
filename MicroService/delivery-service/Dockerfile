# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9.9-amazoncorretto-17-alpine AS builder
WORKDIR /build
# Each service is self-contained (parent pom only provides pluginManagement)
COPY delivery-service/pom.xml pom.xml
COPY delivery-service/src     src
RUN mvn package -DskipTests --no-transfer-progress

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM amazoncorretto:17-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
EXPOSE 8085
ENTRYPOINT ["sh","-c","echo -e 'nameserver 8.8.8.8\nnameserver 8.8.4.4' > /etc/resolv.conf && exec java $JAVA_OPTS -jar app.jar"]
