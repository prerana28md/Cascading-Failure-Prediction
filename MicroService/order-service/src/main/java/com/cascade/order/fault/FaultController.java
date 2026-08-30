package com.cascade.order.fault;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Failure-injection control endpoints for order-service.
 *
 *  POST /fault/configure   { "fault": "LATENCY|ERROR|DOWN|NONE", "delayMs": 2000 }
 *  POST /fault/reset
 *  GET  /fault/status
 */
@RestController
@RequestMapping("/fault")
@CrossOrigin
public class FaultController {

    private final FaultState faultState;

    public FaultController(FaultState faultState) {
        this.faultState = faultState;
    }

    @PostMapping("/configure")
    public ResponseEntity<Map<String, Object>> configure(@RequestBody Map<String, Object> body) {
        String faultStr = (String) body.getOrDefault("fault", "NONE");
        int delayMs     = Integer.parseInt(body.getOrDefault("delayMs", "0").toString());

        FaultState.FaultType fault;
        try {
            fault = FaultState.FaultType.valueOf(faultStr.toUpperCase());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Unknown fault type: " + faultStr,
                                 "valid",  "NONE, LATENCY, ERROR, DOWN"));
        }

        faultState.configure(fault, delayMs);
        return ResponseEntity.ok(Map.of(
                "service",  "order-service",
                "fault",    fault.name(),
                "delayMs",  delayMs,
                "status",   "APPLIED"
        ));
    }

    @PostMapping("/reset")
    public ResponseEntity<Map<String, Object>> reset() {
        faultState.reset();
        return ResponseEntity.ok(Map.of("service", "order-service", "status", "RESET"));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        return ResponseEntity.ok(Map.of(
                "service", "order-service",
                "fault",   faultState.getActiveFault().name(),
                "delayMs", faultState.getDelayMs()
        ));
    }
}
