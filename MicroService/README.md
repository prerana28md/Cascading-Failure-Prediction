# Cascading Failure Prediction in Microservices — Backend Template

A simple Spring Boot + MySQL + REST microservice foundation.

## Services

- API Gateway: 8080
- Order Service: 8081
- Payment Service: 8082
- Inventory Service: 8083
- Shipping Service: 8084
- Delivery Service: 8085
- Notification Service: 8086
- MySQL: 3306

## Run locally

Build each service:

```bash
mvn clean package -DskipTests
```

Then start MySQL:

```bash
docker compose up mysql -d
```

Start each Spring Boot service from its directory:

```bash
mvn spring-boot:run
```

## Run with Docker

First package the services:

```bash
mvn clean package -DskipTests
```

Then:

```bash
docker compose up --build
```

## Basic endpoints

Order:
- POST /orders
- GET /orders
- GET /orders/{id}

Payment:
- POST /payments
- GET /payments
- GET /payments/{id}

Inventory:
- POST /inventory
- GET /inventory
- GET /inventory/{id}

Shipping:
- POST /shipments
- GET /shipments
- GET /shipments/{id}

Delivery:
- POST /deliveries
- GET /deliveries
- GET /deliveries/{id}

Notification:
- POST /notifications
- GET /notifications
- GET /notifications/{id}

Gateway health:
- GET /gateway/health

## Important

This is intentionally a template. The next extension is to implement actual REST-to-REST calls:

Order -> Inventory
Order -> Payment
Order -> Shipping -> Delivery
Order/Payment/Shipping -> Notification

After that, add failure injection, timeouts, retries, metrics, logs, traces, dependency analysis, and prediction.
