package com.cascade.order.fault;

import org.springframework.stereotype.Component;

/**
 * Singleton that holds the active fault configuration for this service instance.
 * Controlled via POST /fault/configure  (see FaultController).
 *
 * Fault types:
 *   NONE    – normal operation
 *   LATENCY – artificial delay (delayMs milliseconds) injected on every request
 *   ERROR   – every request returns HTTP 500
 *   DOWN    – every request returns HTTP 503 (simulates service unavailable)
 */
@Component
public class FaultState {

    public enum FaultType { NONE, LATENCY, ERROR, DOWN }

    private volatile FaultType activeFault = FaultType.NONE;
    private volatile int       delayMs     = 0;

    public FaultType getActiveFault()           { return activeFault; }
    public int       getDelayMs()               { return delayMs;     }

    public void configure(FaultType fault, int delayMs) {
        this.activeFault = fault;
        this.delayMs     = delayMs;
    }

    public void reset() {
        this.activeFault = FaultType.NONE;
        this.delayMs     = 0;
    }
}
