# Cascading Failure Prediction in Microservices

An intelligent microservices observability and failure-analysis platform that detects anomalies, analyzes failure propagation, identifies potential root causes, and predicts cascading failure risk using machine learning.

## Overview

Microservice architectures consist of multiple independent services that communicate with one another. A failure or performance degradation in one service can propagate to dependent services, resulting in a cascading failure.

This project aims to identify abnormal service behavior, analyze temporal relationships between anomalies, examine service dependencies, and predict cascade risk using telemetry and machine learning.

The platform is designed to support different microservice deployments through configurable service metadata, observability connections, dependency topology, and a standardized feature-extraction pipeline.

## Key Features

- **Dynamic Service Discovery:** Identifies available services using configured discovery sources and observability data.
- **Telemetry Collection:** Uses metrics, logs, and distributed traces to observe service behavior.
- **Z-Score Anomaly Detection:** Identifies unusual metric values against a deployment-specific baseline.
- **Temporal Analysis:** Examines anomaly timestamps and propagation delays to identify potential failure sequences.
- **Dependency Graph Analysis:** Uses NetworkX to represent service dependencies and analyze possible failure propagation.
- **Root Cause Analysis:** Identifies potential root-cause services using anomaly severity, timing, and dependency relationships.
- **Cascade Risk Prediction:** Uses a Random Forest classifier to predict cascade-related outcomes from extracted telemetry features.
- **Impact Analysis:** Identifies potentially affected services and calculates the affected-service percentage.
- **Recommendation Engine:** Generates recommendations based on observed anomalies and analysis results.
- **Developer Dashboard:** Presents service health, anomalies, dependency relationships, cascade predictions, impact, and recommendations.
- **Deployment-Specific Configuration:** Uses deployment configuration to describe service metadata, topology, SLAs, and observability endpoints.
- **Model Lifecycle Management:** Separates data collection, baseline calibration, model training, and live inference.

## System Architecture

```text
Microservice Deployment
          |
          v
   Telemetry Sources
   /       |        \
Metrics   Logs     Traces
   |       |          |
Prometheus Loki   OpenTelemetry
                      |
                    Jaeger
   \       |          /
          v
   Telemetry Collection
          |
          v
 Dynamic Service Discovery
          |
          v
 Feature Extraction
          |
    +-----+------+
    |            |
    v            v
 Z-Score     Temporal Analysis
    |            |
    +-----+------+
          |
          v
 Dependency Graph Analysis
       (NetworkX)
          |
          v
 Root Cause and Cascade Analysis
          |
          v
 Random Forest Classifier
          |
          v
 Prediction and Risk Assessment
          |
          v
 Recommendation Engine
          |
          v
 Developer Dashboard
```

The actual telemetry sources and dependency-discovery methods depend on the target deployment's configuration and available instrumentation.

## Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React.js |
| Microservice Backend | Java, Spring Boot |
| Analysis and ML | Python, Flask, Scikit-learn |
| Dependency Graph | NetworkX |
| Metrics | Prometheus |
| Visualization and Monitoring | Grafana |
| Logs | Loki |
| Distributed Tracing | OpenTelemetry, Jaeger |
| Containerization | Docker, Docker Compose |
| ML Model Storage | Joblib, JSON metadata |
| Configuration | YAML, environment variables |

## Project Structure

The following is the intended logical structure. Adapt paths to match the actual repository.

```text
project/
├── deployments/
│   └── omnistore/
│       └── deployment.yaml
├── ml/
│   ├── platform/
│   │   ├── deployment_config.py
│   │   ├── service_registry.py
│   │   ├── feature_extractor.py
│   │   └── baseline_calibrator.py
│   ├── train.py
│   ├── predict_api.py
│   └── model/
│       ├── cascade_rf_model.joblib
│       ├── features.json
│       └── model_metadata.json
├── analysis/
│   ├── zscore_anomaly.py
│   ├── temporal_analysis.py
│   └── dependency_graph.py
├── data-collection/
│   ├── collect_dataset.py
│   ├── onboard.py
│   └── dataset/
├── developer-dashboard/
├── microservices/
├── docker-compose.yml
└── README.md
```

## Prerequisites

Install or configure the following:

- Python 3.10 or a compatible project-supported version
- Java JDK compatible with the Spring Boot services
- Node.js and npm
- Docker Desktop with Docker Compose
- Prometheus, Grafana, Loki, and Jaeger
- Access to telemetry from the target microservice deployment

Verify installations:

```bash
python --version
java -version
node --version
npm --version
docker --version
docker compose version
```

## Configuration

Each deployment should have its own configuration file.

Example:

`deployments/omnistore/deployment.yaml`

```yaml
deployment:
  id: omnistore
  name: OmniStore
  version: "1.0"

services:
  - id: order
    label: Order Service
    port: 8081

  - id: payment
    label: Payment Service
    port: 8082

dependencies:
  - source: order
    target: payment

observability:
  prometheus_url: ${PROMETHEUS_URL}
  grafana_url: ${GRAFANA_URL}
  jaeger_url: ${JAEGER_URL}
  loki_url: ${LOKI_URL}
```

This is an illustrative configuration. Use the exact schema supported by `deployment_config.py` in the implementation.

Store environment-specific endpoints and credentials in environment variables or an untracked `.env` file. Do not commit passwords, API keys, tokens, or production credentials.

## Getting Started

### 1. Start the environment

From the project root:

```bash
docker compose up -d
```

Check container status:

```bash
docker compose ps
```

