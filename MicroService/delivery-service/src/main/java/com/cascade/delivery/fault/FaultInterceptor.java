package com.cascade.delivery.fault;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class FaultInterceptor implements HandlerInterceptor {
    private final FaultState faultState;
    public FaultInterceptor(FaultState faultState) { this.faultState = faultState; }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws Exception {
        String uri = req.getRequestURI();
        if (uri.startsWith("/fault") || uri.startsWith("/actuator")) return true;
        switch (faultState.getActiveFault()) {
            case LATENCY -> { int d = faultState.getDelayMs(); if (d > 0) Thread.sleep(d); }
            case ERROR   -> { res.setStatus(500); res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Injected fault: SERVICE_ERROR\",\"service\":\"delivery-service\"}"); return false; }
            case DOWN    -> { res.setStatus(503); res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Injected fault: SERVICE_DOWN\",\"service\":\"delivery-service\"}"); return false; }
            default -> {}
        }
        return true;
    }
}
