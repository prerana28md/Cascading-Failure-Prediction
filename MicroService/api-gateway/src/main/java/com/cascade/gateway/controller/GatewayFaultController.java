package com.cascade.gateway.controller;

import com.cascade.gateway.fault.FaultEventSynchronizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.*;

/**
 * Authoritative Fault Injection Control endpoints on the API Gateway.
 *
 * Endpoints:
 *   POST /fault/configure          — configure fault on specified service
 *   POST /fault/reset              — reset fault on specified service, or ALL services
 *   GET  /fault/status             — get current live status across all microservices
 *   POST /fault/{service}/configure— path-based configure (for backwards compatibility)
 *   POST /fault/{service}/reset    — path-based reset
 *   GET  /fault/{service}/status   — path-based status
 */
@RestController
@CrossOrigin
public class GatewayFaultController {

    private static final Logger log = LoggerFactory.getLogger(GatewayFaultController.class);

    private final RestTemplate restTemplate;
    private final FaultEventSynchronizer faultEventSynchronizer;

    @Value("${service.order.url:http://localhost:8081}")
    private String orderServiceUrl;

    @Value("${service.payment.url:http://localhost:8082}")
    private String paymentServiceUrl;

    @Value("${service.inventory.url:http://localhost:8083}")
    private String inventoryServiceUrl;

    @Value("${service.shipping.url:http://localhost:8084}")
    private String shippingServiceUrl;

    @Value("${service.delivery.url:http://localhost:8085}")
    private String deliveryServiceUrl;

    @Value("${service.notification.url:http://localhost:8086}")
    private String notificationServiceUrl;

    private static final Set<String> VALID_FAULTS = Set.of("NONE", "LATENCY", "ERROR", "DOWN");

    public GatewayFaultController(RestTemplate restTemplate,
                                  FaultEventSynchronizer faultEventSynchronizer) {
        this.restTemplate = restTemplate;
        this.faultEventSynchronizer = faultEventSynchronizer;
    }

