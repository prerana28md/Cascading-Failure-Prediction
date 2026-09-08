package com.cascade.order.security.dto;

public class AuthResponse {

    private String token;
    private String username;
    private String role;
    private String tokenType = "Bearer";

    public AuthResponse() {}

    public AuthResponse(String token, String username, String role) {
        this.token    = token;
        this.username = username;
        this.role     = role;
    }

    public String getToken()            { return token; }
    public void   setToken(String t)    { this.token = t; }

    public String getUsername()         { return username; }
    public void   setUsername(String u) { this.username = u; }

    public String getRole()             { return role; }
    public void   setRole(String r)     { this.role = r; }

    public String getTokenType()        { return tokenType; }
    public void   setTokenType(String t){ this.tokenType = t; }
}
