package com.cascade.order.security.controller;

import com.cascade.order.security.dto.AuthResponse;
import com.cascade.order.security.dto.LoginRequest;
import com.cascade.order.security.dto.RegisterRequest;
import com.cascade.order.security.entity.AppUser;
import com.cascade.order.security.jwt.JwtUtils;
import com.cascade.order.security.repository.UserRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth")
@CrossOrigin
public class AuthController {

    private final AuthenticationManager authManager;
    private final UserRepository        userRepository;
    private final PasswordEncoder       passwordEncoder;
    private final JwtUtils              jwtUtils;

    public AuthController(AuthenticationManager authManager,
                          UserRepository userRepository,
                          PasswordEncoder passwordEncoder,
                          JwtUtils jwtUtils) {
        this.authManager     = authManager;
        this.userRepository  = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtils        = jwtUtils;
    }

    // ── POST /auth/register ───────────────────────────────────────────────────

    /**
     * Register a new user.
     * Body: { "username": "alice", "password": "secret", "role": "USER" }
     * Role defaults to "USER" when omitted. Use "ADMIN" to create an admin account.
     */
    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest req) {

        if (userRepository.existsByUsername(req.getUsername())) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("error", "Username already taken: " + req.getUsername()));
        }

        String role = (req.getRole() != null && !req.getRole().isBlank())
                ? req.getRole().toUpperCase() : "USER";

        AppUser user = new AppUser(
                req.getUsername(),
                passwordEncoder.encode(req.getPassword()),
                role);

        userRepository.save(user);

        String token = jwtUtils.generateToken(user.getUsername(), user.getRole());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AuthResponse(token, user.getUsername(), user.getRole()));
    }

    // ── POST /auth/login ──────────────────────────────────────────────────────

    /**
     * Log in with username + password and receive a JWT.
     * Body: { "username": "alice", "password": "secret" }
     */
    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest req) {
        try {
            Authentication auth = authManager.authenticate(
                    new UsernamePasswordAuthenticationToken(req.getUsername(), req.getPassword()));

            UserDetails userDetails = (UserDetails) auth.getPrincipal();

            // Derive role from the granted authority (ROLE_ADMIN → ADMIN)
            String role = userDetails.getAuthorities().stream()
                    .findFirst()
                    .map(a -> a.getAuthority().replace("ROLE_", ""))
                    .orElse("USER");

            String token = jwtUtils.generateToken(userDetails.getUsername(), role);
            return ResponseEntity.ok(new AuthResponse(token, userDetails.getUsername(), role));

        } catch (BadCredentialsException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid username or password"));
        }
    }

    // ── GET /auth/me ──────────────────────────────────────────────────────────

    /**
     * Returns the currently authenticated user's info.
     * Requires a valid Bearer token.
     */
    @GetMapping("/me")
    public ResponseEntity<?> me(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Not authenticated"));
        }
        UserDetails user = (UserDetails) authentication.getPrincipal();
        String role = user.getAuthorities().stream()
                .findFirst()
                .map(a -> a.getAuthority().replace("ROLE_", ""))
                .orElse("USER");
        return ResponseEntity.ok(Map.of(
                "username", user.getUsername(),
                "role", role
        ));
    }
}
