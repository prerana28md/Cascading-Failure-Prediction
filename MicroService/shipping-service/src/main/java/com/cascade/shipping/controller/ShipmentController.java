package com.cascade.shipping.controller;

import com.cascade.shipping.entity.Shipment;
import com.cascade.shipping.repository.ShipmentRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping({"/shipping", "/shipments"})
@CrossOrigin
public class ShipmentController {
    private final ShipmentRepository repository;
    private final RestTemplate restTemplate;

    @Value("${service.delivery.url:http://localhost:8085}")
    private String deliveryServiceUrl;

    @Value("${service.notification.url:http://localhost:8086}")
    private String notificationServiceUrl;

    public ShipmentController(ShipmentRepository repository, RestTemplate restTemplate) {
        this.repository = repository;
        this.restTemplate = restTemplate;
    }

    @PostMapping
    public Shipment create(@RequestBody Shipment shipment) {
        if (shipment.getStatus() == null || shipment.getStatus().isEmpty()) {
            shipment.setStatus("SHIPPED");
        }
        Shipment savedShipment = repository.save(shipment);

        // Inter-service call to Delivery Service
        try {
            Map<String, Object> deliveryRequest = new HashMap<>();
            deliveryRequest.put("shipmentId", savedShipment.getId());
            deliveryRequest.put("status", "ASSIGNED");
            deliveryRequest.put("estimatedDelivery", "3-5 business days");
            restTemplate.postForObject(deliveryServiceUrl + "/deliveries", deliveryRequest, Object.class);
        } catch (Exception e) {
            System.err.println("Failed to reach Delivery Service: " + e.getMessage());
        }

        // Inter-service call to Notification Service
        try {
            Map<String, Object> notificationRequest = new HashMap<>();
            notificationRequest.put("userId", 1L);
            notificationRequest.put("type", "SHIPPING_UPDATE");
            notificationRequest.put("message", "Shipment created for Order #" + savedShipment.getOrderId() + " with ID " + savedShipment.getId());
            notificationRequest.put("status", "SENT");
            restTemplate.postForObject(notificationServiceUrl + "/notifications", notificationRequest, Object.class);
        } catch (Exception e) {
            System.err.println("Failed to reach Notification Service: " + e.getMessage());
        }

        return savedShipment;
    }

    @GetMapping
    public List<Shipment> all() {
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Shipment> get(@PathVariable Long id) {
        return repository.findById(id).map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
