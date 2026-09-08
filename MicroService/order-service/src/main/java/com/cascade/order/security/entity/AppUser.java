package com.cascade.order.security.entity;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * Represents a registered user in the system.
 * Role is stored as a plain string: "USER" or "ADMIN".
 */
@Document(collection = "users")
public class AppUser {

    @Id
    private String id;

    @Indexed(unique = true)
    private String username;

    private String password;   // BCrypt-hashed

    private String role;       // "USER" or "ADMIN"

    private Instant createdAt = Instant.now();

    public AppUser() {}

    public AppUser(String username, String password, String role) {
        this.username  = username;
        this.password  = password;
        this.role      = role;
    }

    public String getId()        { return id; }
    public void   setId(String id) { this.id = id; }

    public String getUsername()           { return username; }
    public void   setUsername(String u)   { this.username = u; }

    public String getPassword()           { return password; }
    public void   setPassword(String p)   { this.password = p; }

    public String getRole()               { return role; }
    public void   setRole(String role)    { this.role = role; }

    public Instant getCreatedAt()         { return createdAt; }
    public void    setCreatedAt(Instant t){ this.createdAt = t; }
}
