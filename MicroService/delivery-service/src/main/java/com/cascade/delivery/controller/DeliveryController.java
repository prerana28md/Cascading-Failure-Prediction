package com.cascade.delivery.controller;

import com.cascade.delivery.entity.Delivery;
import com.cascade.delivery.repository.DeliveryRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping({"/delivery", "/deliveries"})
@CrossOrigin
public class DeliveryController {
    private final DeliveryRepository repository;

    public DeliveryController(DeliveryRepository repository) {
        this.repository = repository;
    }

    @PostMapping
    public Delivery create(@RequestBody Delivery delivery) {
        if (delivery.getStatus() == null || delivery.getStatus().isEmpty()) {
            delivery.setStatus("ASSIGNED");
        }
        if (delivery.getEstimatedDelivery() == null || delivery.getEstimatedDelivery().isEmpty()) {
            delivery.setEstimatedDelivery("3-5 business days");
        }
        return repository.save(delivery);
    }

    @GetMapping
    public List<Delivery> all() { 
        return repository.findAll(); 
    }

    @GetMapping("/{id}")
    public ResponseEntity<Delivery> get(@PathVariable Long id) {
        return repository.findById(id).map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
