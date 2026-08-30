# OmniStore Microservices Platform

Full-stack Spring Boot 3.5 + MongoDB Atlas + React 19 microservices platform. Foundation for the **Cascading Failure Prediction** research project.

---

## Architecture

```
React Frontend (3000)
        │
   API Gateway (8080)
        │
   ┌────┴──────────────────────────────────────┐
   │          │           │           │         │
Order(8081) Payment(8082) Inventory(8083) Shipping(8084)
   │          │                        │
Notification(8086)              Delivery(8085)

Observability (all services → these):
  Prometheus (9090) ←── /actuator/prometheus on every service
  Jaeger     (16686) ←── OTLP traces from every service
  Loki       (3100) ←── Promtail tails Docker container logs
  Grafana    (3001) ←── Unified dashboard (Prometheus + Loki + Jaeger)
```

---

## Services & Ports

| Container            | Port  | Role                          |
|----------------------|-------|-------------------------------|
| api-gateway          | 8080  | Central HTTP proxy            |
| order-service        | 8081  | Order orchestration           |
| payment-service      | 8082  | Payment processing            |
| inventory-service    | 8083  | Stock management              |
| shipping-service     | 8084  | Logistics dispatch            |
| delivery-service     | 8085  | Delivery tracking             |
| notification-service | 8086  | Event notifications           |
| frontend (nginx)     | 3000  | React SPA                     |
| prometheus           | 9090  | Metrics scrape & storage      |
| grafana              | 3001  | Observability dashboards      |
| loki                 | 3100  | Log aggregation               |
| jaeger               | 16686 | Distributed trace UI          |

---

## Run locally (no Docker)

```bash
# 1. Build all Spring Boot JARs
cd MicroService
mvn clean package -DskipTests

# 2. Start each service (separate terminals)
cd order-service      && mvn spring-boot:run
cd payment-service    && mvn spring-boot:run
cd inventory-service  && mvn spring-boot:run
cd shipping-service   && mvn spring-boot:run
cd delivery-service   && mvn spring-boot:run
cd notification-service && mvn spring-boot:run
cd api-gateway        && mvn spring-boot:run

# 3. Start frontend
cd ../frontend && npm install && npm run dev
```

---

## Run with Docker Compose (full stack)

```bash
cd MicroService

# Build JARs first (Dockerfiles copy pre-built JAR from target/)
mvn clean package -DskipTests

# Start everything — microservices + observability stack
docker compose up --build
```

Startup order (automatic via health checks):
1. Jaeger, Prometheus, Loki → start immediately
2. Promtail, Grafana → after Loki
3. Leaf services (notification, delivery, inventory)
4. Mid-tier (payment, shipping)
5. Order service
6. API Gateway
7. Frontend

---

## Failure Injection API

Every microservice exposes `/fault/**` endpoints to inject failures. The API Gateway routes them with the pattern:

```
POST /fault/{service-name}/configure
POST /fault/{service-name}/reset
GET  /fault/{service-name}/status
```

**Fault types:** `NONE` | `LATENCY` | `ERROR` | `DOWN`

Examples (via Gateway on port 8080):

```bash
# Inject 3-second latency on payment-service
curl -X POST http://localhost:8080/fault/payment-service/configure \
     -H "Content-Type: application/json" \
     -d '{"fault":"LATENCY","delayMs":3000}'

# Make inventory-service return HTTP 503
curl -X POST http://localhost:8080/fault/inventory-service/configure \
     -H "Content-Type: application/json" \
     -d '{"fault":"DOWN"}'

# Make shipping-service return HTTP 500
curl -X POST http://localhost:8080/fault/shipping-service/configure \
     -H "Content-Type: application/json" \
     -d '{"fault":"ERROR"}'

# Reset all back to normal
for svc in order-service payment-service inventory-service shipping-service delivery-service notification-service; do
  curl -X POST http://localhost:8080/fault/$svc/reset
done

# Check current fault state
curl http://localhost:8080/fault/order-service/status
```

---

## Observability Endpoints

| URL                                          | What it shows                     |
|----------------------------------------------|-----------------------------------|
| http://localhost:9090                        | Prometheus query UI               |
| http://localhost:3001  (admin/admin)         | Grafana dashboards                |
| http://localhost:16686                       | Jaeger trace explorer             |
| http://localhost:3100/ready                  | Loki ready check                  |
| http://localhost:808X/actuator/health        | Individual service health         |
| http://localhost:808X/actuator/prometheus    | Prometheus scrape endpoint        |

---

## Order Cascade Flow

```
POST /orders
  1. Save order (PENDING)
  2. → POST inventory-service /inventory/deduct
  3. → POST payment-service   /payments          → POST notification /notifications
  4. → POST shipping-service  /shipments         → POST delivery /deliveries
                                                 → POST notification /notifications
  5. Update order (COMPLETED)
  6. → POST notification-service /notifications
```

---

## CI/CD (Jenkins)

Jenkinsfile at project root:
```
Checkout → Maven Build → Tests → npm Build → Docker Build (parallel 8) → Push → Smoke Test
```

Setup:
1. Create Jenkins Multibranch Pipeline pointed at this repo
2. Add `docker-hub-credentials` credential (Username+Password) in Jenkins
3. Set `DOCKER_HUB_REPO` in Jenkinsfile to your Docker Hub username

---

## Roadmap

- [x] 7 Spring Boot microservices (MongoDB Atlas)
- [x] Full order cascade: Order→Inventory→Payment→Shipping→Delivery→Notification
- [x] Custom API Gateway proxy with fault route rewriting
- [x] React 19 frontend (9 views, RBAC, mock fallback, order lifecycle tracker)
- [x] Dockerfiles for all 8 containers (curl for health checks)
- [x] docker-compose with proper container networking, health checks, depends_on
- [x] Spring Actuator + Micrometer Prometheus on all services
- [x] Micrometer Tracing + OTLP export to Jaeger on all services
- [x] Failure injection (NONE/LATENCY/ERROR/DOWN) on all 6 microservices
- [x] Fault routing via API Gateway
- [x] Prometheus config (scrapes all 7 services every 10s)
- [x] Loki config + Promtail (Docker log shipping)
- [x] Jaeger all-in-one (OTLP collector + UI)
- [x] Grafana (auto-provisioned datasources + microservices dashboard)
- [x] Jenkinsfile CI/CD pipeline
- [ ] Data collection scripts (normal + failure experiment runner)
- [ ] Z-score anomaly detection
- [ ] Temporal analysis + dependency graph
- [ ] Random Forest classifier for cascade risk prediction
- [ ] Developer dashboard (root cause, cascade path, risk, recommendations)