Inspect logs for any service that fails to start:

```bash
docker compose logs --tail 100
```

### 2. Configure observability

Ensure that the target microservices expose or export the telemetry required by the platform.

- **Prometheus:** Service metrics and performance indicators.
- **Loki:** Application logs, when configured.
- **OpenTelemetry and Jaeger:** Distributed traces and service-call relationships, when instrumentation is available.
- **Grafana:** Visualization of collected observability data.

Verify that the configured endpoints are reachable before running analysis.

### 3. Onboard a deployment

Run the onboarding command supported by the project:

```bash
python data-collection/onboard.py --deployment omnistore --mode baseline
```

This phase collects healthy-state telemetry and establishes a baseline for anomaly detection.

To collect a dataset for model training:

```bash
python data-collection/onboard.py --deployment omnistore --mode dataset
```

To execute the complete onboarding workflow:

```bash
python data-collection/onboard.py --deployment omnistore --mode all
```

Run only the modes implemented and supported by the current version.

### 4. Train the machine-learning model

After collecting a valid, labeled dataset:

```bash
python ml/train.py --deployment omnistore
```

The training process should validate the dataset, extract the configured feature schema, train the classifier, evaluate its performance, and save the model and metadata.

Training metrics should be reported from actual evaluation results rather than assumed values.

### 5. Start the prediction API

```bash
python ml/predict_api.py --deployment omnistore
```

Use the configured API address and port. If the API supports a live metrics endpoint, verify it using:

```bash
curl http://localhost:5001/metrics/live
```

The exact endpoint depends on the implementation. Confirm that telemetry and predictions are real and that unavailable sources are not silently represented as healthy values.

### 6. Start the developer dashboard

```bash
cd developer-dashboard
npm install
npm run dev
```

Open the local URL printed by the development server. Ensure the dashboard's API configuration points to the running prediction API.

## Machine Learning Workflow

### Data Collection

Collect telemetry during normal operation and controlled failure experiments. Where possible, record ground-truth labels based on the actual injected scenario and observed outcome.

Potential scenarios include:

- Service unavailability
- Increased latency
- Elevated HTTP 5xx error rates
- Request timeouts
- Database slowdown or unavailability
- Resource overload

Only execute fault-injection scenarios in environments where you have authorization.

### Feature Extraction

Convert telemetry into a consistent feature schema, such as:

- Request and error rates
- Latency percentiles
- Resource utilization, when available
- Z-score anomaly values
- Temporal relationships
- Dependency and graph features

Missing telemetry must be handled explicitly. Features should have consistent definitions and ordering between training and inference.

### Model Training

The Random Forest classifier learns from labeled feature vectors to predict the configured cascade outcome or risk class.

Model evaluation may include:

- Accuracy
- Precision
- Recall
- F1-score
- ROC-AUC, where appropriate

Use deployment-aware or time-aware test splits where appropriate to reduce leakage between training and evaluation data.

### Live Inference

During normal operation, the platform extracts features from incoming telemetry and loads the compatible trained model to produce predictions.

**The model is not retrained for every prediction.** Retraining is an explicit operation performed when justified by new labeled data, a model-quality issue, or an incompatible feature schema.

Baseline calibration and ML training are separate processes.

## Understanding Dashboard Percentages

The platform may display multiple percentages with different meanings.

- **Cascade Probability:** The classifier's estimated probability for the cascade class, when supported by the model.
- **Affected-Service Percentage:** The number of affected services divided by the number of relevant services, multiplied by 100.
- **Model Accuracy:** The fraction of test examples classified correctly during evaluation.

These values are not interchangeable.

If observability data or the prediction API is unavailable, the dashboard should display an unavailable state rather than interpreting missing data as zero risk or full system health.

## Generic Deployment Onboarding

To connect another microservice deployment:

1. Configure the observability endpoints and access permissions.
2. Discover services from the supported sources.
3. Obtain dependency information from distributed traces or deployment configuration.
4. Collect a healthy baseline.
5. Collect suitable labeled training data if a compatible model is not available.
6. Validate the feature schema and train a model if required.
7. Verify inference and dashboard output.
8. Test with controlled scenarios before relying on the platform for operational decisions.

The platform's ability to support a deployment depends on telemetry availability, instrumentation, permissions, compatible features, and validation. Dynamic service discovery alone does not guarantee that every dependency or failure can be detected.

## Security Considerations

- Use read-only access to observability systems wherever possible.
- Protect monitoring endpoints and prediction APIs.
- Store credentials in environment variables or a secret manager.
- Avoid committing `.env` files or model-training data containing sensitive information.
- Restrict fault injection to authorized test environments.
- Treat model predictions as decision-support information, not guaranteed root-cause proof.

## Limitations

- Root-cause identification is an inference and may not uniquely identify the true cause.
- Incomplete instrumentation can hide service dependencies.
- Model performance depends on dataset quality, label accuracy, and evaluation methodology.
- A model trained on one deployment may not generalize to another deployment without validation.
- Production use requires reliability, security, monitoring, and performance testing.

## Future Enhancements

- Broader automatic service discovery
- Improved dependency inference from distributed traces
- Support for additional observability backends
- Model comparison and probability calibration
- Drift monitoring and controlled retraining workflows
- Validation across different deployment topologies
- More detailed incident explanations and remediation guidance

## Project Goal

The goal is to develop a configurable microservice analysis platform that uses telemetry, anomaly detection, temporal analysis, dependency graphs, and machine learning to identify potential cascading failures and help developers understand their possible causes and impact.
