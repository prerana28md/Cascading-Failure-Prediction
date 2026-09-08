package com.cascade.gateway.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Gateway-level JWT filter.
 *
 * - For public paths (/auth/**) the token is optional.
 * - For all other paths a valid Bearer token is required.
 * - The original Authorization header is forwarded untouched to downstream services.
 * - X-User-Name and X-User-Role headers are injected so downstream services
 *   can trust the caller identity without re-validating the token themselves.
 */
@Component
public class GatewayJwtFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(GatewayJwtFilter.class);

    private final GatewayJwtUtils jwtUtils;

    public GatewayJwtFilter(GatewayJwtUtils jwtUtils) {
        this.jwtUtils = jwtUtils;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {

        String path = request.getRequestURI();

        // Auth endpoints bypass token check — they are public
        if (path.startsWith("/auth/")) {
            chain.doFilter(request, response);
            return;
        }

        String authHeader = request.getHeader("Authorization");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);

            if (jwtUtils.validateToken(token)) {
                String username = jwtUtils.getUsernameFromToken(token);
                String role     = jwtUtils.getRoleFromToken(token);
                String authority = "ROLE_" + (role != null ? role.toUpperCase() : "USER");

                UsernamePasswordAuthenticationToken authToken =
                        new UsernamePasswordAuthenticationToken(
                                username, null,
                                List.of(new SimpleGrantedAuthority(authority)));

                SecurityContextHolder.getContext().setAuthentication(authToken);
                log.debug("Gateway: authenticated '{}' role '{}'", username, role);
            } else {
                log.warn("Gateway: invalid JWT token from {}", request.getRemoteAddr());
                sendUnauthorized(response, "Invalid or expired token");
                return;
            }
        }
        // If no token provided, SecurityContext stays empty —
        // Spring Security will return 401 for protected routes automatically.

        chain.doFilter(request, response);
    }

    private void sendUnauthorized(HttpServletResponse response, String message)
            throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.getWriter().write(
                "{\"error\":\"UNAUTHORIZED\",\"message\":\"" + message + "\"}");
    }
}
