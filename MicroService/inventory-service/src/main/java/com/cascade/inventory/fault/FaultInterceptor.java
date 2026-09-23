package com.cascade.inventory.fault;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class FaultInterceptor implements HandlerInterceptor {
    private static final Logger log = LoggerFactory.getLogger(FaultInterceptor.class);
    private static final String SERVICE_NAME = "inventory-service";

    private final FaultState faultState;
    public FaultInterceptor(FaultState faultState) { this.faultState = faultState; }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws Exception {
        String uri = req.getRequestURI();
        if (uri.startsWith("/fault") || uri.startsWith("/actuator")) return true;
        switch (faultState.getActiveFault()) {
            case LATENCY -> {
                int d = faultState.getDelayMs();
                if (d > 0) {
                    log.warn("Fault injection active: service={} fault=LATENCY delayMs={}", SERVICE_NAME, d);
                    Thread.sleep(d);
                }
            }
            case ERROR   -> {
                log.warn("Fault injection active: service={} fault=ERROR", SERVICE_NAME);
                res.setStatus(500);
                res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Injected fault: SERVICE_ERROR\",\"service\":\"" + SERVICE_NAME + "\"}");
                return false;
            }
            case DOWN    -> {
                log.warn("Fault injection active: service={} fault=DOWN", SERVICE_NAME);
                res.setStatus(503);
                res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Injected fault: SERVICE_DOWN\",\"service\":\"" + SERVICE_NAME + "\"}");
                return false;
            }
            default -> {}
        }
        return true;
    }
}
