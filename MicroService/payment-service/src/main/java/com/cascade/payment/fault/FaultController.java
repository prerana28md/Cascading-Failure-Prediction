package com.cascade.payment.fault;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/fault")
@CrossOrigin
public class FaultController {

    private static final Logger log = LoggerFactory.getLogger(FaultController.class);
    private static final String SERVICE_NAME = "payment-service";

    private final FaultState faultState;
    public FaultController(FaultState faultState) { this.faultState = faultState; }

    @PostMapping("/configure")
    public ResponseEntity<Map<String, Object>> configure(@RequestBody Map<String, Object> body) {
        String faultStr = body.containsKey("faultType")
                ? String.valueOf(body.get("faultType"))
                : String.valueOf(body.getOrDefault("fault", "NONE"));

        Object delayVal = body.containsKey("delayMs")
                ? body.get("delayMs")
                : body.getOrDefault("delay_ms", 0);
        int delayMs;
        try {
            delayMs = Integer.parseInt(String.valueOf(delayVal));
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "delayMs must be an integer"));
        }

        if (delayMs < 0) {
            return ResponseEntity.badRequest().body(Map.of("error", "delayMs cannot be negative"));
        }

        FaultState.FaultType fault;
        try {
            fault = FaultState.FaultType.valueOf(faultStr.toUpperCase());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Unknown fault: " + faultStr));
        }

        faultState.configure(fault, delayMs);
        log.warn("Fault injection configured: service={} fault={} delayMs={}", SERVICE_NAME, fault.name(), delayMs);

        return ResponseEntity.ok(Map.of(
                "service",   SERVICE_NAME,
                "fault",     fault.name(),
                "faultType", fault.name(),
                "delayMs",   delayMs,
                "status",    "APPLIED",
                "active",    fault != FaultState.FaultType.NONE
        ));
    }

    @PostMapping("/reset")
    public ResponseEntity<Map<String, Object>> reset() {
        faultState.reset();
        log.info("Fault injection reset: service={}", SERVICE_NAME);
        return ResponseEntity.ok(Map.of(
                "service",   SERVICE_NAME,
                "fault",     "NONE",
                "faultType", "NONE",
                "delayMs",   0,
                "status",    "RESET",
                "active",    false
        ));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        boolean active = faultState.getActiveFault() != FaultState.FaultType.NONE;
        return ResponseEntity.ok(Map.of(
                "service",   SERVICE_NAME,
                "fault",     faultState.getActiveFault().name(),
                "faultType", faultState.getActiveFault().name(),
                "delayMs",   faultState.getDelayMs(),
                "active",    active
        ));
    }
}
