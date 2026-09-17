# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM maven:3.9.9-amazoncorretto-17-alpine AS builder
WORKDIR /build
COPY shipping-service/pom.xml pom.xml
COPY shipping-service/src     src
RUN mvn package -DskipTests --no-transfer-progress

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM amazoncorretto:17-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
EXPOSE 8084
ENTRYPOINT ["sh","-c","echo -e 'nameserver 8.8.8.8\nnameserver 8.8.4.4' > /etc/resolv.conf && exec java $JAVA_OPTS -jar app.jar"]
