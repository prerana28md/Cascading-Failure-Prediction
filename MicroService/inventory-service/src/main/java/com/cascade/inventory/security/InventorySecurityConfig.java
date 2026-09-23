package com.cascade.inventory.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class InventorySecurityConfig {

    private final InventoryJwtFilter jwtFilter;

    public InventorySecurityConfig(InventoryJwtFilter jwtFilter) {
        this.jwtFilter = jwtFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))

            .authorizeHttpRequests(auth -> auth
                // ── Public health checks ───────────────────────────────────────
                .requestMatchers("/actuator/health", "/actuator/info",
                                 "/actuator/prometheus").permitAll()

                // ── Fault injection — public (dev/research use, no token needed) ──
                .requestMatchers("/fault/**").permitAll()

                // ── Internal stock deduction — order-service calls this ────────
                .requestMatchers(HttpMethod.POST, "/inventory/deduct", "/inventories/deduct").permitAll()

                // ── Admin-only: create/update/adjust inventory ────────────────
                .requestMatchers(HttpMethod.POST,   "/inventory").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST,   "/inventories").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT,    "/inventory/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.PUT,    "/inventories/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/inventory/**").hasRole("ADMIN")
                // ── Public: product catalog read access ────────────────────────
                .requestMatchers(HttpMethod.GET, "/inventory", "/inventory/**", "/inventories/**").permitAll()

                // ── Read endpoints — any authenticated user ───────────────────
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
