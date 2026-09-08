package com.cascade.order.security.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public class RegisterRequest {

    @NotBlank(message = "Username is required")
    @Size(min = 3, max = 50, message = "Username must be 3–50 characters")
    private String username;

    @NotBlank(message = "Password is required")
    @Size(min = 6, message = "Password must be at least 6 characters")
    private String password;

    /**
     * Optional — defaults to "USER" if not supplied.
     * Only "USER" and "ADMIN" are accepted.
     */
    @Pattern(regexp = "USER|ADMIN", message = "Role must be USER or ADMIN")
    private String role = "USER";

    public RegisterRequest() {}

    public String getUsername()         { return username; }
    public void   setUsername(String u) { this.username = u; }

    public String getPassword()         { return password; }
    public void   setPassword(String p) { this.password = p; }

    public String getRole()             { return role; }
    public void   setRole(String role)  { this.role = role; }
}
