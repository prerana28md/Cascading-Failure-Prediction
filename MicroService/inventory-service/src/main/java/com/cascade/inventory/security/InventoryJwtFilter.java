package com.cascade.inventory.security;

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

@Component
public class InventoryJwtFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(InventoryJwtFilter.class);

    private final InventoryJwtUtils jwtUtils;

    public InventoryJwtFilter(InventoryJwtUtils jwtUtils) {
        this.jwtUtils = jwtUtils;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {

        String authHeader = request.getHeader("Authorization");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);

            if (jwtUtils.validateToken(token)) {
                String username  = jwtUtils.getUsernameFromToken(token);
                String role      = jwtUtils.getRoleFromToken(token);
                String authority = "ROLE_" + (role != null ? role.toUpperCase() : "USER");

                if (SecurityContextHolder.getContext().getAuthentication() == null) {
                    UsernamePasswordAuthenticationToken authToken =
                            new UsernamePasswordAuthenticationToken(
                                    username, null,
                                    List.of(new SimpleGrantedAuthority(authority)));
                    SecurityContextHolder.getContext().setAuthentication(authToken);
                    log.debug("Inventory-service: authenticated '{}' role '{}'", username, role);
                }
            } else {
                log.warn("Inventory-service: invalid JWT from {}", request.getRemoteAddr());
            }
        }

        chain.doFilter(request, response);
    }
}
