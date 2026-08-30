package com.cascade.notification.fault;

import org.springframework.stereotype.Component;

@Component
public class FaultState {
    public enum FaultType { NONE, LATENCY, ERROR, DOWN }
    private volatile FaultType activeFault = FaultType.NONE;
    private volatile int       delayMs     = 0;
    public FaultType getActiveFault()           { return activeFault; }
    public int       getDelayMs()               { return delayMs;     }
    public void configure(FaultType fault, int delayMs) {
        this.activeFault = fault; this.delayMs = delayMs;
    }
    public void reset() { this.activeFault = FaultType.NONE; this.delayMs = 0; }
}
