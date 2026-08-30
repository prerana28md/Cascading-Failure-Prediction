package com.cascade.order.fault;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Spring MVC interceptor that applies the active fault before every request
 * (except /fault/** and /actuator/** endpoints themselves).
 */
@Component
public class FaultInterceptor implements HandlerInterceptor {

    private final FaultState faultState;

    public FaultInterceptor(FaultState faultState) {
        this.faultState = faultState;
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {

        String uri = request.getRequestURI();
        // Don't inject faults on the fault-control or actuator endpoints
        if (uri.startsWith("/fault") || uri.startsWith("/actuator")) {
            return true;
        }

        switch (faultState.getActiveFault()) {
            case LATENCY -> {
                int delay = faultState.getDelayMs();
                if (delay > 0) Thread.sleep(delay);
            }
            case ERROR -> {
                response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
                response.setContentType("application/json");
                response.getWriter().write(
                    "{\"error\":\"Injected fault: SERVICE_ERROR\",\"service\":\"order-service\"}"
                );
                return false;
            }
            case DOWN -> {
                response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
                response.setContentType("application/json");
                response.getWriter().write(
                    "{\"error\":\"Injected fault: SERVICE_DOWN\",\"service\":\"order-service\"}"
                );
                return false;
            }
            default -> { /* NONE — pass through */ }
        }
        return true;
    }
}