    public Map<String, String> getServiceUrlMap() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("order-service", orderServiceUrl);
        map.put("payment-service", paymentServiceUrl);
        map.put("inventory-service", inventoryServiceUrl);
        map.put("shipping-service", shippingServiceUrl);
        map.put("delivery-service", deliveryServiceUrl);
        map.put("notification-service", notificationServiceUrl);
        return map;
    }

    public String normalizeServiceName(String input) {
        if (input == null || input.isBlank()) return null;
        String s = input.trim().toLowerCase()
                .replace(" service", "")
                .replace(" ", "-")
                .replace("_", "-");
        if (!s.endsWith("-service")) {
            s = s + "-service";
        }
        return getServiceUrlMap().containsKey(s) ? s : null;
    }

    private List<String> dependenciesFor(String service) {
        return switch (service) {
            case "order-service" -> List.of("inventory-service", "payment-service", "shipping-service", "notification-service");
            case "shipping-service" -> List.of("delivery-service", "notification-service");
            case "payment-service" -> List.of("notification-service");
            default -> List.of();
        };
    }

    // ── Root /fault/configure ──────────────────────────────────────────────────

    @PostMapping("/fault/configure")
    public ResponseEntity<Map<String, Object>> configureRoot(@RequestBody(required = false) Map<String, Object> body) {
        if (body == null || body.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "Request body is required with 'service' and 'faultType'"
            ));
        }

        String rawService = String.valueOf(body.getOrDefault("service", ""));
        String service = normalizeServiceName(rawService);
        if (service == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "Invalid or unknown service: '" + rawService + "'. Valid: " + getServiceUrlMap().keySet()
            ));
        }

        String faultStr = body.containsKey("faultType")
                ? String.valueOf(body.get("faultType"))
                : String.valueOf(body.getOrDefault("fault", "NONE"));
        String faultType = faultStr.toUpperCase().trim();
        if (!VALID_FAULTS.contains(faultType)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "Unknown fault type: '" + faultStr + "'. Valid: " + VALID_FAULTS
            ));
        }

        Object delayVal = body.containsKey("delayMs")
                ? body.get("delayMs")
                : body.getOrDefault("delay_ms", 0);
        int delayMs;
        try {
            delayMs = Integer.parseInt(String.valueOf(delayVal));
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "delayMs must be an integer"
            ));
        }

        if (delayMs < 0) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "delayMs cannot be negative"
            ));
        }

        return applyFaultToService(service, faultType, delayMs);
    }

    // ── Root /fault/reset ──────────────────────────────────────────────────────

    @PostMapping("/fault/reset")
    public ResponseEntity<Map<String, Object>> resetRoot(@RequestBody(required = false) Map<String, Object> body) {
        String rawService = (body != null && body.containsKey("service"))
                ? String.valueOf(body.get("service")) : null;

        if (rawService != null && !rawService.equalsIgnoreCase("ALL") && !rawService.isBlank()) {
            String service = normalizeServiceName(rawService);
            if (service == null) {
                return ResponseEntity.badRequest().body(Map.of(
                        "success", false,
                        "error", "Invalid service: '" + rawService + "'. Valid: " + getServiceUrlMap().keySet()
                ));
            }
            return resetSingleService(service);
        }

        // Reset all services
        List<Map<String, Object>> results = new ArrayList<>();
        boolean allOk = true;
        for (String svc : getServiceUrlMap().keySet()) {
            ResponseEntity<Map<String, Object>> res = resetSingleService(svc);
            results.add(res.getBody());
            if (!Boolean.TRUE.equals(res.getBody().get("success"))) {
                allOk = false;
            }
        }

        return ResponseEntity.ok(Map.of(
                "success", allOk,
                "message", "All faults reset across all microservices",
                "results", results
        ));
    }

    // ── Root /fault/status ─────────────────────────────────────────────────────

    @GetMapping("/fault/status")
    public ResponseEntity<Map<String, Object>> statusRoot() {
        List<Map<String, Object>> services = new ArrayList<>();
        Map<String, String> serviceUrls = getServiceUrlMap();

        for (Map.Entry<String, String> entry : serviceUrls.entrySet()) {
            String svcName = entry.getKey();
            String url = entry.getValue() + "/fault/status";
            try {
                ResponseEntity<Map> resp = restTemplate.getForEntity(url, Map.class);
                if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                    Map<String, Object> body = resp.getBody();
                    String fault = String.valueOf(body.getOrDefault("fault", body.getOrDefault("faultType", "NONE")));
                    int delay = Integer.parseInt(String.valueOf(body.getOrDefault("delayMs", 0)));
                    boolean active = !"NONE".equalsIgnoreCase(fault);
                    services.add(Map.of(
                            "service", svcName,
                            "fault", fault,
                            "faultType", fault,
                            "delayMs", delay,
                            "active", active
                    ));
                } else {
                    services.add(Map.of(
                            "service", svcName,
                            "fault", "UNKNOWN",
                            "faultType", "UNKNOWN",
                            "delayMs", 0,
                            "active", false,
                            "error", "HTTP " + resp.getStatusCode()
                    ));
                }
            } catch (Exception e) {
                log.warn("Could not query fault status from {}: {}", svcName, e.getMessage());
                services.add(Map.of(
                        "service", svcName,
                        "fault", "UNKNOWN",
                        "faultType", "UNKNOWN",
                        "delayMs", 0,
                        "active", false,
                        "error", e.getMessage()
                ));
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("services", services);
        for (Map<String, Object> svc : services) {
            String name = (String) svc.get("service");
            if (name != null) {
                result.put(name, svc);
                if (name.endsWith("-service")) {
                    result.put(name.replace("-service", ""), svc);
                }
            }
        }
        return ResponseEntity.ok(result);
    }

    // ── Path-based /fault/{service}/configure ─────────────────────────────────

    @PostMapping("/fault/{serviceName}/configure")
    public ResponseEntity<Map<String, Object>> configurePath(@PathVariable String serviceName,
                                                             @RequestBody(required = false) Map<String, Object> body) {
        String service = normalizeServiceName(serviceName);
        if (service == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "Invalid or unknown service: '" + serviceName + "'"
            ));
        }

        Map<String, Object> payload = body != null ? new HashMap<>(body) : new HashMap<>();
        payload.put("service", service);
        return configureRoot(payload);
    }

    // ── Path-based /fault/{service}/reset ───────────────────────────────────────

    @PostMapping("/fault/{serviceName}/reset")
    public ResponseEntity<Map<String, Object>> resetPath(@PathVariable String serviceName) {
        String service = normalizeServiceName(serviceName);
        if (service == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "Invalid or unknown service: '" + serviceName + "'"
            ));
        }
        return resetSingleService(service);
    }

    // ── Path-based /fault/{service}/status ──────────────────────────────────────

    @GetMapping("/fault/{serviceName}/status")
    public ResponseEntity<Map<String, Object>> statusPath(@PathVariable String serviceName) {
        String service = normalizeServiceName(serviceName);
        if (service == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "error", "Service not found: '" + serviceName + "'"
            ));
        }

        String targetUrl = getServiceUrlMap().get(service) + "/fault/status";
        try {
            ResponseEntity<Map> resp = restTemplate.getForEntity(targetUrl, Map.class);
            if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                Map<String, Object> body = resp.getBody();
                String fault = String.valueOf(body.getOrDefault("fault", body.getOrDefault("faultType", "NONE")));
                int delay = Integer.parseInt(String.valueOf(body.getOrDefault("delayMs", 0)));
                return ResponseEntity.ok(Map.of(
                        "service", service,
                        "fault", fault,
                        "faultType", fault,
                        "delayMs", delay,
                        "active", !"NONE".equalsIgnoreCase(fault)
                ));
            }
            return ResponseEntity.status(resp.getStatusCode()).body(Map.of(
                    "service", service,
                    "error", "Target returned " + resp.getStatusCode()
            ));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "service", service,
                    "error", "Could not reach target service: " + e.getMessage()
            ));
        }
    }

    // ── Helper methods ────────────────────────────────────────────────────────

    private ResponseEntity<Map<String, Object>> applyFaultToService(String service, String faultType, int delayMs) {
        String targetUrl = getServiceUrlMap().get(service) + "/fault/configure";
        Map<String, Object> targetPayload = Map.of(
                "fault", faultType,
                "faultType", faultType,
                "delayMs", delayMs
        );

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(targetUrl, targetPayload, Map.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                String eventStatus = "NONE".equalsIgnoreCase(faultType) ? "RECOVERED" : "ACTIVE";
                String msg = "NONE".equalsIgnoreCase(faultType)
                        ? "Fault reset on " + service
                        : faultType + " fault activated on " + service + (delayMs > 0 ? " (delay: " + delayMs + "ms)" : "");

                faultEventSynchronizer.record(
                        service,
                        faultType,
                        delayMs,
                        eventStatus,
                        msg,
                        dependenciesFor(service)
                );

                log.warn("Gateway applied fault: service={} fault={} delayMs={}", service, faultType, delayMs);

                return ResponseEntity.ok(Map.of(
                        "success", true,
                        "service", service,
                        "faultType", faultType,
                        "delayMs", delayMs,
                        "message", msg
                ));
            } else {
                return ResponseEntity.status(response.getStatusCode()).body(Map.of(
                        "success", false,
                        "service", service,
                        "error", "Target service returned HTTP " + response.getStatusCode()
                ));
            }
        } catch (Exception e) {
            log.error("Failed to apply fault to {}: {}", service, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "success", false,
                    "service", service,
                    "error", "Failed to reach target service " + service + ": " + e.getMessage()
            ));
        }
    }

    private ResponseEntity<Map<String, Object>> resetSingleService(String service) {
        String targetUrl = getServiceUrlMap().get(service) + "/fault/reset";
        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(targetUrl, Map.of(), Map.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                faultEventSynchronizer.record(
                        service,
                        "NONE",
                        0,
                        "RECOVERED",
                        "Fault reset for " + service,
                        dependenciesFor(service)
                );
                log.info("Gateway reset fault: service={}", service);
                return ResponseEntity.ok(Map.of(
                        "success", true,
                        "service", service,
                        "message", "Fault reset for " + service
                ));
            } else {
                return ResponseEntity.status(response.getStatusCode()).body(Map.of(
                        "success", false,
                        "service", service,
                        "error", "Target service returned HTTP " + response.getStatusCode()
                ));
            }
        } catch (Exception e) {
            log.error("Failed to reset fault on {}: {}", service, e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "success", false,
                    "service", service,
                    "error", "Failed to reach target service " + service + ": " + e.getMessage()
            ));
        }
    }
}
