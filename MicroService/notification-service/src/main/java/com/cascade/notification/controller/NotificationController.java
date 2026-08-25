package com.cascade.notification.controller;

import com.cascade.notification.entity.Notification;
import com.cascade.notification.repository.NotificationRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping({"/notification", "/notifications"})
@CrossOrigin
public class NotificationController {
    private final NotificationRepository repository;

    public NotificationController(NotificationRepository repository) {
        this.repository = repository;
    }

    @PostMapping
    public Notification create(@RequestBody Notification notification) {
        if (notification.getStatus() == null || notification.getStatus().isEmpty()) {
            notification.setStatus("SENT");
        }
        return repository.save(notification);
    }

    @GetMapping
    public List<Notification> all() { 
        return repository.findAll(); 
    }

    @GetMapping("/{id}")
    public ResponseEntity<Notification> get(@PathVariable Long id) {
        return repository.findById(id).map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
