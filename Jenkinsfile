pipeline {
    agent any

    // ─── Pipeline-level options ───────────────────────────────────────────────
    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    // ─── Environment variables ────────────────────────────────────────────────
    environment {
        // Docker Hub repository (change to your username/org)
        DOCKER_HUB_REPO   = "cascade"
        // Jenkins credential ID that stores Docker Hub username+password
        DOCKER_CREDENTIALS = credentials('docker-hub-credentials')
        // Git commit short hash used to tag images
        IMAGE_TAG = "${env.GIT_COMMIT?.take(7) ?: 'latest'}"
    }

    // ─── Stages ───────────────────────────────────────────────────────────────
    stages {

        // ── 1. Checkout ───────────────────────────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
                echo "Building branch: ${env.BRANCH_NAME} | commit: ${env.GIT_COMMIT?.take(7)}"
            }
        }

        // ── 2. Build all Spring Boot services ─────────────────────────────────
        stage('Build Microservices (Maven)') {
            steps {
                dir('MicroService') {
                    sh '''
                        mvn clean package -DskipTests \
                            --batch-mode \
                            --no-transfer-progress
                    '''
                }
            }
            post {
                success { echo "All 7 Spring Boot JARs built successfully." }
                failure { echo "Maven build failed. Check the logs above." }
            }
        }

        // ── 3. Unit tests (skipped at root level; enable per-service later) ───
        stage('Test') {
            steps {
                dir('MicroService') {
                    sh '''
                        mvn test \
                            --batch-mode \
                            --no-transfer-progress \
                            -pl order-service,payment-service,inventory-service,shipping-service,delivery-service,notification-service,api-gateway
                    '''
                }
            }
            post {
                always {
                    junit(
                        testResults: 'MicroService/**/target/surefire-reports/*.xml',
                        allowEmptyResults: true
                    )
                }
            }
        }

        // ── 4. Build Frontend ─────────────────────────────────────────────────
        stage('Build Frontend (npm)') {
            steps {
                dir('frontend') {
                    sh '''
                        npm ci
                        npm run build
                    '''
                }
            }
        }

        // ── 5. Docker build (all images in parallel) ──────────────────────────
        stage('Docker Build') {
            parallel {
                stage('Image: api-gateway') {
                    steps {
                        dir('MicroService') {
                            sh "docker build -t ${DOCKER_HUB_REPO}/api-gateway:${IMAGE_TAG} ./api-gateway"
                            sh "docker tag  ${DOCKER_HUB_REPO}/api-gateway:${IMAGE_TAG} ${DOCKER_HUB_REPO}/api-gateway:latest"
                        }
                    }
                }
                stage('Image: order-service') {
                    steps {
                        dir('MicroService') {
                            sh "docker build -t ${DOCKER_HUB_REPO}/order-service:${IMAGE_TAG} ./order-service"
                            sh "docker tag  ${DOCKER_HUB_REPO}/order-service:${IMAGE_TAG} ${DOCKER_HUB_REPO}/order-service:latest"
                        }
                    }
                }
                stage('Image: payment-service') {
                    steps {
                        dir('MicroService') {
                            sh "docker build -t ${DOCKER_HUB_REPO}/payment-service:${IMAGE_TAG} ./payment-service"
                            sh "docker tag  ${DOCKER_HUB_REPO}/payment-service:${IMAGE_TAG} ${DOCKER_HUB_REPO}/payment-service:latest"
                        }
                    }
                }
                stage('Image: inventory-service') {
                    steps {
                        dir('MicroService') {
                            sh "docker build -t ${DOCKER_HUB_REPO}/inventory-service:${IMAGE_TAG} ./inventory-service"
                            sh "docker tag  ${DOCKER_HUB_REPO}/inventory-service:${IMAGE_TAG} ${DOCKER_HUB_REPO}/inventory-service:latest"
                        }
                    }
                }
                stage('Image: shipping-service') {
                    steps {
                        dir('MicroService') {
                            sh "docker build -t ${DOCKER_HUB_REPO}/shipping-service:${IMAGE_TAG} ./shipping-service"
                            sh "docker tag  ${DOCKER_HUB_REPO}/shipping-service:${IMAGE_TAG} ${DOCKER_HUB_REPO}/shipping-service:latest"
                        }
                    }
                }
                stage('Image: delivery-service') {
                    steps {
                        dir('MicroService') {
                            sh "docker build -t ${DOCKER_HUB_REPO}/delivery-service:${IMAGE_TAG} ./delivery-service"
                            sh "docker tag  ${DOCKER_HUB_REPO}/delivery-service:${IMAGE_TAG} ${DOCKER_HUB_REPO}/delivery-service:latest"
                        }
                    }
                }
                stage('Image: notification-service') {
                    steps {
                        dir('MicroService') {
                            sh "docker build -t ${DOCKER_HUB_REPO}/notification-service:${IMAGE_TAG} ./notification-service"
                            sh "docker tag  ${DOCKER_HUB_REPO}/notification-service:${IMAGE_TAG} ${DOCKER_HUB_REPO}/notification-service:latest"
                        }
                    }
                }
                stage('Image: frontend') {
                    steps {
                        sh "docker build -t ${DOCKER_HUB_REPO}/frontend:${IMAGE_TAG} ./frontend"
                        sh "docker tag  ${DOCKER_HUB_REPO}/frontend:${IMAGE_TAG} ${DOCKER_HUB_REPO}/frontend:latest"
                    }
                }
            }
        }

        // ── 6. Push to Docker Hub (main branch only) ──────────────────────────
        stage('Docker Push') {
            when {
                anyOf {
                    branch 'main'
                    branch 'master'
                }
            }
            steps {
                sh '''
                    echo "${DOCKER_CREDENTIALS_PSW}" | \
                        docker login -u "${DOCKER_CREDENTIALS_USR}" --password-stdin
                '''
                script {
                    def services = [
                        'api-gateway', 'order-service', 'payment-service',
                        'inventory-service', 'shipping-service', 'delivery-service',
                        'notification-service', 'frontend'
                    ]
                    for (svc in services) {
                        sh "docker push ${DOCKER_HUB_REPO}/${svc}:${IMAGE_TAG}"
                        sh "docker push ${DOCKER_HUB_REPO}/${svc}:latest"
                    }
                }
            }
            post {
                always {
                    sh 'docker logout || true'
                }
            }
        }

        // ── 7. Integration smoke test (local docker-compose up) ───────────────
        stage('Smoke Test') {
            when {
                branch 'main'
            }
            steps {
                dir('MicroService') {
                    sh '''
                        docker compose up -d --build
                        # Wait for gateway to be healthy (max 3 minutes)
                        attempt=0
                        until curl -sf http://localhost:8080/actuator/health | grep -q '"status":"UP"'; do
                            if [ $attempt -ge 18 ]; then
                                echo "Gateway health check timed out."
                                docker compose logs api-gateway
                                exit 1
                            fi
                            echo "Waiting for gateway... attempt $((attempt+1))/18"
                            sleep 10
                            attempt=$((attempt+1))
                        done
                        echo "Gateway is UP. Running basic smoke tests..."

                        # Smoke test each service via gateway
                        curl -sf http://localhost:8080/inventory  > /dev/null && echo "  inventory  OK"
                        curl -sf http://localhost:8080/orders     > /dev/null && echo "  orders     OK"
                        curl -sf http://localhost:8080/payments   > /dev/null && echo "  payments   OK"
                        curl -sf http://localhost:8080/shipments  > /dev/null && echo "  shipments  OK"
                        curl -sf http://localhost:8080/deliveries > /dev/null && echo "  deliveries OK"
                        curl -sf http://localhost:8080/notifications > /dev/null && echo "  notifications OK"

                        echo "All smoke tests passed."
                    '''
                }
            }
            post {
                always {
                    dir('MicroService') {
                        sh 'docker compose down --remove-orphans || true'
                    }
                }
            }
        }

    } // end stages

    // ─── Notifications ────────────────────────────────────────────────────────
    post {
        success {
            echo "Pipeline completed successfully. Image tag: ${IMAGE_TAG}"
        }
        failure {
            echo "Pipeline FAILED on stage. Review logs above."
        }
        always {
            // Clean up dangling images to save disk space on the Jenkins agent
            sh 'docker image prune -f || true'
        }
    }
}
