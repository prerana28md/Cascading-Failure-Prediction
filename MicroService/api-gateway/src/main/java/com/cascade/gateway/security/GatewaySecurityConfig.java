package com.cascade.gateway.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Gateway security configuration.
 *
 * Auth flow:
 *   1. POST /auth/register and POST /auth/login are proxied through to order-service
 *      without requiring a token (they produce one).
 *   2. All other requests require a valid Bearer JWT.
 *   3. Admin-only operations (e.g. PUT /orders/{id}/status) are enforced
 *      both here at the gateway AND inside order-service for defence-in-depth.
 *
 * Header propagation:
 *   The GatewayProxyController already forwards all headers including Authorization,
 *   so downstream services receive the original token for their own validation.
 */
@Configuration
@EnableWebSecurity
public class GatewaySecurityConfig {

    private final GatewayJwtFilter jwtFilter;

    public GatewaySecurityConfig(GatewayJwtFilter jwtFilter) {
        this.jwtFilter = jwtFilter;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))

            .authorizeHttpRequests(auth -> auth
                // ── Public: auth endpoints (proxied to order-service /auth/**) ──
                .requestMatchers("/auth/**").permitAll()

                // ── Public: fault injection endpoints (dev/research use) ───────
                .requestMatchers("/fault/**").permitAll()

                // ── Public: actuator health check ─────────────────────────────
                .requestMatchers("/actuator/health", "/actuator/info",
                                 "/actuator/prometheus").permitAll()

                // ── Admin-only at gateway level (defence-in-depth) ─────────────
                .requestMatchers(HttpMethod.PUT, "/order/*/status").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT, "/orders/*/status").hasRole("ADMIN")

                // ── All other requests require a valid token ───────────────────
                .anyRequest().authenticated()
            )

            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(List.of("*"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
